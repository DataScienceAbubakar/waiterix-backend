import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { generateTextWithClaude, generateConversationWithClaude } from "./bedrock";
import { synthesizeSpeechWithLanguage } from "./polly";
import { transcribeAudioBuffer } from "./transcribe";
import { setupAuth, isAuthenticated } from "./firebaseAuth";
import { insertRestaurantSchema, insertMenuItemSchema, insertOrderSchema, insertOrderItemSchema, insertRestaurantTableSchema, type InsertRestaurant } from "@/shared/schema";
import Stripe from "stripe";
import { Paystack } from "./payments/paystack";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import multer from "multer";
import { wsManager } from "./websocket";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { demoDataService } from "./demoDataService";
import { sendSupportEmail, sendReceiptEmail } from "./emailService";
import { getCurrencyForCountry } from "./utils/currencyMapping";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.post('/api/auth/accept-terms', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const user = await storage.acceptTerms(userId);
      res.json(user);
    } catch (error) {
      console.error("Error accepting terms:", error);
      res.status(500).json({ message: "Failed to accept terms" });
    }
  });

  app.delete('/api/auth/delete-account', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      
      // Cancel Stripe subscription if it exists (must succeed before deletion)
      if (restaurant?.subscriptionId) {
        console.log('[Delete Account] Cancelling Stripe subscription:', restaurant.subscriptionId);
        await stripe.subscriptions.cancel(restaurant.subscriptionId);
        console.log('[Delete Account] Stripe subscription cancelled successfully');
      }
      
      // Delete user and all related data (cascades automatically)
      await storage.deleteUser(userId);
      
      // Destroy session
      req.session.destroy((sessionErr: any) => {
        if (sessionErr) {
          console.error("Error destroying session:", sessionErr);
        }
        
        res.json({ message: "Account permanently deleted" });
      });
    } catch (error) {
      console.error("Error deleting account:", error);
      res.status(500).json({ message: "Failed to delete account" });
    }
  });

  // Contact support route
  app.post('/api/contact-support', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const [restaurant, user] = await Promise.all([
        storage.getRestaurantByUserId(userId),
        storage.getUser(userId)
      ]);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      if (!user || !user.email) {
        return res.status(404).json({ message: "User not found or email not available" });
      }

      const { subject, message } = req.body;

      if (!subject || !message) {
        return res.status(400).json({ message: "Subject and message are required" });
      }

      // Send support email via Resend
      await sendSupportEmail({
        restaurantName: restaurant.name,
        restaurantId: restaurant.id,
        userEmail: user.email,
        subject,
        message,
      });

      console.log('[Contact Support] Email sent successfully to support@harmoniaenterprisesllc.com');

      res.json({ 
        message: "Support request received successfully",
        restaurantName: restaurant.name 
      });
    } catch (error) {
      console.error("Error submitting support request:", error);
      res.status(500).json({ message: "Failed to submit support request" });
    }
  });

  // Restaurant routes
  app.get('/api/restaurant', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      res.json(restaurant);
    } catch (error) {
      console.error("Error fetching restaurant:", error);
      res.status(500).json({ message: "Failed to fetch restaurant" });
    }
  });

  app.post('/api/restaurant', isAuthenticated, async (req: any, res) => {
    try {
      console.log('[Create Restaurant] Starting restaurant creation for user:', req.userId);
      const userId = req.userId;
      const existingRestaurant = await storage.getRestaurantByUserId(userId);
      
      if (existingRestaurant) {
        console.log('[Create Restaurant] Restaurant already exists for user:', userId);
        return res.status(400).json({ message: "Restaurant already exists" });
      }

      console.log('[Create Restaurant] Preparing restaurant data...');
      // Hash admin passcode and security answers before saving
      const hashedData: any = {
        ...req.body,
        userId,
        // Set money-back guarantee end date to 30 days from now (at end of day UTC)
        trialEndsAt: new Date(new Date().setUTCHours(23, 59, 59, 999) + 30 * 24 * 60 * 60 * 1000),
      };

      // Auto-set currencyCode based on country if not provided
      if (!hashedData.currencyCode && hashedData.country) {
        hashedData.currencyCode = getCurrencyForCountry(hashedData.country);
        console.log(`[Create Restaurant] Auto-set currency to ${hashedData.currencyCode} for country ${hashedData.country}`);
      }

      // Hash admin passcode if provided
      if (req.body.adminPasscode) {
        console.log('[Create Restaurant] Hashing admin passcode...');
        hashedData.adminPassword = await bcrypt.hash(req.body.adminPasscode, 10);
        delete hashedData.adminPasscode;
      }

      // Hash security answers if provided
      if (req.body.securityAnswer1) {
        console.log('[Create Restaurant] Hashing security answer 1...');
        hashedData.securityAnswer1 = await bcrypt.hash(req.body.securityAnswer1.toLowerCase().trim(), 10);
      }
      if (req.body.securityAnswer2) {
        console.log('[Create Restaurant] Hashing security answer 2...');
        hashedData.securityAnswer2 = await bcrypt.hash(req.body.securityAnswer2.toLowerCase().trim(), 10);
      }

      console.log('[Create Restaurant] Validating restaurant data with schema...');
      const data = insertRestaurantSchema.parse(hashedData);
      
      console.log('[Create Restaurant] Inserting restaurant into database...');
      const restaurant = await storage.createRestaurant(data);
      console.log('[Create Restaurant] Restaurant created successfully:', restaurant.id);
      
      try {
        console.log('[Create Restaurant] Creating default tables...');
        // Auto-create 3 default tables for the restaurant
        await Promise.all([
          storage.createRestaurantTable({
            restaurantId: restaurant.id,
            tableNumber: "1",
          }),
          storage.createRestaurantTable({
            restaurantId: restaurant.id,
            tableNumber: "2",
          }),
          storage.createRestaurantTable({
            restaurantId: restaurant.id,
            tableNumber: "3",
          }),
        ]);
        console.log('[Create Restaurant] Default tables created successfully');
      } catch (tableError) {
        console.error("[Create Restaurant] Error creating default tables:", tableError);
        // Tables failed to create, but restaurant exists - log error but don't fail the request
        // Restaurant owner can manually add tables via the UI
      }
      
      console.log('[Create Restaurant] Returning restaurant data to client');
      res.json(restaurant);
    } catch (error) {
      console.error("[Create Restaurant] FATAL ERROR - Failed to create restaurant:", error);
      if (error instanceof Error) {
        console.error("[Create Restaurant] Error name:", error.name);
        console.error("[Create Restaurant] Error message:", error.message);
        console.error("[Create Restaurant] Error stack:", error.stack);
      }
      res.status(500).json({ message: "Failed to create restaurant", error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.put('/api/restaurant/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurant(req.params.id);
      
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      let updateData = req.body;
      
      // If coverImageUrl is provided, set ACL policy and get permanent URL
      if (updateData.coverImageUrl) {
        const objectStorageService = new ObjectStorageService();
        updateData.coverImageUrl = await objectStorageService.trySetObjectEntityAclPolicy(
          updateData.coverImageUrl,
          {
            owner: userId,
            visibility: "public",
          },
        );
      }

      const updated = await storage.updateRestaurant(req.params.id, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error updating restaurant:", error);
      res.status(500).json({ message: "Failed to update restaurant" });
    }
  });

  app.delete('/api/restaurant/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurant(req.params.id);
      
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // Cancel Stripe subscription if it exists (must succeed before deletion)
      if (restaurant.subscriptionId) {
        console.log('[Delete Restaurant] Cancelling Stripe subscription:', restaurant.subscriptionId);
        await stripe.subscriptions.cancel(restaurant.subscriptionId);
        console.log('[Delete Restaurant] Stripe subscription cancelled successfully');
      }

      await storage.deleteRestaurant(req.params.id);
      res.json({ message: "Restaurant deleted successfully" });
    } catch (error) {
      console.error("Error deleting restaurant:", error);
      res.status(500).json({ message: "Failed to delete restaurant" });
    }
  });

  // Restaurant Table Management Endpoints
  app.get('/api/restaurant/:restaurantId/tables', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurant(req.params.restaurantId);
      
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const tables = await storage.getRestaurantTables(req.params.restaurantId);
      res.json(tables);
    } catch (error) {
      console.error("Error fetching tables:", error);
      res.status(500).json({ message: "Failed to fetch tables" });
    }
  });

  app.post('/api/restaurant/:restaurantId/tables', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurant(req.params.restaurantId);
      
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // Validate and parse table data using schema
      const tableData = insertRestaurantTableSchema.parse({
        restaurantId: req.params.restaurantId,
        tableNumber: req.body.tableNumber,
      });

      const table = await storage.createRestaurantTable(tableData);
      
      res.json(table);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid table data", errors: error });
      }
      console.error("Error creating table:", error);
      res.status(500).json({ message: "Failed to create table" });
    }
  });

  app.put('/api/restaurant/:restaurantId/tables/:tableId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurant(req.params.restaurantId);
      
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // Verify the table belongs to this restaurant
      const table = await storage.getRestaurantTable(req.params.tableId);
      if (!table || table.restaurantId !== req.params.restaurantId) {
        return res.status(404).json({ message: "Table not found" });
      }

      // Validate table number
      const tableNumber = req.body.tableNumber?.trim();
      if (!tableNumber || typeof tableNumber !== 'string' || tableNumber.length === 0) {
        return res.status(400).json({ message: "Table number is required and cannot be empty" });
      }

      const updated = await storage.updateRestaurantTable(req.params.tableId, {
        tableNumber,
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating table:", error);
      res.status(500).json({ message: "Failed to update table" });
    }
  });

  app.delete('/api/restaurant/:restaurantId/tables/:tableId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurant(req.params.restaurantId);
      
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // Verify the table belongs to this restaurant
      const table = await storage.getRestaurantTable(req.params.tableId);
      if (!table || table.restaurantId !== req.params.restaurantId) {
        return res.status(404).json({ message: "Table not found" });
      }

      await storage.deleteRestaurantTable(req.params.tableId);
      res.json({ message: "Table deleted successfully" });
    } catch (error) {
      console.error("Error deleting table:", error);
      res.status(500).json({ message: "Failed to delete table" });
    }
  });

  // Menu item routes
  app.get('/api/menu-items', async (req, res) => {
    try {
      const restaurantId = req.query.restaurantId as string;
      if (!restaurantId) {
        return res.status(400).json({ message: "Restaurant ID required" });
      }
      
      // Handle demo restaurant
      if (demoDataService.isDemoRestaurant(restaurantId)) {
        return res.json(demoDataService.getDemoMenuItems());
      }
      
      const items = await storage.getMenuItems(restaurantId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching menu items:", error);
      res.status(500).json({ message: "Failed to fetch menu items" });
    }
  });

  app.post('/api/menu-items', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurant(req.body.restaurantId);
      
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      let imageUrl = req.body.imageUrl;
      
      // If imageUrl is provided, set ACL policy and get permanent URL
      if (imageUrl) {
        const objectStorageService = new ObjectStorageService();
        imageUrl = await objectStorageService.trySetObjectEntityAclPolicy(
          imageUrl,
          {
            owner: userId,
            visibility: "public",
          },
        );
      }

      const data = insertMenuItemSchema.parse({
        ...req.body,
        imageUrl,
      });
      const menuItem = await storage.createMenuItem(data);
      res.json(menuItem);
    } catch (error) {
      console.error("Error creating menu item:", error);
      res.status(500).json({ message: "Failed to create menu item" });
    }
  });

  app.put('/api/menu-items/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const menuItem = await storage.getMenuItem(req.params.id);
      
      if (!menuItem) {
        return res.status(404).json({ message: "Menu item not found" });
      }

      const restaurant = await storage.getRestaurant(menuItem.restaurantId);
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      let updateData = req.body;
      
      // If imageUrl is provided, set ACL policy and get permanent URL
      if (updateData.imageUrl) {
        const objectStorageService = new ObjectStorageService();
        updateData.imageUrl = await objectStorageService.trySetObjectEntityAclPolicy(
          updateData.imageUrl,
          {
            owner: userId,
            visibility: "public",
          },
        );
      }

      const updated = await storage.updateMenuItem(req.params.id, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error updating menu item:", error);
      res.status(500).json({ message: "Failed to update menu item" });
    }
  });

  app.delete('/api/menu-items/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const menuItem = await storage.getMenuItem(req.params.id);
      
      if (!menuItem) {
        return res.status(404).json({ message: "Menu item not found" });
      }

      const restaurant = await storage.getRestaurant(menuItem.restaurantId);
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      await storage.deleteMenuItem(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting menu item:", error);
      res.status(500).json({ message: "Failed to delete menu item" });
    }
  });

  // CSV Export/Import routes for menu items
  app.get('/api/menu-items/export', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const items = await storage.getMenuItems(restaurant.id);
      
      // Convert items to CSV format
      const Papa = (await import('papaparse')).default;
      const csv = Papa.unparse(items.map(item => ({
        name: item.name,
        description: item.description || '',
        price: item.price,
        category: item.category,
        isVegan: item.isVegan,
        isVegetarian: item.isVegetarian,
        isHalal: item.isHalal,
        isKosher: item.isKosher,
        spiceLevel: item.spiceLevel,
        allergens: (item.allergens || []).join(';'),
        available: item.available,
        imageUrl: item.imageUrl || '',
      })));

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="menu-items-${restaurant.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.csv"`);
      res.send(csv);
    } catch (error) {
      console.error("Error exporting menu items:", error);
      res.status(500).json({ message: "Failed to export menu items" });
    }
  });

  app.post('/api/menu-items/import/preview', isAuthenticated, async (req: any, res) => {
    try {
      console.log('[CSV Import Preview] Starting preview...');
      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      
      if (!restaurant) {
        console.log('[CSV Import Preview] Restaurant not found for user:', userId);
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const { csvData } = req.body;
      if (!csvData) {
        console.log('[CSV Import Preview] No CSV data provided');
        return res.status(400).json({ message: "CSV data required" });
      }

      console.log('[CSV Import Preview] Parsing CSV data...');
      const Papa = (await import('papaparse')).default;
      const parsed = Papa.parse(csvData, { header: true, skipEmptyLines: true });

      if (parsed.errors.length > 0) {
        console.log('[CSV Import Preview] CSV parsing errors:', parsed.errors);
        return res.status(400).json({ 
          message: "CSV parsing error", 
          errors: parsed.errors.map(e => e.message)
        });
      }

      const items = parsed.data as any[];
      console.log('[CSV Import Preview] Parsed', items.length, 'rows');
      const validatedItems = [];
      const errors = [];

      for (let i = 0; i < items.length; i++) {
        const row = items[i];
        const rowNum = i + 2; // +2 because header is row 1, and 0-indexed
        
        try {
          // Validate required fields
          if (!row.name?.trim()) {
            errors.push(`Row ${rowNum}: Name is required`);
            continue;
          }
          const priceValue = parseFloat(row.price);
          if (!row.price || isNaN(priceValue)) {
            errors.push(`Row ${rowNum}: Valid price is required`);
            continue;
          }
          if (priceValue < 0) {
            errors.push(`Row ${rowNum}: Price cannot be negative`);
            continue;
          }
          if (!row.category?.trim()) {
            errors.push(`Row ${rowNum}: Category is required`);
            continue;
          }

          // Helper to parse boolean values
          const parseBoolean = (value: any): boolean => {
            if (typeof value === 'boolean') return value;
            if (typeof value === 'string') return value.toLowerCase() === 'true';
            return false;
          };

          validatedItems.push({
            name: row.name.trim(),
            description: row.description?.trim() || '',
            price: parseFloat(row.price).toFixed(2),
            category: row.category.trim(),
            isVegan: parseBoolean(row.isVegan),
            isVegetarian: parseBoolean(row.isVegetarian),
            isHalal: parseBoolean(row.isHalal),
            isKosher: parseBoolean(row.isKosher),
            spiceLevel: row.spiceLevel?.trim() || null,
            allergens: row.allergens ? String(row.allergens).split(';').map((a: string) => a.trim()).filter(Boolean) : [],
            available: row.available === undefined ? true : parseBoolean(row.available),
            imageUrl: row.imageUrl?.trim() || null,
          });
        } catch (error) {
          console.log('[CSV Import Preview] Validation error on row', rowNum, ':', error);
          errors.push(`Row ${rowNum}: ${error instanceof Error ? error.message : 'Invalid data'}`);
        }
      }

      console.log('[CSV Import Preview] Validated', validatedItems.length, 'items with', errors.length, 'errors');
      res.json({
        items: validatedItems,
        errors,
        totalRows: items.length,
        validRows: validatedItems.length,
      });
    } catch (error) {
      console.error("[CSV Import Preview] FATAL ERROR:", error);
      if (error instanceof Error) {
        console.error("[CSV Import Preview] Error name:", error.name);
        console.error("[CSV Import Preview] Error message:", error.message);
        console.error("[CSV Import Preview] Error stack:", error.stack);
      }
      res.status(500).json({ message: "Failed to preview import", error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/menu-items/import/confirm', isAuthenticated, async (req: any, res) => {
    try {
      console.log('[CSV Import Confirm] Starting import confirmation...');
      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      
      if (!restaurant) {
        console.log('[CSV Import Confirm] Restaurant not found for user:', userId);
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        console.log('[CSV Import Confirm] Invalid items payload');
        return res.status(400).json({ message: "Items array required" });
      }

      console.log('[CSV Import Confirm] Importing', items.length, 'items...');
      const createdItems = [];
      const errors = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          // Validate price
          const priceNum = parseFloat(item.price);
          if (isNaN(priceNum) || priceNum < 0) {
            throw new Error(`Invalid price: ${item.price}`);
          }
          
          // Validate and transform data
          const data = insertMenuItemSchema.parse({
            ...item,
            price: priceNum.toFixed(2), // Store as string with 2 decimal places
            restaurantId: restaurant.id, // Inject restaurant ID
          });
          
          const created = await storage.createMenuItem(data);
          createdItems.push(created);
        } catch (error) {
          console.log('[CSV Import Confirm] Error creating item', i + 1, ':', error);
          errors.push(`Item ${i + 1} (${item.name || 'unknown'}): ${error instanceof Error ? error.message : 'Invalid data'}`);
        }
      }

      console.log('[CSV Import Confirm] Successfully created', createdItems.length, 'items with', errors.length, 'errors');
      res.json({ 
        success: true, 
        count: createdItems.length,
        items: createdItems,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("[CSV Import Confirm] FATAL ERROR:", error);
      if (error instanceof Error) {
        console.error("[CSV Import Confirm] Error name:", error.name);
        console.error("[CSV Import Confirm] Error message:", error.message);
        console.error("[CSV Import Confirm] Error stack:", error.stack);
      }
      res.status(500).json({ message: "Failed to import menu items", error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Order routes
  app.get('/api/orders', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // Clean up completed orders older than 24 hours
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await storage.deleteOldCompletedOrders(restaurant.id, twentyFourHoursAgo);

      const orders = await storage.getOrders(restaurant.id);
      res.json(orders);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.get('/api/orders/:id/items', async (req, res) => {
    try {
      const items = await storage.getOrderItems(req.params.id);
      res.json(items);
    } catch (error) {
      console.error("Error fetching order items:", error);
      res.status(500).json({ message: "Failed to fetch order items" });
    }
  });

  app.post('/api/orders', async (req, res) => {
    try {
      const { restaurantId, tableId, items, subtotal, tax, tip, total, paymentMethod, customerNote, stripePaymentIntentId } = req.body;
      
      // Handle demo restaurant - return mock order without saving to database
      if (demoDataService.isDemoRestaurant(restaurantId)) {
        const demoOrder = demoDataService.createDemoOrder({
          customerNote,
          paymentMethod,
          stripePaymentIntentId,
          subtotal,
          tax,
          tip: tip || '0.00',
          total,
        });
        console.log('Demo order created (not saved to database):', demoOrder);
        return res.json(demoOrder);
      }
      
      // Check restaurant subscription status
      const restaurant = await storage.getRestaurant(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      // Block orders if subscription is not active or trialing
      const validStatuses = ['trialing', 'active'];
      if (!restaurant.subscriptionStatus || !validStatuses.includes(restaurant.subscriptionStatus)) {
        return res.status(403).json({ 
          error: 'subscription_required',
          message: 'This restaurant is not currently accepting orders. Please contact the restaurant directly.'
        });
      }

      // Validate tableId exists in restaurant_tables if provided
      let validatedTableId = null;
      if (tableId) {
        const table = await storage.getTableByNumber(restaurantId, tableId);
        if (table) {
          validatedTableId = table.id;
        }
        // If table doesn't exist, validatedTableId stays null (order without table reference)
      }

      const orderData = insertOrderSchema.parse({
        restaurantId,
        tableId: validatedTableId,
        subtotal,
        tax,
        tip,
        total,
        paymentMethod,
        customerNote,
        // Cash orders: pending
        // Stripe orders (with paymentIntentId): completed (payment already confirmed)
        // Paystack orders (no paymentIntentId): pending (payment not yet confirmed)
        paymentStatus: paymentMethod === 'cash' ? 'pending' : 
                      (stripePaymentIntentId ? 'completed' : 'pending'),
        stripePaymentIntentId,
      });

      const orderItemsData = items.map((item: any) => 
        insertOrderItemSchema.parse({
          menuItemId: item.id,
          name: item.name,
          price: item.price.toString(),
          quantity: item.quantity,
          customerNote: item.customerNote,
        })
      );

      const order = await storage.createOrder(orderData, orderItemsData);
      res.json(order);
    } catch (error) {
      console.error("Error creating order:", error);
      res.status(500).json({ message: "Failed to create order" });
    }
  });

  app.put('/api/orders/:id/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const order = await storage.getOrder(req.params.id);
      
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const restaurant = await storage.getRestaurant(order.restaurantId);
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const updated = await storage.updateOrderStatus(req.params.id, req.body.status);
      
      // Emit WebSocket event for order status change
      if (wsManager) {
        wsManager.notifyOrderStatusChange(order.restaurantId, {
          orderId: updated.id,
          status: updated.status,
          order: updated,
        });
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating order status:", error);
      res.status(500).json({ message: "Failed to update order status" });
    }
  });

  // Rating routes
  app.post('/api/ratings', async (req, res) => {
    try {
      const { orderId, restaurantId, menuItemId, itemRating, serviceRatings, comment } = req.body;
      
      // Allow multiple ratings per order (one per menu item + one overall service rating)
      // But prevent duplicate ratings for the same specific item or service rating type
      const existingRatings = await storage.getRatingsByOrder(orderId);
      
      // Check for duplicate item rating (same menuItemId)
      if (menuItemId && existingRatings.some(r => r.menuItemId === menuItemId)) {
        return res.status(400).json({ message: "This item has already been rated" });
      }
      
      // Check for duplicate service rating (service ratings without menuItemId)
      if (serviceRatings && !menuItemId && existingRatings.some(r => r.serviceRatings && !r.menuItemId)) {
        return res.status(400).json({ message: "Service has already been rated" });
      }

      const rating = await storage.createRating({
        orderId,
        restaurantId,
        menuItemId: menuItemId || null,
        itemRating: itemRating || null,
        serviceRatings: serviceRatings || null,
        comment: comment || null,
      });

      res.json(rating);
    } catch (error) {
      console.error("Error creating rating:", error);
      res.status(500).json({ message: "Failed to create rating" });
    }
  });

  app.get('/api/orders/:id/ratings', async (req, res) => {
    try {
      const ratings = await storage.getRatingsByOrder(req.params.id);
      res.json({ ratings, hasBeenRated: ratings.length > 0 });
    } catch (error) {
      console.error("Error fetching ratings:", error);
      res.status(500).json({ message: "Failed to fetch ratings" });
    }
  });

  app.get('/api/restaurants/:id/ratings', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurant(req.params.id);
      
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const ratings = await storage.getRatingsByRestaurant(req.params.id);
      res.json(ratings);
    } catch (error) {
      console.error("Error fetching restaurant ratings:", error);
      res.status(500).json({ message: "Failed to fetch ratings" });
    }
  });

  // Assistance request routes
  app.post('/api/assistance-requests', async (req, res) => {
    try {
      const { restaurantId, tableId, orderId, customerMessage, requestType } = req.body;
      
      // Handle demo restaurant - return mock assistance request
      if (demoDataService.isDemoRestaurant(restaurantId)) {
        return res.json(demoDataService.createDemoAssistanceRequest({
          tableId,
          orderId,
          customerMessage,
          requestType,
        }));
      }
      
      const request = await storage.createAssistanceRequest({
        restaurantId,
        tableId: tableId || null,
        orderId: orderId || null,
        customerMessage: customerMessage || null,
        requestType: requestType || 'call_waiter',
        status: 'pending',
      });

      // Emit WebSocket event for new assistance request
      if (wsManager) {
        wsManager.notifyNewAssistanceRequest(restaurantId, request);
      }

      res.json(request);
    } catch (error) {
      console.error("Error creating assistance request:", error);
      res.status(500).json({ message: "Failed to create assistance request" });
    }
  });

  app.get('/api/assistance-requests', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const status = req.query.status as string | undefined;
      const requests = await storage.getAssistanceRequests(restaurant.id, status);
      res.json(requests);
    } catch (error) {
      console.error("Error fetching assistance requests:", error);
      res.status(500).json({ message: "Failed to fetch assistance requests" });
    }
  });

  app.patch('/api/assistance-requests/:id/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const request = await storage.getAssistanceRequest(req.params.id);
      
      if (!request) {
        return res.status(404).json({ message: "Assistance request not found" });
      }

      const restaurant = await storage.getRestaurant(request.restaurantId);
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const updated = await storage.updateAssistanceRequestStatus(req.params.id, req.body.status);
      res.json(updated);
    } catch (error) {
      console.error("Error updating assistance request:", error);
      res.status(500).json({ message: "Failed to update assistance request" });
    }
  });

  // Order tracking route (public - no auth required)
  app.get('/api/orders/:id/track', async (req, res) => {
    try {
      const orderId = req.params.id;
      
      // Handle demo orders - return mock tracking data
      if (demoDataService.isDemoOrder(orderId)) {
        return res.json(demoDataService.getDemoOrderTracking(orderId));
      }
      
      const order = await storage.getOrder(orderId);
      
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const items = await storage.getOrderItems(order.id);
      const restaurant = await storage.getRestaurant(order.restaurantId);
      let table = null;
      if (order.tableId) {
        table = await storage.getRestaurantTable(order.tableId);
      }

      // Check if order has been rated
      const hasBeenRated = await storage.hasOrderBeenRated(order.id);

      res.json({
        order,
        items,
        restaurant: {
          id: restaurant?.id,
          name: restaurant?.name,
          currencyCode: restaurant?.currencyCode,
          defaultLanguage: restaurant?.defaultLanguage,
        },
        table: table ? { tableNumber: table.tableNumber } : null,
        hasBeenRated,
      });
    } catch (error) {
      console.error("Error fetching order tracking:", error);
      res.status(500).json({ message: "Failed to fetch order tracking" });
    }
  });

  // Get complete order receipt data (public - no auth required)
  app.get('/api/orders/:id/receipt', async (req, res) => {
    try {
      const orderId = req.params.id;
      
      // Handle demo orders - return mock receipt data
      if (demoDataService.isDemoOrder(orderId)) {
        const demoReceipt = demoDataService.getDemoReceipt(orderId);
        console.log('Returning demo receipt:', demoReceipt);
        return res.json(demoReceipt);
      }
      
      const order = await storage.getOrder(orderId);
      
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const [items, restaurant] = await Promise.all([
        storage.getOrderItems(order.id),
        storage.getRestaurant(order.restaurantId)
      ]);

      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // Get table info if order has a table
      let table = null;
      if (order.tableId) {
        const tables = await storage.getRestaurantTables(order.restaurantId);
        table = tables.find((t: any) => t.id === order.tableId);
      }

      res.json({
        order,
        items,
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          address: restaurant.address,
          city: restaurant.city,
          country: restaurant.country,
          phone: restaurant.phone,
        },
        table: table ? { tableNumber: table.tableNumber } : null,
      });
    } catch (error) {
      console.error("Error fetching order receipt:", error);
      res.status(500).json({ message: "Failed to fetch order receipt" });
    }
  });

  // Send receipt via email (public - no auth required)
  app.post('/api/orders/:id/email-receipt', async (req, res) => {
    try {
      const { email } = req.body;
      const orderId = req.params.id;
      
      if (!email) {
        return res.status(400).json({ message: "Email address is required" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email address" });
      }

      // Handle demo orders - simulate email sending
      if (orderId.startsWith('demo-order-')) {
        console.log('=== DEMO EMAIL RECEIPT ===');
        console.log(`To: ${email}`);
        console.log(`Subject: Receipt from Demo Restaurant - Order #${orderId.slice(11, 19).toUpperCase()}`);
        console.log(`Content: Demo receipt for order ${orderId}`);
        console.log('==========================');
        
        return res.json({ 
          success: true, 
          message: `Receipt sent to ${email}`,
          dev_note: 'Demo email logged to console'
        });
      }

      const order = await storage.getOrder(orderId);
      
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const [items, restaurant] = await Promise.all([
        storage.getOrderItems(order.id),
        storage.getRestaurant(order.restaurantId)
      ]);

      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // Get table info if order has a table
      let table = null;
      if (order.tableId) {
        const tables = await storage.getRestaurantTables(order.restaurantId);
        table = tables.find((t: any) => t.id === order.tableId);
      }

      // Format the timestamp
      const orderDate = new Date(order.createdAt).toLocaleString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      // Send receipt email via Resend
      await sendReceiptEmail({
        to: email,
        orderNumber: order.id.slice(0, 8).toUpperCase(),
        restaurantName: restaurant.name,
        items: items.map(item => ({
          name: item.name,
          quantity: item.quantity,
          price: parseFloat(item.price) * item.quantity,
        })),
        subtotal: parseFloat(order.subtotal),
        tax: parseFloat(order.tax),
        tip: parseFloat(order.tip),
        total: parseFloat(order.total),
        paymentMethod: order.paymentMethod === 'card' ? 'Card' : order.paymentMethod,
        tableNumber: table?.tableNumber,
        timestamp: orderDate,
      });

      console.log(`[Email Receipt] Receipt sent successfully to ${email}`);

      res.json({ 
        success: true, 
        message: `Receipt sent to ${email}`
      });
    } catch (error) {
      console.error("Error sending receipt email:", error);
      res.status(500).json({ message: "Failed to send receipt email" });
    }
  });

  // Public restaurant endpoint
  app.get('/api/public/restaurant/:id', async (req, res) => {
    try {
      // Handle demo restaurant
      if (demoDataService.isDemoRestaurant(req.params.id)) {
        return res.json(demoDataService.getDemoRestaurant());
      }

      const restaurant = await storage.getRestaurant(req.params.id);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }
      res.json(restaurant);
    } catch (error) {
      console.error("Error fetching restaurant:", error);
      res.status(500).json({ message: "Failed to fetch restaurant" });
    }
  });

  // Stripe payment intent creation
  app.post('/api/create-payment-intent', async (req, res) => {
    try {
      const { amount, restaurantId } = req.body;
      
      const restaurant = await storage.getRestaurant(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // Check restaurant subscription status
      const validStatuses = ['trialing', 'active'];
      if (!restaurant.subscriptionStatus || !validStatuses.includes(restaurant.subscriptionStatus)) {
        return res.status(403).json({ 
          error: 'subscription_required',
          message: 'This restaurant is not currently accepting orders. Please contact the restaurant directly.'
        });
      }

      // Check if restaurant has Stripe Connect account
      if (!restaurant.stripeAccountId) {
        return res.status(400).json({ 
          error: 'stripe_not_connected',
          message: "Restaurant has not set up Stripe payments yet" 
        });
      }
      
      if (!restaurant.stripeOnboardingComplete) {
        return res.status(400).json({ 
          error: 'stripe_onboarding_incomplete',
          message: "Restaurant is still completing Stripe onboarding. Please try again later." 
        });
      }

      const totalAmount = Math.round(amount * 100); // Convert to cents

      // Fetch connected account capabilities to determine enabled payment methods
      let paymentMethodTypes = ['card']; // Default to card
      try {
        const account = await stripe.accounts.retrieve(restaurant.stripeAccountId);
        const enabledMethods = ['card']; // Always include card
        
        // Check capabilities and add supported payment methods
        if (account.capabilities?.cashapp_payments === 'active') {
          enabledMethods.push('cashapp');
        }
        if (account.capabilities?.afterpay_clearpay_payments === 'active') {
          enabledMethods.push('afterpay_clearpay');
        }
        
        paymentMethodTypes = enabledMethods;
      } catch (accountError) {
        console.warn('Could not fetch account capabilities, defaulting to card only:', accountError);
      }

      // Create payment intent directly on restaurant's Stripe account (direct charge)
      // Note: return_url is not needed here - it's handled by PaymentElement on the client side
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalAmount,
        currency: 'usd',
        payment_method_types: paymentMethodTypes,
      }, {
        stripeAccount: restaurant.stripeAccountId,
      });

      res.json({ 
        clientSecret: paymentIntent.client_secret,
        stripeAccountId: restaurant.stripeAccountId 
      });
    } catch (error) {
      console.error('Error creating payment intent:', error);
      res.status(500).json({ message: "Failed to create payment intent" });
    }
  });

  // Stripe Connect routes
  app.post('/api/stripe/connect-account', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // If account already exists, return it
      if (restaurant.stripeAccountId) {
        return res.json({ accountId: restaurant.stripeAccountId });
      }

      // Create Stripe Connect account
      // Construct valid business URL
      const baseUrl = req.get('host')?.includes('replit.dev') || req.get('host')?.includes('repl.co')
        ? `https://${req.get('host')}`
        : process.env.NODE_ENV === 'production'
        ? `https://${req.get('host')}`
        : `http://${req.get('host')}`;
      
      const user = await storage.getUser(userId);
      const account = await stripe.accounts.create({
        type: 'express',
        country: restaurant.country === 'United States' ? 'US' : 'US', // Default to US for now
        email: user?.email || '',
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'company',
        business_profile: {
          name: restaurant.name,
          url: `${baseUrl}/menu/${restaurant.id}`,
        },
      });

      // Update restaurant with Stripe account ID
      await storage.updateRestaurant(restaurant.id, {
        stripeAccountId: account.id,
      } as any);

      res.json({ accountId: account.id });
    } catch (error) {
      console.error('Error creating Stripe Connect account:', error);
      res.status(500).json({ message: "Failed to create Stripe Connect account" });
    }
  });

  app.post('/api/stripe/onboarding-link', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      
      if (!restaurant || !restaurant.stripeAccountId) {
        return res.status(400).json({ message: "Stripe account not found" });
      }

      const accountLink = await stripe.accountLinks.create({
        account: restaurant.stripeAccountId,
        refresh_url: `${req.protocol}://${req.get('host')}/dashboard/settings?refresh=true`,
        return_url: `${req.protocol}://${req.get('host')}/dashboard/settings?stripe_refresh=true`,
        type: 'account_onboarding',
      });

      res.json({ url: accountLink.url });
    } catch (error) {
      console.error('Error creating onboarding link:', error);
      res.status(500).json({ message: "Failed to create onboarding link" });
    }
  });

  // Check Stripe account status
  app.get('/api/stripe/account-status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      
      if (!restaurant || !restaurant.stripeAccountId) {
        return res.status(400).json({ message: "Stripe account not found" });
      }

      // Fetch account from Stripe
      const account = await stripe.accounts.retrieve(restaurant.stripeAccountId);
      
      const isComplete = account.charges_enabled && account.details_submitted;
      
      // Update restaurant if status changed
      if (isComplete !== restaurant.stripeOnboardingComplete) {
        await storage.updateRestaurant(restaurant.id, {
          stripeOnboardingComplete: isComplete,
        } as any);
      }

      res.json({ 
        isComplete,
        chargesEnabled: account.charges_enabled,
        detailsSubmitted: account.details_submitted,
      });
    } catch (error) {
      console.error('Error checking Stripe account status:', error);
      res.status(500).json({ message: "Failed to check account status" });
    }
  });

  // Paystack routes
  // Get list of Nigerian banks for Paystack subaccount creation
  app.get('/api/paystack/banks', isAuthenticated, async (req: any, res) => {
    try {
      const banks = await Paystack.getBanks();
      res.json({ banks });
    } catch (error) {
      console.error('Error fetching Paystack banks:', error);
      res.status(500).json({ message: "Failed to fetch banks" });
    }
  });

  // Create Paystack subaccount for restaurant
  app.post('/api/paystack/create-subaccount', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { bankCode, accountNumber } = req.body;
      
      if (!bankCode || !accountNumber) {
        return res.status(400).json({ message: "Bank code and account number are required" });
      }

      const restaurant = await storage.getRestaurantByUserId(userId);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // Validate account number (Nigerian banks use 10 digits)
      if (!/^\d{10}$/.test(accountNumber)) {
        return res.status(400).json({ message: "Account number must be exactly 10 digits" });
      }

      // Create Paystack subaccount
      const result = await Paystack.createSubaccount(
        restaurant.name,
        bankCode,
        accountNumber,
        0 // Platform takes 0% commission, restaurant gets all
      );

      // If Paystack keys are not configured, reject the request
      if (result.isPlaceholder) {
        return res.status(503).json({ 
          message: "Paystack integration is not fully configured. Please contact support.",
          isPlaceholder: true
        });
      }

      // Update restaurant with Paystack details (only if real subaccount created)
      await storage.updateRestaurant(restaurant.id, {
        paystackSubaccountCode: result.subaccountCode,
        paystackBankCode: bankCode,
        paystackAccountNumber: accountNumber,
        paystackAccountName: result.accountName,
        paystackOnboardingComplete: true,
      } as any);

      res.json({ 
        subaccountCode: result.subaccountCode,
        accountName: result.accountName,
        isComplete: true
      });
    } catch (error) {
      console.error('Error creating Paystack subaccount:', error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to create Paystack subaccount" });
    }
  });

  // Initialize Paystack payment for customer checkout
  app.post('/api/paystack/initialize-payment', async (req, res) => {
    try {
      const { orderId, customerEmail } = req.body;
      
      if (!orderId) {
        return res.status(400).json({ message: "Order ID is required" });
      }

      // Validate email format only if provided
      if (customerEmail) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customerEmail)) {
          return res.status(400).json({ message: "Invalid email address" });
        }
      }

      // Get order details
      const order = await storage.getOrder(orderId);
      
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Validate order is in correct state for payment
      if (order.paymentStatus === 'paid' || order.paymentStatus === 'completed') {
        return res.status(400).json({ message: "Order has already been paid" });
      }

      if (order.paymentMethod !== 'online') {
        return res.status(400).json({ message: "Order payment method is not online" });
      }

      // Get restaurant details
      const restaurant = await storage.getRestaurant(order.restaurantId);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // Check if restaurant has Paystack enabled (has subaccount)
      if (!restaurant.paystackSubaccountCode) {
        return res.status(400).json({ 
          message: "Online payment is not available for this restaurant. Please choose cash payment.",
          paymentUnavailable: true
        });
      }

      // Convert NGN to kobo (100 kobo = 1 NGN)
      const orderTotal = parseFloat(order.total);
      if (isNaN(orderTotal) || orderTotal <= 0) {
        return res.status(400).json({ message: "Invalid order total" });
      }
      const amountInKobo = Math.round(orderTotal * 100);

      // Use provided email or generate default (Paystack API requires an email)
      const emailForPaystack = customerEmail || `customer-${orderId.slice(0, 8)}@waiterix.app`;

      // Build callback URL - where Paystack redirects after payment
      // Security: Use server-controlled base URL with strict origin validation
      const allowedOrigins: string[] = [
        process.env.FRONTEND_URL || 'https://waiterix.com',
        'https://waiterix.replit.app',
        ...(process.env.NODE_ENV === 'development' ? ['http://localhost:5000', req.headers.origin].filter((o): o is string => typeof o === 'string') : [])
      ].filter((o): o is string => typeof o === 'string');

      // Parse and validate request origin with strict protocol+host matching
      let baseUrl: string = allowedOrigins[0]; // Default fallback
      try {
        const requestOrigin = req.headers.origin || req.headers.referer?.split('?')[0]?.replace(/\/$/, '');
        if (requestOrigin && typeof requestOrigin === 'string') {
          const requestUrl = new URL(requestOrigin);
          const requestOriginNormalized = `${requestUrl.protocol}//${requestUrl.host}`;
          
          // Strict equality check: exact protocol and host must match
          const matchedOrigin = allowedOrigins.find(allowed => {
            try {
              if (typeof allowed !== 'string') return false;
              const allowedUrl = new URL(allowed);
              const allowedNormalized = `${allowedUrl.protocol}//${allowedUrl.host}`;
              return allowedNormalized === requestOriginNormalized;
            } catch {
              return false;
            }
          });
          
          if (matchedOrigin) {
            baseUrl = matchedOrigin;
          } else {
            console.warn(`[Paystack Init] Untrusted origin ${requestOriginNormalized}, using fallback ${baseUrl}`);
          }
        }
      } catch (err) {
        console.warn(`[Paystack Init] Failed to parse origin, using fallback ${baseUrl}:`, err);
      }
      
      const callbackUrl = `${baseUrl}/payment-return?gateway=paystack&orderId=${orderId}`;

      // Initialize Paystack transaction
      const paymentResult = await Paystack.initializeTransaction(
        amountInKobo,
        emailForPaystack,
        callbackUrl,
        restaurant.paystackSubaccountCode,
        {
          orderId: order.id,
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
          tableNumber: order.tableId,
          custom_fields: [
            {
              display_name: "Order ID",
              variable_name: "order_id",
              value: order.id
            },
            {
              display_name: "Restaurant",
              variable_name: "restaurant",
              value: restaurant.name
            }
          ]
        }
      );

      // Handle placeholder response (Paystack not configured)
      if (paymentResult.isPlaceholder) {
        return res.status(503).json({ 
          message: "Online payment is temporarily unavailable. Please choose cash payment.",
          paymentUnavailable: true
        });
      }

      // Store Paystack reference with the order BEFORE redirecting
      // This is critical for webhook validation
      await storage.updateOrder(order.id, {
        paystackReference: paymentResult.reference,
      } as any);

      console.log(`[Paystack] Payment initialized for order ${orderId}: ${paymentResult.reference} (${amountInKobo} kobo)`);

      // Return authorization URL for customer to complete payment
      res.json({ 
        authorizationUrl: paymentResult.authorizationUrl,
        reference: paymentResult.reference,
        accessCode: paymentResult.accessCode
      });
    } catch (error) {
      console.error('Error initializing Paystack payment:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to initialize payment",
        paymentUnavailable: true
      });
    }
  });

  // Verify Paystack payment for frontend callback handling
  // This endpoint allows the frontend to verify payment status after redirect
  // Note: This is public (no auth) but validates reference against order to prevent abuse
  app.get('/api/payments/paystack/verify', async (req, res) => {
    try {
      const { reference, orderId } = req.query;
      
      if (!reference || typeof reference !== 'string') {
        return res.status(400).json({ message: "Payment reference is required" });
      }

      if (!orderId || typeof orderId !== 'string') {
        return res.status(400).json({ message: "Order ID is required" });
      }

      // Get the order to validate the reference belongs to it
      const order = await storage.getOrder(orderId);
      
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Security: Verify the reference matches the order's stored reference
      if (order.paystackReference !== reference) {
        console.error(`[Paystack Verify] Reference mismatch: order ${orderId} has ${order.paystackReference}, got ${reference}`);
        return res.status(403).json({ message: "Invalid payment reference for this order" });
      }

      // Verify transaction with Paystack
      const verificationResult = await Paystack.verifyTransaction(reference);

      res.json({
        status: verificationResult.status,
        amount: verificationResult.amount,
        paidAt: verificationResult.paidAt,
        channel: verificationResult.channel,
        currency: verificationResult.currency,
        orderId: order.id,
      });
    } catch (error) {
      console.error('Error verifying Paystack payment:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to verify payment"
      });
    }
  });

  // Paystack webhook endpoint for payment confirmations
  // CRITICAL: Raw body is captured in server/index.ts via JSON parser's verify function
  // This ensures signature verification uses the exact bytes Paystack signed
  app.post('/api/webhooks/paystack', async (req: any, res) => {
    try {
      const signature = req.headers['x-paystack-signature'] as string;
      
      if (!signature) {
        console.error('[Paystack Webhook] Missing signature header');
        return res.status(400).json({ message: 'Missing signature' });
      }

      // Get raw body captured by JSON parser's verify function
      const rawBody = req.rawBody;
      
      if (!rawBody) {
        console.error('[Paystack Webhook] Raw body not captured - verify function may not be working');
        return res.status(500).json({ message: 'Internal server error' });
      }
      
      // Verify webhook signature using the raw body
      const isValid = Paystack.verifyWebhookSignature(rawBody, signature);
      
      if (!isValid) {
        console.error('[Paystack Webhook] Invalid signature - rejecting webhook');
        return res.status(401).json({ message: 'Invalid signature' });
      }

      // Parse webhook event using the already-parsed body from express.json()
      const event = Paystack.parseWebhookEvent(req.body);
      
      if (!event) {
        console.error('[Paystack Webhook] Invalid event structure');
        return res.status(400).json({ message: 'Invalid event' });
      }

      console.log(`[Paystack Webhook] Received event: ${event.event}, Reference: ${event.data.reference}`);

      // Handle different event types
      switch (event.event) {
        case 'charge.success':
          // Payment succeeded - update order status
          const reference = event.data.reference;
          const orderId = event.data.metadata?.orderId;

          if (!orderId) {
            console.warn(`[Paystack Webhook] No orderId in metadata for reference: ${reference}`);
            break;
          }

          console.log(`[Paystack Webhook] Payment successful for order ${orderId}`);

          try {
            // Get the order first
            const order = await storage.getOrder(orderId);
            
            if (!order) {
              console.warn(`[Paystack Webhook] Order ${orderId} not found`);
              break;
            }

            // Validate reference matches the order's Paystack reference
            if (order.paystackReference && order.paystackReference !== reference) {
              console.error(
                `[Paystack Webhook] Reference mismatch for order ${orderId}:` +
                ` expected ${order.paystackReference}, got ${reference}`
              );
              break;
            }

            // Idempotency check: only process if order hasn't been paid yet
            if (order.paymentStatus === 'paid' || order.paymentStatus === 'completed') {
              console.log(`[Paystack Webhook] Order ${orderId} already paid - ignoring duplicate webhook`);
              break;
            }

            // State guard: only allow updates for orders in pre-payment states
            // This prevents duplicate webhooks from regressing orders that staff already advanced
            const allowedPrePaymentStates = ['pending', 'new'];
            if (!allowedPrePaymentStates.includes(order.status)) {
              console.log(
                `[Paystack Webhook] Order ${orderId} already in state '${order.status}' - ` +
                `ignoring webhook to preserve restaurant workflow`
              );
              break;
            }

            // Verify the transaction with Paystack API
            const verification = await Paystack.verifyTransaction(reference);

            if (verification.status !== 'success') {
              console.warn(`[Paystack Webhook] Transaction verification failed for ${reference}: ${verification.status}`);
              break;
            }

            // Validate payment amount matches order total (convert NGN to kobo)
            // order.total is a decimal string, so parse it first
            const orderTotal = parseFloat(order.total);
            
            if (isNaN(orderTotal)) {
              console.error(`[Paystack Webhook] Invalid order total for order ${orderId}: ${order.total}`);
              break;
            }

            const expectedAmountKobo = Math.round(orderTotal * 100);
            const paidAmountKobo = verification.amount;
            
            // Allow 1% tolerance for rounding differences
            const tolerance = Math.max(1, Math.round(expectedAmountKobo * 0.01));
            
            if (Math.abs(paidAmountKobo - expectedAmountKobo) > tolerance) {
              console.error(
                `[Paystack Webhook] Payment amount mismatch for order ${orderId}:` +
                ` expected ${expectedAmountKobo} kobo, got ${paidAmountKobo} kobo`
              );
              break;
            }

            // Validate currency matches (NGN for Paystack)
            if (verification.currency && verification.currency !== 'NGN') {
              console.error(
                `[Paystack Webhook] Currency mismatch for order ${orderId}:` +
                ` expected NGN, got ${verification.currency}`
              );
              break;
            }

            // All validations passed - update order status to 'new'
            await storage.updateOrderStatus(orderId, 'new');

            console.log(`[Paystack Webhook] Order ${orderId} payment verified (${paidAmountKobo} kobo) and status updated to 'new'`);

            // Fetch updated order for WebSocket notification
            const updatedOrder = await storage.getOrder(orderId);
            
            if (updatedOrder) {
              // Send WebSocket notification to restaurant owner
              wsManager.notifyOrderStatusChange(updatedOrder.restaurantId, {
                ...updatedOrder,
                paymentStatus: 'paid',
              });
            }
          } catch (error) {
            console.error(`[Paystack Webhook] Error updating order ${orderId}:`, error);
          }
          break;

        case 'charge.failed':
          // Payment failed - log it
          console.log(`[Paystack Webhook] Payment failed for reference: ${event.data.reference}`);
          break;

        default:
          console.log(`[Paystack Webhook] Unhandled event type: ${event.event}`);
      }

      // Always return 200 OK to acknowledge receipt
      res.json({ received: true });
    } catch (error) {
      console.error('[Paystack Webhook] Error processing webhook:', error);
      res.status(500).json({ message: 'Webhook processing failed' });
    }
  });

  app.post('/api/stripe/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET || ''
      );
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case 'account.updated':
        const account = event.data.object as Stripe.Account;
        
        // Find restaurant by Stripe account ID
        const restaurants = await storage.getAllRestaurants();
        const restaurant = restaurants.find(r => r.stripeAccountId === account.id);
        
        if (restaurant) {
          // Update onboarding status
          await storage.updateRestaurant(restaurant.id, {
            stripeOnboardingComplete: account.charges_enabled && account.details_submitted,
          } as any);
        }
        break;
      
      case 'invoice.upcoming':
        // Report AI usage before invoice is finalized (fires ~1 week before renewal)
        const upcomingInvoice = event.data.object as Stripe.Invoice;
        const allRestaurants = await storage.getAllRestaurants();
        const invoiceRestaurant = allRestaurants.find(r => r.stripeCustomerId === upcomingInvoice.customer);
        
        if (invoiceRestaurant) {
          console.log(`[Webhook] Reporting usage for ${invoiceRestaurant.id} before invoice finalization`);
          await reportUsageToStripe(invoiceRestaurant.id);
        }
        break;
      
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  });

  // Subscription routes with metered billing (base $50/month + AI usage)
  // Using Stripe Checkout Session for reliable payment collection
  app.post('/api/subscription/create', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // Check if restaurant already has an active subscription
      if (restaurant.subscriptionId) {
        try {
          const existingSubscription = await stripe.subscriptions.retrieve(restaurant.subscriptionId);
          
          console.log('[Checkout] Found existing subscription:', {
            id: existingSubscription.id,
            status: existingSubscription.status,
          });
          
          // If subscription is already active, redirect to dashboard
          if (existingSubscription.status === 'active' || existingSubscription.status === 'trialing') {
            return res.json({
              checkoutUrl: '/dashboard',
              alreadyActive: true,
            });
          }
          
          // If subscription is incomplete, cancel it and create a fresh checkout session
          if (existingSubscription.status === 'incomplete' || existingSubscription.status === 'incomplete_expired') {
            console.log('[Checkout] Canceling incomplete subscription');
            await stripe.subscriptions.cancel(existingSubscription.id);
            await storage.updateRestaurant(restaurant.id, {
              subscriptionId: null,
              subscriptionStatus: null,
            } as any);
          }
        } catch (error) {
          console.error('Error checking existing subscription:', error);
        }
      }

      // Validate Stripe Price IDs
      const basePriceId = process.env.STRIPE_BASE_PRICE_ID;
      const usagePriceId = process.env.STRIPE_USAGE_PRICE_ID;
      
      if (!basePriceId || !usagePriceId) {
        return res.status(500).json({ 
          message: "Stripe pricing not configured",
          error: "missing_price_ids"
        });
      }

      // Create or verify Stripe customer
      let customerId = restaurant.stripeCustomerId;
      
      if (customerId) {
        try {
          await stripe.customers.retrieve(customerId);
          console.log('[Checkout] Using existing customer:', customerId);
        } catch (error: any) {
          console.log('[Checkout] Customer not found in Stripe, creating new:', error.code);
          if (error.code === 'resource_missing') {
            // Clear the invalid customer ID from database
            customerId = null;
            await storage.updateRestaurant(restaurant.id, {
              stripeCustomerId: null,
            } as any);
          } else {
            throw error; // Re-throw other errors
          }
        }
      }
      
      if (!customerId) {
        const user = await storage.getUser((req as any).userId);
        const customer = await stripe.customers.create({
          email: user?.email || '',
          name: restaurant.name,
          metadata: {
            restaurantId: restaurant.id,
          },
        });
        customerId = customer.id;
        console.log('[Checkout] Created new customer:', customerId);
        await storage.updateRestaurant(restaurant.id, {
          stripeCustomerId: customerId,
        } as any);
      }

      // Create Checkout Session for subscription
      // Get the base URL from the request
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000';
      const baseUrl = `${protocol}://${host}`;
      
      console.log('[Checkout] Base URL:', baseUrl);
      
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [
          {
            price: basePriceId,
            quantity: 1,
          },
          {
            price: usagePriceId,
          },
        ],
        success_url: `${baseUrl}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/subscribe?canceled=true`,
        subscription_data: {
          metadata: {
            restaurantId: restaurant.id,
            restaurantName: restaurant.name,
          },
        },
        allow_promotion_codes: true,
      });

      console.log('[Checkout] Created session:', session.id);

      res.json({
        checkoutUrl: session.url,
      });
    } catch (error: any) {
      console.error('Error creating checkout session:', error);
      res.status(500).json({ 
        message: "Failed to create checkout session",
        error: error.message 
      });
    }
  });

  app.get('/api/subscription/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      console.log('[Subscription Status] Restaurant:', {
        id: restaurant.id,
        subscriptionId: restaurant.subscriptionId,
        subscriptionStatus: restaurant.subscriptionStatus,
      });

      // If restaurant has a subscription, fetch the latest status from Stripe
      if (restaurant.subscriptionId) {
        try {
          const subscription = await stripe.subscriptions.retrieve(restaurant.subscriptionId, {
            expand: ['latest_invoice.payment_intent'],
          });
          
          console.log('[Subscription Status] Stripe subscription:', {
            id: subscription.id,
            status: subscription.status,
          });
          
          // Check if subscription is incomplete but payment succeeded
          if (subscription.status === 'incomplete') {
            const invoice = subscription.latest_invoice as Stripe.Invoice;
            const paymentIntent = (invoice as any)?.payment_intent as Stripe.PaymentIntent;
            
            console.log('[Subscription Status] Checking payment:', {
              invoiceId: invoice?.id,
              invoiceStatus: invoice?.status,
              paymentIntentId: paymentIntent?.id,
              paymentIntentStatus: paymentIntent?.status,
            });
            
            // If PaymentIntent succeeded, mark invoice as paid
            if (paymentIntent?.status === 'succeeded' && invoice?.status !== 'paid') {
              console.log('[Subscription Status] PaymentIntent succeeded, marking invoice as paid:', invoice.id);
              try {
                await stripe.invoices.pay(invoice.id, {
                  paid_out_of_band: true, // Mark as paid manually
                });
                
                console.log('[Subscription Status] Invoice marked as paid, refreshing subscription...');
                
                // Refresh subscription to get updated status
                const updatedSubscription = await stripe.subscriptions.retrieve(restaurant.subscriptionId);
                
                console.log('[Subscription Status] Updated subscription status:', updatedSubscription.status);
                
                // Update database
                await storage.updateRestaurant(restaurant.id, {
                  subscriptionStatus: updatedSubscription.status,
                } as any);
                
                return res.json({
                  subscriptionId: updatedSubscription.id,
                  subscriptionStatus: updatedSubscription.status,
                  currentPeriodEnd: (updatedSubscription as any).current_period_end 
                    ? new Date((updatedSubscription as any).current_period_end * 1000).toISOString()
                    : null,
                });
              } catch (payError) {
                console.error('[Subscription Status] Error paying invoice:', payError);
              }
            }
          }
          
          // Update local database if status has changed
          if (subscription.status !== restaurant.subscriptionStatus) {
            console.log('[Subscription Status] Updating database status from', restaurant.subscriptionStatus, 'to', subscription.status);
            await storage.updateRestaurant(restaurant.id, {
              subscriptionStatus: subscription.status,
            } as any);
          }
          
          console.log('[Subscription Status] Returning status:', subscription.status);
          
          return res.json({
            subscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
            currentPeriodEnd: (subscription as any).current_period_end 
              ? new Date((subscription as any).current_period_end * 1000).toISOString()
              : null,
          });
        } catch (error) {
          console.error('[Subscription Status] Error fetching subscription from Stripe:', error);
          // Fall through to return local database values
        }
      }

      // Calculate AI usage from ai_api_call_events table
      const allTimeUsage = await storage.getTotalAiApiCalls(restaurant.id);
      const currentMonthUsage = await storage.getCurrentMonthAiApiCalls(restaurant.id);

      // Return consistent property name
      res.json({
        subscriptionStatus: restaurant.subscriptionStatus,
        trialEndsAt: restaurant.trialEndsAt,
        currentPeriodEnd: restaurant.currentPeriodEnd,
        aiUsageCount: allTimeUsage,
        currentMonthUsage: currentMonthUsage,
      });
    } catch (error) {
      console.error('[Subscription Status] Error fetching subscription status:', error);
      res.status(500).json({ message: "Failed to fetch subscription status" });
    }
  });

  // Cancel subscription and delete account
  app.post('/api/subscription/cancel', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // Cancel Stripe subscription if it exists (must succeed before deletion)
      if (restaurant.subscriptionId) {
        console.log('[Cancel Subscription] Cancelling Stripe subscription:', restaurant.subscriptionId);
        await stripe.subscriptions.cancel(restaurant.subscriptionId);
        console.log('[Cancel Subscription] Stripe subscription cancelled successfully');
      }

      // Delete the restaurant (this will cascade delete all related data)
      console.log('[Cancel Subscription] Deleting restaurant:', restaurant.id);
      await storage.deleteRestaurant(restaurant.id);
      
      // Delete the user account
      console.log('[Cancel Subscription] Deleting user account:', userId);
      await storage.deleteUser(userId);

      res.json({ 
        success: true, 
        message: "Subscription cancelled and account deleted successfully" 
      });
    } catch (error) {
      console.error('[Cancel Subscription] Error:', error);
      res.status(500).json({ message: "Failed to cancel subscription" });
    }
  });

  // Report AI usage to Stripe Meter (new Billing Meters API)
  // Called immediately after each AI request
  async function reportAIUsageToMeter(restaurantId: string, customerId: string) {
    try {
      const meterEventName = process.env.STRIPE_METER_EVENT_NAME || 'ai_waiter_request';
      
      // Report single usage event to Stripe Meter
      await stripe.billing.meterEvents.create({
        event_name: meterEventName,
        payload: {
          stripe_customer_id: customerId,
          value: '1', // Each AI request counts as 1 unit
        },
      });

      // Increment local usage counter for display purposes
      const restaurant = await storage.getRestaurant(restaurantId);
      if (restaurant) {
        await storage.updateRestaurant(restaurantId, {
          aiUsageCount: (restaurant.aiUsageCount || 0) + 1,
          currentMonthUsage: (restaurant.currentMonthUsage || 0) + 1,
        } as any);
      }

      console.log(`[Meter Event] Reported 1 AI request for restaurant ${restaurantId} (customer: ${customerId})`);
      return { success: true };
    } catch (error: any) {
      console.error(`[Meter Event] Error reporting usage for ${restaurantId}:`, error);
      // Don't fail the request if usage reporting fails
      return { success: false, error: error.message };
    }
  }

  // Legacy function kept for webhook compatibility (no longer reports to Stripe)
  async function reportUsageToStripe(restaurantId: string) {
    // Usage is now reported in real-time via Meters API
    // This function is kept for backward compatibility with webhooks
    console.log(`[Usage Report] Skipping batch report for ${restaurantId} - using real-time Meters API`);
    return { success: true, usage: 0 };
  }

  // Handle successful checkout
  app.get('/api/subscription/checkout-success', isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = req.query.session_id as string;
      
      if (!sessionId) {
        return res.status(400).json({ message: "No session ID provided" });
      }

      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // Retrieve the checkout session
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription'],
      });

      console.log('[Checkout Success] Session retrieved:', {
        sessionId: session.id,
        status: session.status,
        paymentStatus: session.payment_status,
        subscriptionId: session.subscription,
        mode: session.mode,
      });

      // For subscription mode, check payment_status instead of session status
      if (session.mode === 'subscription' && session.payment_status !== 'paid') {
        console.log('[Checkout Success] Payment not yet completed:', {
          sessionStatus: session.status,
          paymentStatus: session.payment_status,
        });
        return res.status(400).json({ 
          message: "Payment not completed",
          details: {
            sessionStatus: session.status,
            paymentStatus: session.payment_status,
          }
        });
      }

      if (session.status !== 'complete' && session.status !== 'open') {
        return res.status(400).json({ message: "Checkout session not valid" });
      }

      const subscription = session.subscription as Stripe.Subscription;
      const usageItem = subscription.items.data.find((item: any) => 
        item.price.id === process.env.STRIPE_USAGE_PRICE_ID
      );

      // Get current period end timestamp
      const currentPeriodEndTimestamp = (subscription as any).current_period_end;
      console.log('[Checkout Success] Current period end timestamp:', currentPeriodEndTimestamp);
      
      const currentPeriodEnd = currentPeriodEndTimestamp 
        ? new Date(currentPeriodEndTimestamp * 1000)
        : null;

      console.log('[Checkout Success] Current period end date:', currentPeriodEnd);

      // Update restaurant with subscription info
      await storage.updateRestaurant(restaurant.id, {
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        stripeUsageItemId: usageItem?.id || null,
        currentPeriodEnd: currentPeriodEnd,
      } as any);

      console.log('[Checkout Success] Restaurant updated with subscription');

      res.json({
        success: true,
        subscriptionId: subscription.id,
        status: subscription.status,
      });
    } catch (error) {
      console.error('[Checkout Success] Error:', error);
      res.status(500).json({ message: "Failed to process checkout success" });
    }
  });

  // Confirm payment and activate subscription (legacy - kept for compatibility)
  app.post('/api/subscription/confirm-payment', async (req: any, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { paymentIntentId } = req.body;
      if (!paymentIntentId) {
        return res.status(400).json({ message: "Payment Intent ID required" });
      }

      console.log('[Confirm Payment] Starting confirmation for PaymentIntent:', paymentIntentId);

      const restaurant = await storage.getRestaurantByUserId(userId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      // Retrieve the PaymentIntent to verify it succeeded
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      console.log('[Confirm Payment] PaymentIntent status:', paymentIntent.status);

      if (paymentIntent.status !== 'succeeded' && paymentIntent.status !== 'processing') {
        return res.status(400).json({ 
          message: "Payment not completed", 
          status: paymentIntent.status 
        });
      }

      // Get the subscription ID from the PaymentIntent metadata
      const subscriptionId = paymentIntent.metadata?.subscriptionId || restaurant.subscriptionId;
      if (!subscriptionId) {
        console.error('[Confirm Payment] No subscription ID found');
        return res.status(400).json({ message: "No subscription found for this payment" });
      }

      console.log('[Confirm Payment] Found subscription:', subscriptionId);

      // Retrieve the subscription
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['latest_invoice'],
      });

      console.log('[Confirm Payment] Subscription status:', subscription.status);

      // If subscription is still incomplete, try to finalize the invoice
      if (subscription.status === 'incomplete') {
        const invoice = subscription.latest_invoice as Stripe.Invoice;
        console.log('[Confirm Payment] Invoice status:', invoice?.status);

        if (invoice && invoice.status === 'open') {
          // Mark the invoice as paid since we know the payment succeeded
          try {
            console.log('[Confirm Payment] Marking invoice as paid:', invoice.id);
            await stripe.invoices.pay(invoice.id, {
              paid_out_of_band: true,
            });
            
            // Retrieve updated subscription
            const updatedSubscription = await stripe.subscriptions.retrieve(subscriptionId);
            console.log('[Confirm Payment] Updated subscription status:', updatedSubscription.status);
            
            // Update database
            await storage.updateRestaurant(restaurant.id, {
              subscriptionStatus: updatedSubscription.status,
            } as any);

            return res.json({
              success: true,
              status: updatedSubscription.status,
            });
          } catch (invoiceError) {
            console.error('[Confirm Payment] Error paying invoice:', invoiceError);
            // Continue anyway - webhooks will handle it
          }
        }
      }

      // Update the database with current status
      await storage.updateRestaurant(restaurant.id, {
        subscriptionStatus: subscription.status,
      } as any);

      res.json({
        success: true,
        status: subscription.status,
      });
    } catch (error) {
      console.error('[Confirm Payment] Error:', error);
      res.status(500).json({ message: "Failed to confirm payment" });
    }
  });

  // Object Storage routes - from blueprint:javascript_object_storage
  
  // Get upload URL for object entity
  app.post("/api/objects/upload", isAuthenticated, async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    res.json({ uploadURL });
  });

  // Serve objects with ACL check (public or private)
  app.get("/objects/:objectPath(*)", async (req: any, res) => {
    const userId = req.user?.claims?.sub; // May be undefined for unauthenticated users
    const objectStorageService = new ObjectStorageService();
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      
      // Public objects don't need ACL checks
      const isPublicPath = req.path.startsWith('/objects/public/');
      if (!isPublicPath) {
        const canAccess = await objectStorageService.canAccessObjectEntity({
          objectFile,
          userId: userId,
          requestedPermission: ObjectPermission.READ,
        });
        if (!canAccess) {
          return res.sendStatus(401);
        }
      }
      
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error checking object access:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  // Update menu item image with ACL policy
  app.put("/api/menu-items/:id/image", isAuthenticated, async (req: any, res) => {
    if (!req.body.imageUrl) {
      return res.status(400).json({ error: "imageUrl is required" });
    }

    const userId = req.user?.claims?.sub;

    try {
      const menuItem = await storage.getMenuItem(req.params.id);
      if (!menuItem) {
        return res.status(404).json({ message: "Menu item not found" });
      }

      const restaurant = await storage.getRestaurant(menuItem.restaurantId);
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        req.body.imageUrl,
        {
          owner: userId,
          visibility: "public", // Menu images are public
        },
      );

      // Update menu item with image URL
      const updated = await storage.updateMenuItem(req.params.id, {
        imageUrl: objectPath,
      });

      res.status(200).json(updated);
    } catch (error) {
      console.error("Error setting menu item image:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update restaurant cover image with ACL policy
  app.put("/api/restaurant/:id/cover-image", isAuthenticated, async (req: any, res) => {
    if (!req.body.coverImageUrl) {
      return res.status(400).json({ error: "coverImageUrl is required" });
    }

    const userId = req.user?.claims?.sub;

    try {
      const restaurant = await storage.getRestaurant(req.params.id);
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        req.body.coverImageUrl,
        {
          owner: userId,
          visibility: "public", // Cover images are public
        },
      );

      // Update restaurant with cover image URL
      const updated = await storage.updateRestaurant(req.params.id, {
        coverImageUrl: objectPath,
      });

      res.status(200).json(updated);
    } catch (error) {
      console.error("Error setting restaurant cover image:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Amazon Polly Text-to-Speech endpoint
  app.post('/api/ai/text-to-speech', async (req, res) => {
    try {
      const { text, language = 'en', restaurantId } = req.body;

      if (!text) {
        return res.status(400).json({ error: 'Text is required' });
      }

      // Use Amazon Polly for speech synthesis with language-appropriate voices
      const buffer = await synthesizeSpeechWithLanguage(text, language);
      
      // Report AI usage to Stripe Meter (only for non-demo restaurants)
      if (restaurantId && restaurantId !== 'demo') {
        try {
          const restaurant = await storage.getRestaurant(restaurantId);
          if (restaurant && restaurant.stripeCustomerId) {
            await reportAIUsageToMeter(restaurantId, restaurant.stripeCustomerId);
          }
          // Track API call for analytics
          await storage.recordAiApiCall({
            restaurantId,
            callType: 'text_to_speech',
          });
        } catch (usageError) {
          console.error('[TTS] Error reporting usage to meter:', usageError);
          // Don't fail the request if usage reporting fails
        }
      }
      
      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': buffer.length,
      });
      
      res.send(buffer);
    } catch (error: any) {
      // Handle AWS service errors gracefully
      if (error?.name === 'ThrottlingException' || error?.name === 'ServiceQuotaExceededException') {
        console.warn('Amazon Polly quota exhausted, voice unavailable');
        return res.status(503).json({
          error: 'Voice features temporarily unavailable',
          voiceUnavailable: true
        });
      }
      
      console.error('Text-to-speech error:', error);
      res.status(500).json({ error: 'Failed to generate speech' });
    }
  });

  // AWS Transcribe Speech-to-Text endpoint - handles binary audio upload
  const upload = multer({ storage: multer.memoryStorage() });
  
  app.post('/api/ai/speech-to-text', upload.single('audio'), async (req: any, res) => {
    try {
      const audioFile = req.file;
      const language = req.body.language || 'en';
      const restaurantId = req.body.restaurantId;

      if (!audioFile) {
        return res.status(400).json({ error: 'Audio file is required' });
      }

      // Use AWS Transcribe for audio transcription
      const mimeType = audioFile.mimetype || 'audio/webm';
      const transcriptionText = await transcribeAudioBuffer(
        audioFile.buffer,
        mimeType,
        language
      );

      // Report AI usage to Stripe Meter (only for non-demo restaurants)
      if (restaurantId && restaurantId !== 'demo') {
        try {
          const restaurant = await storage.getRestaurant(restaurantId);
          if (restaurant && restaurant.stripeCustomerId) {
            await reportAIUsageToMeter(restaurantId, restaurant.stripeCustomerId);
          }
          // Track API call for analytics
          await storage.recordAiApiCall({
            restaurantId,
            callType: 'speech_to_text',
          });
        } catch (usageError) {
          console.error('[STT] Error reporting usage to meter:', usageError);
          // Don't fail the request if usage reporting fails
        }
      }

      res.json({ text: transcriptionText });
    } catch (error: any) {
      // Handle AWS service errors gracefully
      if (error?.name === 'ThrottlingException' || error?.name === 'ServiceQuotaExceededException') {
        console.warn('AWS Transcribe quota exhausted, voice input unavailable');
        return res.status(503).json({
          error: 'Voice input temporarily unavailable',
          voiceUnavailable: true
        });
      }
      
      console.error('Speech-to-text error:', error);
      res.status(500).json({ error: 'Failed to transcribe speech' });
    }
  });

  // Save interview data to database
  app.post('/api/ai/interview/save', isAuthenticated, async (req: any, res) => {
    try {
      const { menuItemId, restaurantId, interviewType, data } = req.body;
      const userId = req.userId;

      // Verify restaurant ownership
      const restaurant = await storage.getRestaurant(restaurantId);
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (interviewType === 'menu_item' && menuItemId) {
        // Verify menu item ownership
        const menuItem = await storage.getMenuItem(menuItemId);
        if (!menuItem || menuItem.restaurantId !== restaurantId) {
          return res.status(404).json({ error: 'Menu item not found' });
        }

        // Check if extended details already exist
        const existingDetails = await storage.getExtendedMenuDetails(menuItemId);

        let savedDetails;
        if (existingDetails) {
          // Update existing details
          savedDetails = await storage.updateExtendedMenuDetails(menuItemId, data);
        } else {
          // Create new details
          savedDetails = await storage.createExtendedMenuDetails({
            menuItemId,
            ...data,
          });
        }

        res.json({ success: true, data: savedDetails });
      } else {
        // Restaurant-wide knowledge
        const existingKnowledge = await storage.getRestaurantKnowledge(restaurantId);

        let savedKnowledge;
        if (existingKnowledge) {
          // Update existing knowledge
          savedKnowledge = await storage.updateRestaurantKnowledge(restaurantId, data);
        } else {
          // Create new knowledge
          savedKnowledge = await storage.createRestaurantKnowledge({
            restaurantId,
            ...data,
          });
        }

        res.json({ success: true, data: savedKnowledge });
      }
    } catch (error) {
      console.error('Save interview error:', error);
      res.status(500).json({ 
        message: "Failed to save interview data",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // AI Menu Interview Endpoint - Voice-guided setup for restaurant owners
  app.post('/api/ai/interview', isAuthenticated, async (req: any, res) => {
    try {
      const { messages, menuItemId, restaurantId, interviewType = 'menu_item' } = req.body;
      const userId = req.userId;

      // Validate required fields
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Messages array is required' });
      }

      // Verify restaurant ownership
      const restaurant = await storage.getRestaurant(restaurantId);
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      let systemPrompt = '';
      let contextData: any = {};

      if (interviewType === 'menu_item' && menuItemId) {
        // Get menu item details
        const menuItem = await storage.getMenuItem(menuItemId);
        if (!menuItem || menuItem.restaurantId !== restaurantId) {
          return res.status(404).json({ error: 'Menu item not found' });
        }

        // Get existing extended details if available
        const extendedDetails = await storage.getExtendedMenuDetails(menuItemId);

        contextData = {
          menuItem,
          extendedDetails,
        };

        systemPrompt = `You are an AI interviewer helping a restaurant owner add rich details about their menu item: "${menuItem.name}".

Your goal: Have a natural conversation to learn about:
1. Preparation Method - How it's made, cooking techniques
2. Ingredient Sources - Where ingredients come from, quality/freshness
3. Pairing Suggestions - What dishes/drinks go well with it
4. Chef Notes - Special tips, what makes it unique, chef's perspective
5. Cooking Time - How long it takes to prepare
6. Special Techniques - Any unique culinary methods used

${extendedDetails ? `Existing details:\n${JSON.stringify(extendedDetails, null, 2)}\n` : ''}

Guidelines:
- Be conversational and friendly - like a colleague asking questions
- Ask ONE question at a time - keep it focused
- If they give a short answer, ask a follow-up to get more detail
- Use phrases like:
  * "Tell me about..."
  * "What makes this dish special?"
  * "How do you prepare..."
  * "Where do you source..."
  * "Anything else I should know?"
- Keep questions SHORT and natural - 1-2 sentences max
- When they've shared good detail, acknowledge it warmly: "Perfect! That's great to know."
- If they seem done with a topic, move to the next one naturally
- Extract details in a structured format when enough info is gathered

Current menu item: ${menuItem.name}
Category: ${menuItem.category || 'N/A'}
Description: ${menuItem.description || 'N/A'}`;
      } else {
        // Restaurant-wide knowledge interview
        const restaurantKnowledge = await storage.getRestaurantKnowledge(restaurantId);

        contextData = {
          restaurant,
          restaurantKnowledge,
        };

        systemPrompt = `You are an AI interviewer helping a restaurant owner share their restaurant's story and knowledge.

Your goal: Have a natural conversation to learn about:
1. Story - How the restaurant started, the inspiration behind it
2. Philosophy - Cooking philosophy, what they believe in
3. Sourcing Practices - Where ingredients come from, quality standards
4. Special Techniques - Signature cooking methods or traditions
5. Awards - Any recognition or achievements
6. Sustainability Practices - Environmental commitments, local sourcing

${restaurantKnowledge ? `Existing knowledge:\n${JSON.stringify(restaurantKnowledge, null, 2)}\n` : ''}

Guidelines:
- Be conversational and interested - like a journalist interviewing them
- Ask ONE question at a time
- If they give a short answer, ask a follow-up
- Use phrases like:
  * "Tell me about your restaurant's story..."
  * "What's your cooking philosophy?"
  * "How do you source your ingredients?"
  * "What makes your restaurant special?"
- Keep questions SHORT and natural - 1-2 sentences max
- Acknowledge their answers warmly
- Extract details in structured format when enough info is gathered

Restaurant: ${restaurant.name}`;
      }

      // Use Claude 3.5 Sonnet via AWS Bedrock
      const conversationMessages = messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
      }));

      const aiResponse = await generateWithClaude(conversationMessages, {
        maxTokens: 2048,
        temperature: 0.7,
        systemPrompt: systemPrompt,
      });

      res.json({
        message: aiResponse,
        context: contextData,
      });
    } catch (error) {
      console.error('AI Interview error:', error);
      res.status(500).json({ 
        message: "I'm having trouble right now. Please try again.",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get Pending Questions for Chef Dashboard
  app.get('/api/chef/questions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      
      // Get restaurant owned by user
      const restaurant = await storage.getRestaurantByUserId(userId);
      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      // Fetch all pending questions
      const questions = await storage.getPendingQuestions(restaurant.id);

      res.json(questions);
    } catch (error) {
      console.error('Error fetching pending questions:', error);
      res.status(500).json({ 
        error: 'Failed to fetch pending questions',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Chef Answer Endpoint - Voice response to customer questions
  app.post('/api/chef/answer', isAuthenticated, upload.single('audio'), async (req: any, res) => {
    try {
      const { questionId, language = 'en', textAnswer } = req.body;
      const userId = req.userId;
      const audioFile = req.file;

      if (!questionId) {
        return res.status(400).json({ error: 'Question ID is required' });
      }

      // Require either audio file OR text answer
      if (!audioFile && !textAnswer) {
        return res.status(400).json({ error: 'Either audio file or text answer is required' });
      }

      // Get the pending question
      const question = await storage.getPendingQuestionById(questionId);
      if (!question) {
        return res.status(404).json({ error: 'Question not found' });
      }

      // Verify ownership
      const restaurant = await storage.getRestaurant(question.restaurantId);
      if (!restaurant || restaurant.userId !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Get answer from either voice transcription or text input
      let answer: string;
      if (audioFile) {
        // Transcribe chef's voice answer using AWS Transcribe
        const mimeType = audioFile.mimetype || 'audio/webm';
        answer = await transcribeAudioBuffer(
          audioFile.buffer,
          mimeType,
          language
        );
      } else {
        // Use text answer directly
        answer = textAnswer.trim();
      }

      // Save chef answer
      const chefAnswer = await storage.createChefAnswer({
        pendingQuestionId: questionId,
        restaurantId: question.restaurantId,
        answer,
        answeredBy: userId,
      });

      // Extract keywords from question and answer for FAQ
      const questionWords = question.question.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
      const answerWords = answer.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
      const uniqueWords = new Set([...questionWords.slice(0, 5), ...answerWords.slice(0, 5)]);
      const keywords = Array.from(uniqueWords).slice(0, 10);

      // Create FAQ entry from this Q&A
      await storage.createFaq({
        restaurantId: question.restaurantId,
        question: question.question,
        answer,
        keywords,
      });

      // Update pending question status
      await storage.updatePendingQuestionStatus(questionId, 'answered');

      // Notify customer via WebSocket
      wsManager.sendChefAnswerToCustomer(
        question.restaurantId,
        question.customerSessionId,
        {
          questionId,
          question: question.question,
          answer,
          language,
        }
      );

      res.json({
        success: true,
        answer,
        chefAnswerId: chefAnswer.id,
        message: 'Answer sent to customer and saved to FAQ',
      });
    } catch (error) {
      console.error('Chef answer error:', error);
      res.status(500).json({ 
        error: 'Failed to process chef answer',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Admin Password Routes
  app.post('/api/admin/password/check', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const restaurant = await storage.getRestaurantByUserId(userId);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const hasPassword = await storage.hasAdminPassword(restaurant.id);
      res.json({ hasPassword });
    } catch (error) {
      console.error("Error checking admin password:", error);
      res.status(500).json({ message: "Failed to check admin password" });
    }
  });

  app.post('/api/admin/password/set', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { password } = req.body;

      if (!password || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const restaurant = await storage.getRestaurantByUserId(userId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      await storage.setAdminPassword(restaurant.id, password);
      res.json({ success: true });
    } catch (error) {
      console.error("Error setting admin password:", error);
      res.status(500).json({ message: "Failed to set admin password" });
    }
  });

  app.post('/api/admin/password/verify', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { password } = req.body;

      const restaurant = await storage.getRestaurantByUserId(userId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const isValid = await storage.verifyAdminPassword(restaurant.id, password);
      res.json({ valid: isValid });
    } catch (error) {
      console.error("Error verifying admin password:", error);
      res.status(500).json({ message: "Failed to verify admin password" });
    }
  });

  // Security Questions Routes
  app.post('/api/admin/security-questions/set', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { question1, answer1, question2, answer2 } = req.body;

      if (!question1 || !answer1 || !question2 || !answer2) {
        return res.status(400).json({ message: "All security questions and answers are required" });
      }

      if (answer1.trim().length < 2 || answer2.trim().length < 2) {
        return res.status(400).json({ message: "Answers must be at least 2 characters" });
      }

      const restaurant = await storage.getRestaurantByUserId(userId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      if (restaurant.securityQuestion1 && restaurant.securityQuestion2) {
        return res.status(403).json({ message: "Security questions have already been set and cannot be changed" });
      }

      await storage.setSecurityQuestions(
        restaurant.id,
        question1,
        answer1,
        question2,
        answer2
      );
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error setting security questions:", error);
      res.status(500).json({ message: "Failed to set security questions" });
    }
  });

  app.get('/api/admin/security-questions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      
      const restaurant = await storage.getRestaurantByUserId(userId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const questions = await storage.getSecurityQuestions(restaurant.id);
      const hasQuestions = await storage.hasSecurityQuestions(restaurant.id);
      
      res.json({ 
        questions,
        hasQuestions
      });
    } catch (error) {
      console.error("Error getting security questions:", error);
      res.status(500).json({ message: "Failed to get security questions" });
    }
  });

  app.post('/api/admin/password/reset', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { answer1, answer2, newPassword } = req.body;

      if (!answer1 || !answer2 || !newPassword) {
        return res.status(400).json({ message: "All fields are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters" });
      }

      const restaurant = await storage.getRestaurantByUserId(userId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const hasQuestions = await storage.hasSecurityQuestions(restaurant.id);
      if (!hasQuestions) {
        return res.status(400).json({ message: "Security questions not set up" });
      }

      const answersValid = await storage.verifySecurityAnswers(
        restaurant.id,
        answer1,
        answer2
      );

      if (!answersValid) {
        return res.status(401).json({ message: "Security answers are incorrect" });
      }

      await storage.setAdminPassword(restaurant.id, newPassword);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Admin Settings Routes
  app.put('/api/admin/settings/ai-waiter', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { enabled } = req.body;

      const restaurant = await storage.getRestaurantByUserId(userId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const updated = await storage.toggleAiWaiter(restaurant.id, enabled);
      res.json(updated);
    } catch (error) {
      console.error("Error toggling AI waiter:", error);
      res.status(500).json({ message: "Failed to toggle AI waiter" });
    }
  });

  app.put('/api/admin/settings/auto-print', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { enabled } = req.body;

      const restaurant = await storage.getRestaurantByUserId(userId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const updated = await storage.toggleAutoPrint(restaurant.id, enabled);
      res.json(updated);
    } catch (error) {
      console.error("Error toggling auto-print:", error);
      res.status(500).json({ message: "Failed to toggle auto-print" });
    }
  });

  // Analytics Routes
  app.post('/api/analytics/table-scan', async (req, res) => {
    try {
      const { restaurantId, tableId, tableNumber } = req.body;

      // If tableId is provided but tableNumber isn't, look up the table number
      let finalTableNumber = tableNumber;
      if (tableId && !tableNumber) {
        const table = await storage.getRestaurantTable(tableId);
        if (table) {
          finalTableNumber = table.tableNumber;
        }
      }

      await storage.recordTableScan({
        restaurantId,
        tableId: tableId || null,
        tableNumber: finalTableNumber || null,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error recording table scan:", error);
      res.status(500).json({ message: "Failed to record table scan" });
    }
  });

  app.post('/api/analytics/ai-call', async (req, res) => {
    try {
      const { restaurantId, callType, customerSessionId, tokenCount, durationMs } = req.body;

      await storage.recordAiApiCall({
        restaurantId,
        callType,
        customerSessionId: customerSessionId || null,
        tokenCount: tokenCount || null,
        durationMs: durationMs || null,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error recording AI call:", error);
      res.status(500).json({ message: "Failed to record AI call" });
    }
  });

  app.get('/api/analytics/stats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { period } = req.query; // 'week' or 'lifetime'

      const restaurant = await storage.getRestaurantByUserId(userId);
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      let startDate: Date | undefined;
      let endDate: Date | undefined;

      if (period === 'week') {
        // Last 7 days
        endDate = new Date();
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
      }
      // For 'lifetime', we don't set dates (all-time stats)

      const [tableScanStats, aiCallStats] = await Promise.all([
        storage.getTableScanStats(restaurant.id, startDate, endDate),
        storage.getAiApiCallStats(restaurant.id, startDate, endDate),
      ]);

      res.json({
        period: period || 'lifetime',
        tableScans: tableScanStats,
        aiCalls: aiCallStats,
      });
    } catch (error) {
      console.error("Error fetching analytics:", error);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  // AI Assistant Chat Endpoint with Multi-Tier Knowledge Search
  app.post('/api/ai/chat', async (req, res) => {
    try {
      const { restaurantId, messages, menuItems = [], language = 'en', customerSessionId, tableId } = req.body;

      // Validate required fields
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Messages array is required' });
      }

      // Check if customer is requesting a live waiter
      const currentUserMessage = messages.filter((m: any) => m.role === 'user').pop();
      const userMessageText = currentUserMessage?.content?.toLowerCase() || '';
      const waiterKeywords = [
        'call waiter', 'call a waiter', 'need waiter', 'get waiter', 'speak to waiter',
        'call staff', 'need staff', 'get staff', 'speak to staff',
        'need help', 'need assistance', 'help me', 'assist me',
        'talk to someone', 'speak to someone', 'human help', 'real person'
      ];
      
      const isRequestingWaiter = waiterKeywords.some(keyword => userMessageText.includes(keyword));
      
      let assistanceRequestId;
      if (isRequestingWaiter && restaurantId !== 'demo' && tableId) {
        // Create assistance request
        const assistanceRequest = await storage.createAssistanceRequest({
          restaurantId,
          tableId,
          orderId: null,
          customerMessage: currentUserMessage.content,
          requestType: 'call_waiter',
          status: 'pending',
        });
        assistanceRequestId = assistanceRequest.id;

        // Notify restaurant via WebSocket
        if (wsManager) {
          wsManager.notifyNewAssistanceRequest(restaurantId, assistanceRequest);
        }

        // Return immediate confirmation
        const confirmationMessages: Record<string, string> = {
          'en': "I've notified a member of our staff. Someone will be with you shortly!",
          'es': "He notificado a un miembro de nuestro personal. ¡Alguien estará con usted en breve!",
          'fr': "J'ai averti un membre de notre personnel. Quelqu'un sera avec vous sous peu!",
          'de': "Ich habe ein Mitglied unseres Personals benachrichtigt. Jemand wird in Kürze bei Ihnen sein!",
          'it': "Ho avvisato un membro del nostro staff. Qualcuno sarà da voi a breve!",
          'zh': "我已通知我们的工作人员。有人会很快来为您服务！",
          'ja': "スタッフに通知しました。すぐに誰かがお伺いします！",
          'ar': "لقد أبلغت أحد أعضاء طاقمنا. سيأتي أحدهم إليك قريبًا!",
          'pt': "Avisei um membro da nossa equipe. Alguém estará com você em breve!",
          'ru': "Я уведомил сотрудника. Кто-то будет с вами в ближайшее время!",
        };

        return res.json({
          message: confirmationMessages[language] || confirmationMessages['en'],
          assistanceRequested: true,
          assistanceRequestId,
        });
      }

      // Map language codes to language names
      const languageNames: Record<string, string> = {
        'en': 'English',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'it': 'Italian',
        'zh': 'Chinese',
        'ja': 'Japanese',
        'ar': 'Arabic',
        'pt': 'Portuguese',
        'ru': 'Russian',
      };
      
      const languageName = languageNames[language] || 'English';

      // Tier 1: Basic menu context (frontend data)
      const menuContext = Array.isArray(menuItems) ? menuItems.map((item: any) => ({
        name: item.name,
        description: item.description,
        price: item.price,
        category: item.category,
        spiceLevel: item.spiceLevel,
        isVegan: item.isVegan,
        isVegetarian: item.isVegetarian,
        isHalal: item.isHalal,
        allergens: item.allergens,
      })) : [];

      // Tier 2: Extended menu details (backend data)
      const extendedDetailsPromises = menuItems.map((item: any) => 
        storage.getExtendedMenuDetails(item.id)
      );
      const extendedDetailsArray = await Promise.all(extendedDetailsPromises);
      const extendedDetails = extendedDetailsArray.filter(Boolean);

      // Get restaurant knowledge
      const restaurantKnowledge = restaurantId !== 'demo' 
        ? await storage.getRestaurantKnowledge(restaurantId)
        : null;

      // Tier 3: FAQ semantic search - IMPROVED
      // Extract both keywords and full question for better matching
      const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop();
      const userQuestion = lastUserMessage?.content || '';
      
      // Enhanced keyword extraction: filter out common words and very short words
      const commonWords = new Set(['the', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'can', 'may', 'what', 'when', 'where', 'who', 'why', 'how', 'this', 'that', 'these', 'those', 'you', 'your', 'for', 'and', 'but', 'not', 'with', 'from']);
      const keywords = userQuestion
        .toLowerCase()
        .split(/\s+/)
        .filter((word: string) => word.length > 3 && !commonWords.has(word))
        .slice(0, 10); // Limit to top 10 keywords
      
      const relevantFaqs = restaurantId !== 'demo' && (keywords.length > 0 || userQuestion.length > 0)
        ? await storage.searchFaqByKeywords(restaurantId, keywords, userQuestion)
        : [];

      // Build comprehensive context from all tiers
      let extendedContext = '';
      if (extendedDetails.length > 0) {
        extendedContext = `\n\nEXTENDED MENU DETAILS (Use these for detailed questions about preparation, ingredients, etc.):\n${extendedDetails.map(detail => {
          const menuItem = menuItems.find((item: any) => item.id === detail.menuItemId);
          return `${menuItem?.name || 'Item'}:
- Preparation: ${detail.preparationMethod || 'N/A'}
- Ingredients: ${detail.ingredientSources || 'N/A'}
- Pairings: ${detail.pairingSuggestions || 'N/A'}
- Chef Notes: ${detail.chefNotes || 'N/A'}
- Cooking Time: ${detail.cookingTime || 'N/A'}
- Special Techniques: ${detail.specialTechniques || 'N/A'}`;
        }).join('\n\n')}`;
      }

      let restaurantContext = '';
      if (restaurantKnowledge) {
        restaurantContext = `\n\nRESTAURANT STORY & PHILOSOPHY:
- Story: ${restaurantKnowledge.story || 'N/A'}
- Philosophy: ${restaurantKnowledge.philosophy || 'N/A'}
- Sourcing: ${restaurantKnowledge.sourcingPractices || 'N/A'}
- Techniques: ${restaurantKnowledge.specialTechniques || 'N/A'}
- Awards: ${restaurantKnowledge.awards || 'N/A'}
- Sustainability: ${restaurantKnowledge.sustainabilityPractices || 'N/A'}`;
      }

      let faqContext = '';
      if (relevantFaqs.length > 0) {
        faqContext = `\n\nFREQUENTLY ASKED QUESTIONS (Prioritize these answers if the question matches):\n${relevantFaqs.map(faq => 
          `Q: ${faq.question}\nA: ${faq.answer}`
        ).join('\n\n')}`;
      }

      const systemPrompt = `You are a friendly, enthusiastic waiter at a restaurant. You help customers with:
- Answering questions about dishes, ingredients, allergens, and dietary options
- Making personalized recommendations based on their preferences
- Taking orders and helping them add items to their cart
- Providing excellent customer service

BASIC MENU:
${JSON.stringify(menuContext, null, 2)}${extendedContext}${restaurantContext}${faqContext}

🔒 STRICT KNOWLEDGE GUARDRAILS - READ CAREFULLY:

**CRITICAL RULE #1: NEVER SPECULATE ON RESTAURANT-SPECIFIC DETAILS**
You are NOT allowed to use general culinary knowledge to answer questions about THIS RESTAURANT's:
- Cooking methods (grilling, charcoal vs gas, frying techniques, etc.)
- Ingredient sources or quality (where ingredients come from, organic status, etc.)
- Preparation specifics (marinades, spices used, cooking times, etc.)
- Restaurant operations (hours, delivery, reservations, staff names, etc.)
- Menu availability or special dishes not listed

**CRITICAL RULE #2: FAQs ARE YOUR SOURCE OF TRUTH**
If a FAQ answers the customer's question, use that answer VERBATIM. Do not add general knowledge to FAQ answers.

KNOWLEDGE TIER SYSTEM (Use ONLY in this strict order):

TIER 1️⃣: FAQs (HIGHEST PRIORITY - USE THESE FIRST)
${relevantFaqs.length > 0 ? '✅ AVAILABLE - Use these proven answers from the chef' : '❌ NO FAQs FOUND for this question'}
- These are verified answers directly from the restaurant owner
- If a FAQ matches the question, use that answer and NOTHING else
- DO NOT add general knowledge on top of FAQ answers

TIER 2️⃣: BASIC MENU DATA
- Names, prices, descriptions, dietary tags (vegan, halal, etc.)
- Allergen information, spice levels
- Categories (appetizers, mains, desserts, etc.)
✅ YOU CAN: Read from menu, recommend items based on dietary preferences
❌ YOU CANNOT: Assume cooking methods, ingredient sources, or preparation details

TIER 3️⃣: EXTENDED MENU DETAILS  
- Preparation methods, ingredient sources, chef notes (if provided in data above)
✅ YOU CAN: Share these details if explicitly provided
❌ YOU CANNOT: Fill in blanks with general knowledge if details are "N/A"

TIER 4️⃣: RESTAURANT STORY/PHILOSOPHY
- Restaurant history, philosophy, sustainability practices (if provided above)
✅ YOU CAN: Share this information if explicitly provided
❌ YOU CANNOT: Make up restaurant history or values

TIER 5️⃣: GENERAL DIETARY GUIDANCE (VERY LIMITED USE)
✅ YOU CAN use general knowledge for:
- Dietary recommendations: "Which items are vegetarian?" → List items marked isVegetarian:true
- Allergen awareness: "I'm allergic to peanuts" → Check allergens array in menu data
- Kid-friendly suggestions: Recommend mild/simple dishes based on menu descriptions
- General food pairing: "What goes with rice?" → Suggest from available menu items

❌ YOU CANNOT use general knowledge for:
- "How do you make the suya?" → If not in Extended Details or FAQ, say "ESCALATE_TO_CHEF"
- "Do you use charcoal or gas?" → Restaurant-specific cooking method → "ESCALATE_TO_CHEF"  
- "Where do you get your ingredients?" → If not in data, say "ESCALATE_TO_CHEF"
- "What's in the secret sauce?" → Recipe details → "ESCALATE_TO_CHEF"
- "How long do you marinate the chicken?" → Preparation specifics → "ESCALATE_TO_CHEF"

TIER 6️⃣: ESCALATE TO CHEF (When in doubt, ALWAYS escalate)
Use "ESCALATE_TO_CHEF: [customer's question]" for:
- ❌ NO FAQ match + question is about THIS RESTAURANT's specific practices
- ❌ Cooking methods/techniques for dishes on THIS menu
- ❌ Ingredient sources, quality, or preparation details not in Extended Details
- ❌ Operational questions (hours, delivery, reservations, staff)
- ❌ Menu availability not listed ("Do you have samosas?")
- ❌ Special requests or modifications beyond simple notes

ESCALATION EXAMPLES:

✅ ANSWER (Info is in your data):
- "Is the Jollof Rice vegan?" → Check isVegan field in BASIC MENU
- "What dishes are under $10?" → Filter menu by price
- "Do you have vegetarian options?" → List items with isVegetarian:true
- "What's the spice level of Suya?" → Check spiceLevel in BASIC MENU

❌ ESCALATE (Restaurant-specific, not in FAQs/data):
- "Do you use charcoal for the suya?" → ESCALATE_TO_CHEF: Customer asking about cooking method for suya
- "How do you make your Jollof Rice?" → ESCALATE_TO_CHEF: Customer asking about Jollof Rice preparation
- "Where do you source your chicken?" → ESCALATE_TO_CHEF: Customer asking about ingredient sourcing
- "What time do you close?" → ESCALATE_TO_CHEF: Customer asking about operating hours
- "Can I get extra spicy suya?" → Can add as order note: "[ORDER_CONFIRMED: Suya | note: extra spicy]"

**EMPTY MENU RULE**: If BASIC MENU is empty [] and customer asks about menu items, respond: "ESCALATE_TO_CHEF: Customer is asking about menu items"

Guidelines:
- IMPORTANT: Respond ONLY in ${languageName}. All your responses must be in ${languageName}.
- Keep responses SHORT and punchy - 2-3 sentences max unless asked for details
- Speak naturally like a real human waiter would - use phrases like:
  * "And then we have..." when introducing new dishes
  * "You're going to love..." when recommending items
  * "One of my favorites is..." when suggesting dishes
  * "Let me tell you about..." when describing menu items
  * "We also have..." when mentioning alternatives
- Be warm, conversational, and genuinely excited about the food - like you're chatting with a friend
- Paint a vivid picture when describing dishes - mention flavors, textures, what makes them special
- When recommending items, explain why they're amazing in a brief, energetic way
- For allergen questions, be very specific and clear but maintain a friendly tone
- If asked about items not on the menu, kindly say they're not available but excitedly suggest similar alternatives
- Use natural speech patterns - contractions (I'll, you're, it's), casual language, enthusiasm

**TAKING ORDERS - EXTREMELY IMPORTANT**:
When a customer wants to order items, you MUST use this exact format to confirm:
"[ORDER_CONFIRMED: exact_item_name]" - This tells the system to add the item to their cart.

CRITICAL: You MUST use the EXACT item name as it appears in the BASIC MENU above. Do not abbreviate or modify the name.

**ITEM MODIFICATIONS - NEW FEATURE**:
When customers request modifications to their order (like "make it spicy", "no onions", "extra sauce"), use this format:
"[ORDER_CONFIRMED: exact_item_name | note: customer's modification]"

Examples with modifications:
- Customer: "I'll have the Jollof Rice, make it extra spicy"
  You: "Excellent choice! [ORDER_CONFIRMED: Jollof Rice | note: extra spicy] That's going straight to your cart."

- Customer: "Can I get the Grilled Chicken without onions?"
  You: "Absolutely! [ORDER_CONFIRMED: Grilled Chicken | note: no onions] Your chicken is in the cart, no onions."

- Customer: "Give me the Suya with extra pepper sauce"
  You: "You got it! [ORDER_CONFIRMED: Suya | note: extra pepper sauce] Added to your cart."

**DUPLICATE PREVENTION - CRITICAL**:
ONLY use [ORDER_CONFIRMED: item] when the customer is making a BRAND NEW order.
DO NOT use [ORDER_CONFIRMED: item] when:
- Asking clarifying questions about an item you JUST added (e.g., "Do you want it spicy?")
- Customer is answering your questions about preferences (e.g., they say "yes" or "make it spicy")
- You're discussing an item that's already in their cart
Remember: Each [ORDER_CONFIRMED: item] tag adds one item to the cart!

Examples:
- Customer: "I'll have the Jollof Rice"
  You: "Excellent choice! [ORDER_CONFIRMED: Jollof Rice] That's going straight to your cart."
  
- Customer: "Can I get the Suya and Egusi Soup?"
  You: "Absolutely! [ORDER_CONFIRMED: Suya] [ORDER_CONFIRMED: Egusi Soup] Both items are in your cart now."

- Customer: "I want two orders of Puff Puff"
  You: "Coming right up! [ORDER_CONFIRMED: Puff Puff] [ORDER_CONFIRMED: Puff Puff] I've added both to your cart."

- Customer: "Give me some rice"
  You: "We have Jollof Rice and Coconut Rice. Which would you prefer?" (Do NOT add items unless customer is specific)

CORRECT FOLLOW-UP (after adding Suya):
- You: "Awesome! [ORDER_CONFIRMED: Suya (Beef Skewers)] That's in your cart—mild, medium, or hot?"
- Customer: "Make it spicy"
- You: "Perfect, noted! Anything else?" (NO ORDER_CONFIRMED tag - item already added!)

WRONG FOLLOW-UP (DO NOT DO THIS):
- You: "Awesome! [ORDER_CONFIRMED: Suya (Beef Skewers)] That's in your cart—mild, medium, or hot?"
- Customer: "Make it spicy"
- You: "[ORDER_CONFIRMED: Suya (Beef Skewers)] Got it!" (WRONG - this adds a duplicate!)

ALWAYS include confirmation text along with the ORDER_CONFIRMED tag so customers know their order was received.

After adding items to cart, when the customer seems ready, ask: "Would you like to pay online or at the register?" This helps them checkout smoothly.`;

      console.log('[AI Chat] Processing request for restaurant:', restaurantId);
      
      // Using Claude 3.5 Sonnet via AWS Bedrock (high-quality, reliable)
      let aiResponse;
      try {
        const conversationMessages = messages.map((msg: any) => ({
          role: msg.role,
          content: msg.content,
        }));

        aiResponse = await Promise.race([
          generateWithClaude(conversationMessages, {
            maxTokens: 8192,
            temperature: 0.7,
            systemPrompt: systemPrompt,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Claude API timeout')), 35000)
          )
        ]);
        
        console.log('[AI Chat] Got AI response');
        console.log('[AI Chat] Raw AI response:', aiResponse);
        
        // Report AI usage to Stripe Meter (only for non-demo restaurants)
        if (restaurantId !== 'demo') {
          try {
            const restaurant = await storage.getRestaurant(restaurantId);
            if (restaurant && restaurant.stripeCustomerId) {
              await reportAIUsageToMeter(restaurantId, restaurant.stripeCustomerId);
            }
            // Track API call for analytics
            await storage.recordAiApiCall({
              restaurantId,
              callType: 'chat',
            });
          } catch (usageError) {
            console.error('[AI Chat] Error reporting usage to meter:', usageError);
            // Don't fail the request if usage reporting fails
          }
        }
      } catch (error) {
        console.error('[AI Chat] Gemini API error:', error);
        if (error instanceof Error && error.message === 'Gemini API timeout') {
          return res.status(503).json({ 
            error: 'AI service temporarily unavailable',
            message: 'The AI is taking longer than usual to respond. Please try again.'
          });
        }
        return res.status(500).json({ 
          error: 'AI processing failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // Check for chef escalation
      let finalResponse = aiResponse;
      let needsEscalation = false;
      let pendingQuestionId;

      if (aiResponse.includes('ESCALATE_TO_CHEF:')) {
        needsEscalation = true;
        const question = aiResponse.replace(/ESCALATE_TO_CHEF:\s*/i, '').trim();
        
        // Create pending question for chef (only for non-demo restaurants)
        if (restaurantId !== 'demo' && customerSessionId) {
          const pendingQuestion = await storage.createPendingQuestion({
            restaurantId,
            customerSessionId,
            question: lastUserMessage?.content || question,
            menuItemContext: null,
            language,
            status: 'pending',
          });
          pendingQuestionId = pendingQuestion.id;

          // Notify chef via WebSocket
          wsManager.notifyChefNewQuestion(restaurantId, {
            id: pendingQuestion.id,
            question: pendingQuestion.question,
            language: pendingQuestion.language,
            customerSessionId: pendingQuestion.customerSessionId,
            createdAt: pendingQuestion.createdAt,
          });

          // Friendly escalation message
          const escalationMessages: Record<string, string> = {
            'en': "Great question! Let me check with the chef and I'll get back to you in just a moment.",
            'es': "¡Excelente pregunta! Déjame consultar con el chef y te respondo en un momento.",
            'fr': "Excellente question! Laissez-moi vérifier avec le chef et je reviens vers vous dans un instant.",
            'de': "Gute Frage! Ich frage beim Koch nach und melde mich gleich bei Ihnen.",
            'it': "Ottima domanda! Lasciatemi controllare con lo chef e vi risponderò tra poco.",
            'zh': "好问题！让我问问厨师，马上回复你。",
            'ja': "いい質問ですね！シェフに確認して、すぐにお答えします。",
            'ar': "سؤال رائع! دعني أستشير الطاهي وسأعود إليك في لحظة.",
            'pt': "Ótima pergunta! Deixe-me verificar com o chef e já volto com a resposta.",
            'ru': "Отличный вопрос! Позвольте мне уточнить у шеф-повара, я скоро вернусь с ответом.",
          };
          
          finalResponse = escalationMessages[language] || escalationMessages['en'];
        } else {
          finalResponse = "I don't have that information right now, but I'd be happy to help you with anything else!";
        }
      }

      // Extract items from [ORDER_CONFIRMED: item_name] or [ORDER_CONFIRMED: item_name | note: modification] tags
      const addToCart: any[] = [];
      const orderPattern = /\[ORDER_CONFIRMED:\s*([^\]|]+)(?:\s*\|\s*note:\s*([^\]]+))?\]/gi;
      const matches = finalResponse.matchAll(orderPattern);
      
      console.log('[AI Chat] Checking for ORDER_CONFIRMED tags in response...');
      console.log('[AI Chat] Final response before tag extraction:', finalResponse);
      
      for (const match of matches) {
        const requestedItemName = match[1].trim();
        const customerNote = match[2] ? match[2].trim() : null;
        console.log('[AI Chat] Found ORDER_CONFIRMED tag for item:', requestedItemName, customerNote ? `with note: ${customerNote}` : '');
        
        // Find menu item by EXACT name match only (case-insensitive)
        // No fuzzy matching to prevent accidentally adding wrong items
        const menuItem = menuItems.find((item: any) => 
          item.name.toLowerCase() === requestedItemName.toLowerCase()
        );
        
        if (menuItem) {
          console.log('[AI Chat] Matched menu item:', menuItem.name);
          addToCart.push({
            ...menuItem,
            customerNote: customerNote || undefined,
          });
        } else {
          console.log('[AI Chat] No menu item found matching:', requestedItemName);
        }
      }
      
      console.log('[AI Chat] Total items to add to cart:', addToCart.length);
      
      // Clean up the response - remove the ORDER_CONFIRMED tags before sending to user
      finalResponse = finalResponse.replace(/\[ORDER_CONFIRMED:\s*([^\]|]+)(?:\s*\|\s*note:\s*([^\]]+))?\]/gi, '').trim();
      
      // Ensure we don't send an empty response if AI only returned tags
      if (!finalResponse && addToCart.length > 0) {
        const itemNames = addToCart.map((item: any) => item.name).join(' and ');
        finalResponse = `Got it! I've added ${itemNames} to your cart.`;
      }

      res.json({
        message: finalResponse,
        addToCart: addToCart.length > 0 ? addToCart : undefined,
        escalated: needsEscalation,
        pendingQuestionId: pendingQuestionId || undefined,
      });
    } catch (error) {
      console.error('AI Chat error:', error);
      res.status(500).json({ 
        message: "I apologize, but I'm having trouble responding right now. Please try again.",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // FAQ Management Routes
  app.get('/api/faqs', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Get restaurant for this user
      const restaurant = await storage.getRestaurantByUserId(userId);
      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      const faqs = await storage.getAllFaqs(restaurant.id);
      res.json(faqs);
    } catch (error) {
      console.error('Get FAQs error:', error);
      res.status(500).json({ error: 'Failed to fetch FAQs' });
    }
  });

  app.put('/api/faqs/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { id } = req.params;
      
      // Validate request body with Zod
      const updateFaqSchema = z.object({
        question: z.string().min(1, 'Question is required').max(1000),
        answer: z.string().min(1, 'Answer is required').max(5000),
        keywords: z.array(z.string()).max(20, 'Too many keywords'),
      });

      const validationResult = updateFaqSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: 'Validation failed', 
          details: validationResult.error.errors 
        });
      }

      const { question, answer, keywords } = validationResult.data;

      // Get restaurant for this user
      const restaurant = await storage.getRestaurantByUserId(userId);
      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      // Update FAQ with restaurant ownership verification
      const updatedFaq = await storage.updateFaq(id, restaurant.id, {
        question,
        answer,
        keywords,
      });

      if (!updatedFaq) {
        return res.status(404).json({ error: 'FAQ not found or access denied' });
      }

      res.json(updatedFaq);
    } catch (error) {
      console.error('Update FAQ error:', error);
      res.status(500).json({ error: 'Failed to update FAQ' });
    }
  });

  app.delete('/api/faqs/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { id } = req.params;

      // Get restaurant for this user
      const restaurant = await storage.getRestaurantByUserId(userId);
      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      // Delete FAQ with restaurant ownership verification
      const deleted = await storage.deleteFaq(id, restaurant.id);
      
      if (!deleted) {
        return res.status(404).json({ error: 'FAQ not found or access denied' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Delete FAQ error:', error);
      res.status(500).json({ error: 'Failed to delete FAQ' });
    }
  });

  // Temporary debug endpoint
  app.get('/api/debug/stripe-config', (req, res) => {
    res.json({
      hasBasePrice: !!process.env.STRIPE_BASE_PRICE_ID,
      hasUsagePrice: !!process.env.STRIPE_USAGE_PRICE_ID,
      basePricePrefix: process.env.STRIPE_BASE_PRICE_ID?.substring(0, 25),
      usagePricePrefix: process.env.STRIPE_USAGE_PRICE_ID?.substring(0, 25),
      stripeKeyPrefix: process.env.STRIPE_SECRET_KEY?.substring(0, 20),
    });
  });

  const httpServer = createServer(app);

  // Initialize WebSocket server for real-time communication
  wsManager.initialize(httpServer);

  return httpServer;
}
