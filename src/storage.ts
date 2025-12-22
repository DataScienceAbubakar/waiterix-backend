import { db } from "./db";
import { users, restaurants, menuItems, orders, orderItems, restaurantTables, extendedMenuDetails, restaurantKnowledge, faqKnowledgeBase, pendingQuestions, chefAnswers, tableScanEvents, aiApiCallEvents, ratings, assistanceRequests } from "@/shared/schema";
import type { User, UpsertUser, Restaurant, InsertRestaurant, MenuItem, InsertMenuItem, Order, InsertOrder, OrderItem, InsertOrderItem, OrderWithTable, RestaurantTable, InsertRestaurantTable, ExtendedMenuDetails, InsertExtendedMenuDetails, RestaurantKnowledge, InsertRestaurantKnowledge, FaqKnowledgeBase, InsertFaqKnowledgeBase, PendingQuestion, InsertPendingQuestion, ChefAnswer, InsertChefAnswer, TableScanEvent, InsertTableScanEvent, AiApiCallEvent, InsertAiApiCallEvent, Rating, InsertRating, AssistanceRequest, InsertAssistanceRequest, AssistanceRequestWithTable } from "@/shared/schema";
import { eq, and, sql, gte, lte, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";

export interface IStorage {
  // User operations for Replit Auth
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  acceptTerms(userId: string): Promise<User>;
  deleteUser(userId: string): Promise<void>;

  // Restaurant operations
  getRestaurant(id: string): Promise<Restaurant | undefined>;
  getRestaurantByUserId(userId: string): Promise<Restaurant | undefined>;
  getAllRestaurants(): Promise<Restaurant[]>;
  createRestaurant(restaurant: InsertRestaurant): Promise<Restaurant>;
  updateRestaurant(id: string, restaurant: Partial<InsertRestaurant>): Promise<Restaurant>;
  deleteRestaurant(id: string): Promise<void>;

  // Menu item operations
  getMenuItems(restaurantId: string): Promise<MenuItem[]>;
  getMenuItem(id: string): Promise<MenuItem | undefined>;
  createMenuItem(menuItem: InsertMenuItem): Promise<MenuItem>;
  updateMenuItem(id: string, menuItem: Partial<InsertMenuItem>): Promise<MenuItem>;
  deleteMenuItem(id: string): Promise<void>;

  // Order operations
  getOrders(restaurantId: string): Promise<OrderWithTable[]>;
  getOrder(id: string): Promise<Order | undefined>;
  createOrder(order: InsertOrder, items: InsertOrderItem[]): Promise<Order>;
  getOrderByStripePaymentIntent(paymentIntentId: string): Promise<Order | undefined>;
  updateOrder(id: string, orderData: Partial<InsertOrder>): Promise<Order>;
  updateOrderStatus(id: string, status: string): Promise<Order>;
  getOrderItems(orderId: string): Promise<OrderItem[]>;
  deleteOldCompletedOrders(restaurantId: string, olderThan: Date): Promise<void>;

  // Restaurant table operations
  getRestaurantTables(restaurantId: string): Promise<RestaurantTable[]>;
  getRestaurantTable(id: string): Promise<RestaurantTable | undefined>;
  getTableByNumber(restaurantId: string, tableNumber: string): Promise<RestaurantTable | undefined>;
  createRestaurantTable(table: InsertRestaurantTable): Promise<RestaurantTable>;
  updateRestaurantTable(id: string, table: Partial<InsertRestaurantTable>): Promise<RestaurantTable>;
  deleteRestaurantTable(id: string): Promise<void>;

  // Extended menu details operations
  getExtendedMenuDetails(menuItemId: string): Promise<ExtendedMenuDetails | undefined>;
  createExtendedMenuDetails(details: InsertExtendedMenuDetails): Promise<ExtendedMenuDetails>;
  updateExtendedMenuDetails(menuItemId: string, details: Partial<InsertExtendedMenuDetails>): Promise<ExtendedMenuDetails>;

  // Restaurant knowledge operations
  getRestaurantKnowledge(restaurantId: string): Promise<RestaurantKnowledge | undefined>;
  createRestaurantKnowledge(knowledge: InsertRestaurantKnowledge): Promise<RestaurantKnowledge>;
  updateRestaurantKnowledge(restaurantId: string, knowledge: Partial<InsertRestaurantKnowledge>): Promise<RestaurantKnowledge>;

  // FAQ knowledge base operations
  searchFaqByKeywords(restaurantId: string, keywords: string[], fullQuestion?: string): Promise<FaqKnowledgeBase[]>;
  getAllFaqs(restaurantId: string): Promise<FaqKnowledgeBase[]>;
  createFaq(faq: InsertFaqKnowledgeBase): Promise<FaqKnowledgeBase>;
  updateFaq(id: string, restaurantId: string, faq: Partial<InsertFaqKnowledgeBase>): Promise<FaqKnowledgeBase | null>;
  incrementFaqUsage(id: string): Promise<void>;
  deleteFaq(id: string, restaurantId: string): Promise<boolean>;

  // Pending questions operations
  createPendingQuestion(question: InsertPendingQuestion): Promise<PendingQuestion>;
  getPendingQuestions(restaurantId: string): Promise<PendingQuestion[]>;
  getPendingQuestionById(id: string): Promise<PendingQuestion | undefined>;
  updatePendingQuestionStatus(id: string, status: string): Promise<PendingQuestion>;
  deletePendingQuestion(id: string, restaurantId: string): Promise<boolean>;

  // Chef answers operations
  createChefAnswer(answer: InsertChefAnswer): Promise<ChefAnswer>;
  getChefAnswerByQuestionId(pendingQuestionId: string): Promise<ChefAnswer | undefined>;

  // Admin password operations
  setAdminPassword(restaurantId: string, password: string): Promise<void>;
  verifyAdminPassword(restaurantId: string, password: string): Promise<boolean>;
  hasAdminPassword(restaurantId: string): Promise<boolean>;

  // Restaurant settings operations
  toggleAiWaiter(restaurantId: string, enabled: boolean): Promise<Restaurant>;
  toggleAutoPrint(restaurantId: string, enabled: boolean): Promise<Restaurant>;

  // Analytics operations
  recordTableScan(event: InsertTableScanEvent): Promise<TableScanEvent>;
  recordAiApiCall(event: InsertAiApiCallEvent): Promise<AiApiCallEvent>;
  getTableScanStats(restaurantId: string, startDate?: Date, endDate?: Date): Promise<{
    totalScans: number;
    scansByTable: { tableNumber: string; count: number }[];
  }>;
  getAiApiCallStats(restaurantId: string, startDate?: Date, endDate?: Date): Promise<{
    totalCalls: number;
    callsByType: { callType: string; count: number }[];
  }>;
  getTotalAiApiCalls(restaurantId: string): Promise<number>;
  getCurrentMonthAiApiCalls(restaurantId: string): Promise<number>;

  // Rating operations
  createRating(rating: InsertRating): Promise<Rating>;
  getRatingsByOrder(orderId: string): Promise<Rating[]>;
  getRatingsByRestaurant(restaurantId: string): Promise<Rating[]>;
  hasOrderBeenRated(orderId: string): Promise<boolean>;

  // Assistance request operations
  createAssistanceRequest(request: InsertAssistanceRequest): Promise<AssistanceRequest>;
  getAssistanceRequests(restaurantId: string, status?: string): Promise<AssistanceRequestWithTable[]>;
  getAssistanceRequest(id: string): Promise<AssistanceRequest | undefined>;
  updateAssistanceRequestStatus(id: string, status: string): Promise<AssistanceRequest>;
}

export class DatabaseStorage implements IStorage {
  // User operations for Replit Auth
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.email,
        set: {
          // Exclude id from update to preserve existing user ID and foreign key references
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async acceptTerms(userId: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({
        acceptedTerms: true,
        acceptedTermsAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async deleteUser(userId: string): Promise<void> {
    // This will cascade delete all related data (restaurants, orders, etc.)
    await db.delete(users).where(eq(users.id, userId));
  }

  // Restaurant operations
  async getRestaurant(id: string): Promise<Restaurant | undefined> {
    const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, id));
    return restaurant;
  }

  async getRestaurantByUserId(userId: string): Promise<Restaurant | undefined> {
    const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.userId, userId));
    return restaurant;
  }

  async getAllRestaurants(): Promise<Restaurant[]> {
    return await db.select().from(restaurants);
  }

  async createRestaurant(restaurantData: InsertRestaurant): Promise<Restaurant> {
    const [restaurant] = await db.insert(restaurants).values(restaurantData).returning();
    return restaurant;
  }

  async updateRestaurant(id: string, restaurantData: Partial<InsertRestaurant>): Promise<Restaurant> {
    const [restaurant] = await db
      .update(restaurants)
      .set(restaurantData)
      .where(eq(restaurants.id, id))
      .returning();
    return restaurant;
  }

  async deleteRestaurant(id: string): Promise<void> {
    await db.delete(restaurants).where(eq(restaurants.id, id));
  }

  // Menu item operations
  async getMenuItems(restaurantId: string): Promise<MenuItem[]> {
    return await db.select().from(menuItems).where(eq(menuItems.restaurantId, restaurantId));
  }

  async getMenuItem(id: string): Promise<MenuItem | undefined> {
    const [menuItem] = await db.select().from(menuItems).where(eq(menuItems.id, id));
    return menuItem;
  }

  async createMenuItem(menuItemData: InsertMenuItem): Promise<MenuItem> {
    const [menuItem] = await db
      .insert(menuItems)
      .values(menuItemData)
      .returning();
    return menuItem;
  }

  async updateMenuItem(id: string, menuItemData: Partial<InsertMenuItem>): Promise<MenuItem> {
    const [menuItem] = await db
      .update(menuItems)
      .set(menuItemData)
      .where(eq(menuItems.id, id))
      .returning();
    return menuItem;
  }

  async deleteMenuItem(id: string): Promise<void> {
    await db.delete(menuItems).where(eq(menuItems.id, id));
  }

  // Order operations
  async getOrders(restaurantId: string): Promise<OrderWithTable[]> {
    const result = await db
      .select({
        id: orders.id,
        restaurantId: orders.restaurantId,
        tableId: orders.tableId,
        customerNote: orders.customerNote,
        paymentMethod: orders.paymentMethod,
        paymentStatus: orders.paymentStatus,
        paymentGateway: orders.paymentGateway,
        stripePaymentIntentId: orders.stripePaymentIntentId,
        paystackReference: orders.paystackReference,
        telrTransactionRef: orders.telrTransactionRef,
        adyenPspReference: orders.adyenPspReference,
        subtotal: orders.subtotal,
        tax: orders.tax,
        tip: orders.tip,
        total: orders.total,
        status: orders.status,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        tableNumber: restaurantTables.tableNumber,
      })
      .from(orders)
      .leftJoin(restaurantTables, eq(orders.tableId, restaurantTables.id))
      .where(eq(orders.restaurantId, restaurantId))
      .orderBy(desc(orders.createdAt));

    return result as OrderWithTable[];
  }

  async getOrder(id: string): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    return order;
  }

  async getOrderByStripePaymentIntent(paymentIntentId: string): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, paymentIntentId));
    return order;
  }

  async createOrder(orderData: InsertOrder, items: InsertOrderItem[]): Promise<Order> {
    const [order] = await db.insert(orders).values(orderData).returning();

    await db.insert(orderItems).values(
      items.map(item => ({
        ...item,
        orderId: order.id,
      }))
    );

    return order;
  }

  async updateOrder(id: string, orderData: Partial<InsertOrder>): Promise<Order> {
    const [order] = await db
      .update(orders)
      .set({ ...orderData, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();
    return order;
  }

  async updateOrderStatus(id: string, status: string): Promise<Order> {
    const [order] = await db
      .update(orders)
      .set({ status, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();
    return order;
  }

  async getOrderItems(orderId: string): Promise<OrderItem[]> {
    return await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  }

  async deleteOldCompletedOrders(restaurantId: string, olderThan: Date): Promise<void> {
    // Delete orders that are completed and older than the specified date
    await db.delete(orders).where(
      and(
        eq(orders.restaurantId, restaurantId),
        eq(orders.status, 'completed'),
        lte(orders.createdAt, olderThan)
      )
    );
  }

  // Restaurant table operations
  async getRestaurantTables(restaurantId: string): Promise<RestaurantTable[]> {
    return await db.select().from(restaurantTables)
      .where(eq(restaurantTables.restaurantId, restaurantId))
      .orderBy(sql`CAST(${restaurantTables.tableNumber} AS INTEGER)`);
  }

  async getRestaurantTable(id: string): Promise<RestaurantTable | undefined> {
    const [table] = await db.select().from(restaurantTables).where(eq(restaurantTables.id, id));
    return table;
  }

  async getTableByNumber(restaurantId: string, tableNumber: string): Promise<RestaurantTable | undefined> {
    const [table] = await db.select().from(restaurantTables)
      .where(and(
        eq(restaurantTables.restaurantId, restaurantId),
        eq(restaurantTables.tableNumber, tableNumber)
      ));
    return table;
  }

  async createRestaurantTable(tableData: InsertRestaurantTable): Promise<RestaurantTable> {
    const [table] = await db.insert(restaurantTables).values(tableData).returning();
    return table;
  }

  async updateRestaurantTable(id: string, tableData: Partial<InsertRestaurantTable>): Promise<RestaurantTable> {
    const [table] = await db
      .update(restaurantTables)
      .set(tableData)
      .where(eq(restaurantTables.id, id))
      .returning();
    return table;
  }

  async deleteRestaurantTable(id: string): Promise<void> {
    await db.delete(restaurantTables).where(eq(restaurantTables.id, id));
  }

  // Extended menu details operations
  async getExtendedMenuDetails(menuItemId: string): Promise<ExtendedMenuDetails | undefined> {
    const [details] = await db.select().from(extendedMenuDetails).where(eq(extendedMenuDetails.menuItemId, menuItemId));
    return details;
  }

  async createExtendedMenuDetails(detailsData: InsertExtendedMenuDetails): Promise<ExtendedMenuDetails> {
    const [details] = await db.insert(extendedMenuDetails).values(detailsData).returning();
    return details;
  }

  async updateExtendedMenuDetails(menuItemId: string, detailsData: Partial<InsertExtendedMenuDetails>): Promise<ExtendedMenuDetails> {
    const [details] = await db
      .update(extendedMenuDetails)
      .set({ ...detailsData, updatedAt: new Date() })
      .where(eq(extendedMenuDetails.menuItemId, menuItemId))
      .returning();
    return details;
  }

  // Restaurant knowledge operations
  async getRestaurantKnowledge(restaurantId: string): Promise<RestaurantKnowledge | undefined> {
    const [knowledge] = await db.select().from(restaurantKnowledge).where(eq(restaurantKnowledge.restaurantId, restaurantId));
    return knowledge;
  }

  async createRestaurantKnowledge(knowledgeData: InsertRestaurantKnowledge): Promise<RestaurantKnowledge> {
    const [knowledge] = await db.insert(restaurantKnowledge).values(knowledgeData).returning();
    return knowledge;
  }

  async updateRestaurantKnowledge(restaurantId: string, knowledgeData: Partial<InsertRestaurantKnowledge>): Promise<RestaurantKnowledge> {
    const [knowledge] = await db
      .update(restaurantKnowledge)
      .set({ ...knowledgeData, updatedAt: new Date() })
      .where(eq(restaurantKnowledge.restaurantId, restaurantId))
      .returning();
    return knowledge;
  }

  // FAQ knowledge base operations  
  async searchFaqByKeywords(restaurantId: string, keywords: string[], fullQuestion?: string): Promise<FaqKnowledgeBase[]> {
    if (keywords.length === 0 && !fullQuestion) {
      return [];
    }

    // Enhanced FAQ matching with question similarity
    const faqs = await db
      .select()
      .from(faqKnowledgeBase)
      .where(eq(faqKnowledgeBase.restaurantId, restaurantId));

    // Score FAQs based on multiple factors
    const scoredFaqs = faqs.map(faq => {
      let score = 0;
      const faqKeywords = faq.keywords || [];
      const faqText = `${faq.question} ${faq.answer}`.toLowerCase();
      const questionLower = faq.question.toLowerCase();
      const fullQuestionLower = fullQuestion?.toLowerCase() || '';

      // Factor 1: Keyword matches in FAQ keywords array (highest weight)
      keywords.forEach(keyword => {
        const keywordLower = keyword.toLowerCase();
        if (faqKeywords.some(k => k.toLowerCase().includes(keywordLower))) {
          score += 5;
        }
      });

      // Factor 2: Keyword matches in question/answer text
      keywords.forEach(keyword => {
        const keywordLower = keyword.toLowerCase();
        if (questionLower.includes(keywordLower)) {
          score += 3; // Questions are more relevant than answers
        } else if (faqText.includes(keywordLower)) {
          score += 1;
        }
      });

      // Factor 3: Question similarity (if full question provided)
      if (fullQuestion && fullQuestionLower.length > 0) {
        // Simple word overlap similarity
        const questionWords = fullQuestionLower.split(/\s+/).filter(w => w.length > 3);
        const faqQuestionWords = questionLower.split(/\s+/).filter(w => w.length > 3);

        const overlap = questionWords.filter(word =>
          faqQuestionWords.some(faqWord => faqWord.includes(word) || word.includes(faqWord))
        ).length;

        score += overlap * 2;
      }

      return { faq, score };
    });

    // Return FAQs with score > 0, sorted by score (top 10 for better coverage)
    return scoredFaqs
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10) // Return top 10 matches for comprehensive coverage
      .map(item => item.faq);
  }

  async getAllFaqs(restaurantId: string): Promise<FaqKnowledgeBase[]> {
    return await db.select().from(faqKnowledgeBase).where(eq(faqKnowledgeBase.restaurantId, restaurantId));
  }

  async createFaq(faqData: InsertFaqKnowledgeBase): Promise<FaqKnowledgeBase> {
    const [faq] = await db.insert(faqKnowledgeBase).values(faqData).returning();
    return faq;
  }

  async updateFaq(id: string, restaurantId: string, faqData: Partial<InsertFaqKnowledgeBase>): Promise<FaqKnowledgeBase | null> {
    const [faq] = await db
      .update(faqKnowledgeBase)
      .set({ ...faqData, updatedAt: new Date() })
      .where(and(
        eq(faqKnowledgeBase.id, id),
        eq(faqKnowledgeBase.restaurantId, restaurantId)
      ))
      .returning();
    return faq || null;
  }

  async incrementFaqUsage(id: string): Promise<void> {
    await db
      .update(faqKnowledgeBase)
      .set({ usageCount: sql`${faqKnowledgeBase.usageCount} + 1` })
      .where(eq(faqKnowledgeBase.id, id));
  }

  async deleteFaq(id: string, restaurantId: string): Promise<boolean> {
    const result = await db
      .delete(faqKnowledgeBase)
      .where(and(
        eq(faqKnowledgeBase.id, id),
        eq(faqKnowledgeBase.restaurantId, restaurantId)
      ))
      .returning();
    return result.length > 0;
  }

  // Pending questions operations
  async createPendingQuestion(questionData: InsertPendingQuestion): Promise<PendingQuestion> {
    const [question] = await db.insert(pendingQuestions).values(questionData).returning();
    return question;
  }

  async getPendingQuestions(restaurantId: string): Promise<PendingQuestion[]> {
    return await db
      .select()
      .from(pendingQuestions)
      .where(and(
        eq(pendingQuestions.restaurantId, restaurantId),
        eq(pendingQuestions.status, 'pending')
      ));
  }

  async getPendingQuestionById(id: string): Promise<PendingQuestion | undefined> {
    const [question] = await db
      .select()
      .from(pendingQuestions)
      .where(eq(pendingQuestions.id, id));
    return question;
  }

  async updatePendingQuestionStatus(id: string, status: string): Promise<PendingQuestion> {
    const [question] = await db
      .update(pendingQuestions)
      .set({ status })
      .where(eq(pendingQuestions.id, id))
      .returning();
    return question;
  }

  async deletePendingQuestion(id: string, restaurantId: string): Promise<boolean> {
    const result = await db
      .delete(pendingQuestions)
      .where(
        and(
          eq(pendingQuestions.id, id),
          eq(pendingQuestions.restaurantId, restaurantId)
        )
      )
      .returning();
    return result.length > 0;
  }

  // Chef answers operations
  async createChefAnswer(answerData: InsertChefAnswer): Promise<ChefAnswer> {
    const [answer] = await db.insert(chefAnswers).values(answerData).returning();
    return answer;
  }

  async getChefAnswerByQuestionId(pendingQuestionId: string): Promise<ChefAnswer | undefined> {
    const [answer] = await db
      .select()
      .from(chefAnswers)
      .where(eq(chefAnswers.pendingQuestionId, pendingQuestionId));
    return answer;
  }

  // Admin password operations
  async setAdminPassword(restaurantId: string, password: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db
      .update(restaurants)
      .set({ adminPassword: hashedPassword })
      .where(eq(restaurants.id, restaurantId));
  }

  async verifyAdminPassword(restaurantId: string, password: string): Promise<boolean> {
    const restaurant = await this.getRestaurant(restaurantId);
    if (!restaurant || !restaurant.adminPassword) {
      return false;
    }
    return await bcrypt.compare(password, restaurant.adminPassword);
  }

  async hasAdminPassword(restaurantId: string): Promise<boolean> {
    const restaurant = await this.getRestaurant(restaurantId);
    return !!(restaurant && restaurant.adminPassword);
  }

  // Security questions operations
  async setSecurityQuestions(
    restaurantId: string,
    question1: string,
    answer1: string,
    question2: string,
    answer2: string
  ): Promise<void> {
    const hashedAnswer1 = await bcrypt.hash(answer1.toLowerCase().trim(), 10);
    const hashedAnswer2 = await bcrypt.hash(answer2.toLowerCase().trim(), 10);

    await db
      .update(restaurants)
      .set({
        securityQuestion1: question1,
        securityAnswer1: hashedAnswer1,
        securityQuestion2: question2,
        securityAnswer2: hashedAnswer2,
      })
      .where(eq(restaurants.id, restaurantId));
  }

  async getSecurityQuestions(restaurantId: string): Promise<{ question1: string | null; question2: string | null } | null> {
    const restaurant = await this.getRestaurant(restaurantId);
    if (!restaurant) {
      return null;
    }
    return {
      question1: restaurant.securityQuestion1,
      question2: restaurant.securityQuestion2,
    };
  }

  async verifySecurityAnswers(
    restaurantId: string,
    answer1: string,
    answer2: string
  ): Promise<boolean> {
    const restaurant = await this.getRestaurant(restaurantId);
    if (!restaurant || !restaurant.securityAnswer1 || !restaurant.securityAnswer2) {
      return false;
    }

    const answer1Valid = await bcrypt.compare(
      answer1.toLowerCase().trim(),
      restaurant.securityAnswer1
    );
    const answer2Valid = await bcrypt.compare(
      answer2.toLowerCase().trim(),
      restaurant.securityAnswer2
    );

    return answer1Valid && answer2Valid;
  }

  async hasSecurityQuestions(restaurantId: string): Promise<boolean> {
    const restaurant = await this.getRestaurant(restaurantId);
    return !!(
      restaurant &&
      restaurant.securityQuestion1 &&
      restaurant.securityAnswer1 &&
      restaurant.securityQuestion2 &&
      restaurant.securityAnswer2
    );
  }

  // Restaurant settings operations
  async toggleAiWaiter(restaurantId: string, enabled: boolean): Promise<Restaurant> {
    const [restaurant] = await db
      .update(restaurants)
      .set({ aiWaiterEnabled: enabled })
      .where(eq(restaurants.id, restaurantId))
      .returning();
    return restaurant;
  }

  async toggleAutoPrint(restaurantId: string, enabled: boolean): Promise<Restaurant> {
    const [restaurant] = await db
      .update(restaurants)
      .set({ autoPrintOrders: enabled })
      .where(eq(restaurants.id, restaurantId))
      .returning();
    return restaurant;
  }

  // Analytics operations
  async recordTableScan(eventData: InsertTableScanEvent): Promise<TableScanEvent> {
    const [event] = await db.insert(tableScanEvents).values(eventData).returning();
    return event;
  }

  async recordAiApiCall(eventData: InsertAiApiCallEvent): Promise<AiApiCallEvent> {
    const [event] = await db.insert(aiApiCallEvents).values(eventData).returning();
    return event;
  }

  async getTableScanStats(restaurantId: string, startDate?: Date, endDate?: Date): Promise<{
    totalScans: number;
    scansByTable: { tableNumber: string; count: number }[];
  }> {
    let whereCondition;

    if (startDate && endDate) {
      whereCondition = and(
        eq(tableScanEvents.restaurantId, restaurantId),
        gte(tableScanEvents.scannedAt, startDate),
        lte(tableScanEvents.scannedAt, endDate)
      );
    } else {
      whereCondition = eq(tableScanEvents.restaurantId, restaurantId);
    }

    const scans = await db
      .select()
      .from(tableScanEvents)
      .where(whereCondition);

    const scansByTable = scans.reduce((acc, scan) => {
      const tableNumber = scan.tableNumber || 'Unknown';
      const existing = acc.find(item => item.tableNumber === tableNumber);
      if (existing) {
        existing.count++;
      } else {
        acc.push({ tableNumber, count: 1 });
      }
      return acc;
    }, [] as { tableNumber: string; count: number }[]);

    return {
      totalScans: scans.length,
      scansByTable: scansByTable.sort((a, b) => b.count - a.count),
    };
  }

  async getAiApiCallStats(restaurantId: string, startDate?: Date, endDate?: Date): Promise<{
    totalCalls: number;
    callsByType: { callType: string; count: number }[];
  }> {
    let whereCondition;

    if (startDate && endDate) {
      whereCondition = and(
        eq(aiApiCallEvents.restaurantId, restaurantId),
        gte(aiApiCallEvents.calledAt, startDate),
        lte(aiApiCallEvents.calledAt, endDate)
      );
    } else {
      whereCondition = eq(aiApiCallEvents.restaurantId, restaurantId);
    }

    const calls = await db
      .select()
      .from(aiApiCallEvents)
      .where(whereCondition);

    const callsByType = calls.reduce((acc, call) => {
      const existing = acc.find(item => item.callType === call.callType);
      if (existing) {
        existing.count++;
      } else {
        acc.push({ callType: call.callType, count: 1 });
      }
      return acc;
    }, [] as { callType: string; count: number }[]);

    return {
      totalCalls: calls.length,
      callsByType: callsByType.sort((a, b) => b.count - a.count),
    };
  }

  async getTotalAiApiCalls(restaurantId: string): Promise<number> {
    const stats = await this.getAiApiCallStats(restaurantId);
    return stats.totalCalls;
  }

  async getCurrentMonthAiApiCalls(restaurantId: string): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const stats = await this.getAiApiCallStats(restaurantId, startOfMonth, endOfMonth);
    return stats.totalCalls;
  }

  // Rating operations
  async createRating(rating: InsertRating): Promise<Rating> {
    const [newRating] = await db.insert(ratings).values(rating).returning();
    return newRating;
  }

  async getRatingsByOrder(orderId: string): Promise<Rating[]> {
    return await db
      .select()
      .from(ratings)
      .where(eq(ratings.orderId, orderId));
  }

  async getRatingsByRestaurant(restaurantId: string): Promise<Rating[]> {
    return await db
      .select()
      .from(ratings)
      .where(eq(ratings.restaurantId, restaurantId))
      .orderBy(desc(ratings.createdAt));
  }

  async hasOrderBeenRated(orderId: string): Promise<boolean> {
    const existingRatings = await db
      .select()
      .from(ratings)
      .where(eq(ratings.orderId, orderId))
      .limit(1);
    return existingRatings.length > 0;
  }

  // Assistance request operations
  async createAssistanceRequest(request: InsertAssistanceRequest): Promise<AssistanceRequest> {
    const [newRequest] = await db.insert(assistanceRequests).values(request).returning();
    return newRequest;
  }

  async getAssistanceRequests(restaurantId: string, status?: string): Promise<AssistanceRequestWithTable[]> {
    const baseQuery = db
      .select({
        id: assistanceRequests.id,
        restaurantId: assistanceRequests.restaurantId,
        tableId: assistanceRequests.tableId,
        orderId: assistanceRequests.orderId,
        customerMessage: assistanceRequests.customerMessage,
        requestType: assistanceRequests.requestType,
        status: assistanceRequests.status,
        createdAt: assistanceRequests.createdAt,
        updatedAt: assistanceRequests.updatedAt,
        tableNumber: restaurantTables.tableNumber,
      })
      .from(assistanceRequests)
      .leftJoin(restaurantTables, eq(assistanceRequests.tableId, restaurantTables.id));

    if (status) {
      return await baseQuery
        .where(and(
          eq(assistanceRequests.restaurantId, restaurantId),
          eq(assistanceRequests.status, status)
        ))
        .orderBy(desc(assistanceRequests.createdAt));
    }
    return await baseQuery
      .where(eq(assistanceRequests.restaurantId, restaurantId))
      .orderBy(desc(assistanceRequests.createdAt));
  }

  async getAssistanceRequest(id: string): Promise<AssistanceRequest | undefined> {
    const [request] = await db
      .select()
      .from(assistanceRequests)
      .where(eq(assistanceRequests.id, id));
    return request;
  }

  async updateAssistanceRequestStatus(id: string, status: string): Promise<AssistanceRequest> {
    const [request] = await db
      .update(assistanceRequests)
      .set({ status, updatedAt: new Date() })
      .where(eq(assistanceRequests.id, id))
      .returning();
    return request;
  }
}

export const storage = new DatabaseStorage();
