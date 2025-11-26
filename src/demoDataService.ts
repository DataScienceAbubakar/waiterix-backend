/**
 * Centralized Demo Data Service
 * 
 * Provides consistent mock data for demo restaurant functionality.
 * All demo-related checks should route through this service to ensure:
 * - No database writes for demo data
 * - Consistent mock data across all endpoints
 * - Easy maintenance and extension
 */

export class DemoDataService {
  private static readonly DEMO_RESTAURANT_ID = 'demo';
  private static readonly DEMO_ORDER_PREFIX = 'demo-order-';
  private static readonly DEMO_ASSISTANCE_PREFIX = 'demo-assistance-';

  /**
   * Check if a restaurant ID is for the demo restaurant
   */
  isDemoRestaurant(restaurantId: string): boolean {
    return restaurantId === DemoDataService.DEMO_RESTAURANT_ID;
  }

  /**
   * Check if an order ID is for a demo order
   */
  isDemoOrder(orderId: string): boolean {
    return orderId.startsWith(DemoDataService.DEMO_ORDER_PREFIX);
  }

  /**
   * Get demo restaurant data
   */
  getDemoRestaurant() {
    return {
      id: 'demo',
      userId: 'demo',
      name: 'The Gourmet Kitchen',
      description: 'A modern dining experience featuring farm-to-table cuisine with global influences. Try our signature dishes and experience culinary excellence.',
      address: '123 Main Street, Downtown, CA 94102',
      phone: '(555) 123-4567',
      hours: 'Mon-Fri: 11am-10pm, Sat-Sun: 10am-11pm',
      coverImageUrl: null,
      createdAt: new Date(),
    };
  }

  /**
   * Get demo menu items
   */
  getDemoMenuItems() {
    return [
      {
        id: 'demo-1',
        restaurantId: 'demo',
        name: 'Grilled Salmon',
        description: 'Fresh Atlantic salmon grilled to perfection, served with seasonal vegetables and lemon butter sauce',
        price: '24.99',
        category: 'Main Course',
        isVegan: false,
        isVegetarian: false,
        isHalal: false,
        isKosher: false,
        spiceLevel: 0,
        allergens: ['fish'],
        imageUrl: '/attached_assets/stock_images/grilled_salmon_fille_ee8721c5.jpg',
        available: true,
        createdAt: new Date(),
      },
      {
        id: 'demo-2',
        restaurantId: 'demo',
        name: 'Margherita Pizza',
        description: 'Classic Neapolitan pizza with fresh mozzarella, basil, and San Marzano tomatoes',
        price: '16.99',
        category: 'Main Course',
        isVegan: false,
        isVegetarian: true,
        isHalal: true,
        isKosher: false,
        spiceLevel: 0,
        allergens: ['gluten', 'dairy'],
        imageUrl: '/attached_assets/stock_images/margherita_pizza_wit_f0ebe3d1.jpg',
        available: true,
        createdAt: new Date(),
      },
      {
        id: 'demo-3',
        restaurantId: 'demo',
        name: 'Caesar Salad',
        description: 'Crisp romaine lettuce with parmesan cheese, croutons, and house-made Caesar dressing',
        price: '12.99',
        category: 'Appetizers',
        isVegan: false,
        isVegetarian: true,
        isHalal: true,
        isKosher: false,
        spiceLevel: 0,
        allergens: ['gluten', 'dairy', 'eggs'],
        imageUrl: '/attached_assets/stock_images/caesar_salad_with_pa_73578916.jpg',
        available: true,
        createdAt: new Date(),
      },
      {
        id: 'demo-4',
        restaurantId: 'demo',
        name: 'Thai Curry Bowl',
        description: 'Spicy coconut curry with tofu, vegetables, and jasmine rice',
        price: '18.99',
        category: 'Main Course',
        isVegan: true,
        isVegetarian: true,
        isHalal: true,
        isKosher: false,
        spiceLevel: 3,
        allergens: ['soy'],
        imageUrl: '/attached_assets/stock_images/thai_curry_bowl_with_aa634794.jpg',
        available: true,
        createdAt: new Date(),
      },
      {
        id: 'demo-5',
        restaurantId: 'demo',
        name: 'Chocolate Lava Cake',
        description: 'Decadent chocolate cake with a molten center, served with vanilla ice cream',
        price: '9.99',
        category: 'Desserts',
        isVegan: false,
        isVegetarian: true,
        isHalal: true,
        isKosher: false,
        spiceLevel: 0,
        allergens: ['gluten', 'dairy', 'eggs'],
        imageUrl: '/attached_assets/stock_images/chocolate_lava_cake__96c8f88c.jpg',
        available: true,
        createdAt: new Date(),
      },
    ];
  }

  /**
   * Create a demo order (returns mock data without database write)
   */
  createDemoOrder(data: {
    customerNote?: string;
    paymentMethod: string;
    paymentStatus?: string;
    stripePaymentIntentId?: string;
    subtotal: string;
    tax: string;
    total: string;
    tip?: string;
  }) {
    return {
      id: `${DemoDataService.DEMO_ORDER_PREFIX}${Date.now()}`,
      restaurantId: 'demo',
      tableId: null,
      customerNote: data.customerNote || '',
      paymentMethod: data.paymentMethod,
      paymentStatus: data.paymentStatus || (data.paymentMethod === 'cash' ? 'pending' : 'completed'),
      stripePaymentIntentId: data.stripePaymentIntentId || null,
      subtotal: data.subtotal,
      tax: data.tax,
      tip: data.tip || '0.00',
      total: data.total,
      status: 'new',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Get demo order tracking data
   */
  getDemoOrderTracking(orderId: string) {
    return {
      order: {
        id: orderId,
        restaurantId: 'demo',
        tableId: null,
        subtotal: '25.00',
        tax: '2.50',
        tip: '5.00',
        total: '32.50',
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'new',
        customerNote: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      items: [
        {
          id: 'demo-item-1',
          orderId,
          menuItemId: 'demo-menu-1',
          name: 'Demo Menu Item',
          price: '25.00',
          quantity: 1,
          customerNote: null,
        }
      ],
      restaurant: {
        id: 'demo',
        name: 'Demo Restaurant',
      },
      table: { tableNumber: 'Table 1' },
      hasBeenRated: false,
    };
  }

  /**
   * Get demo order receipt data
   */
  getDemoReceipt(orderId: string) {
    return {
      order: {
        id: orderId,
        restaurantId: 'demo',
        tableId: null,
        subtotal: '25.00',
        tax: '2.50',
        tip: '5.00',
        total: '32.50',
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'new',
        customerNote: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      items: [
        {
          id: 'demo-item-1',
          orderId,
          menuItemId: 'demo-menu-1',
          name: 'Demo Menu Item',
          price: '25.00',
          quantity: 1,
          customerNote: '',
          modifiers: [],
        }
      ],
      restaurant: {
        id: 'demo',
        name: 'Demo Restaurant',
        address: '123 Demo Street',
        city: 'Demo City',
        country: 'Demo Country',
        phone: '555-0123',
      },
      table: { tableNumber: 1 },
    };
  }

  /**
   * Create demo assistance request (returns mock data without database write)
   */
  createDemoAssistanceRequest(data: {
    tableId?: string | null;
    orderId?: string | null;
    customerMessage?: string | null;
    requestType?: string;
  }) {
    return {
      id: `${DemoDataService.DEMO_ASSISTANCE_PREFIX}${Date.now()}`,
      restaurantId: 'demo',
      tableId: data.tableId || null,
      orderId: data.orderId || null,
      customerMessage: data.customerMessage || null,
      requestType: data.requestType || 'call_waiter',
      status: 'pending',
      createdAt: new Date(),
      tableNumber: data.tableId ? '5' : null, // Demo table number
    };
  }

  /**
   * Create demo rating (returns mock data without database write)
   */
  createDemoRating(data: {
    orderId: string;
    menuItemId?: string | null;
    itemRating?: number | null;
    serviceRatings?: any;
    comment?: string | null;
  }) {
    return {
      id: `demo-rating-${Date.now()}`,
      orderId: data.orderId,
      menuItemId: data.menuItemId || null,
      itemRating: data.itemRating || null,
      serviceRatings: data.serviceRatings || null,
      comment: data.comment || null,
      createdAt: new Date(),
    };
  }

  /**
   * Get demo ratings for an order
   */
  getDemoRatings(orderId: string) {
    return [];
  }
}

// Export singleton instance
export const demoDataService = new DemoDataService();
