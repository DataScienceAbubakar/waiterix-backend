import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, decimal, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  acceptedTerms: boolean("accepted_terms").default(false).notNull(),
  acceptedTermsAt: timestamp("accepted_terms_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const restaurants = pgTable("restaurants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  description: text("description"),
  address: text("address"),
  city: text("city"),
  country: text("country"),
  phone: text("phone"),
  hours: text("hours"),
  coverImageUrl: text("cover_image_url"),
  defaultLanguage: text("default_language").notNull().default('en'),
  currencyCode: text("currency_code").notNull().default('USD'),
  // Admin settings
  adminPassword: text("admin_password"),
  securityQuestion1: text("security_question_1"),
  securityAnswer1: text("security_answer_1"),
  securityQuestion2: text("security_question_2"),
  securityAnswer2: text("security_answer_2"),
  aiWaiterEnabled: boolean("ai_waiter_enabled").default(true).notNull(),
  autoPrintOrders: boolean("auto_print_orders").default(false).notNull(),
  // Stripe Connect fields (US/Europe/Default)
  stripeAccountId: text("stripe_account_id"),
  stripeOnboardingComplete: boolean("stripe_onboarding_complete").default(false).notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  // Paystack fields (Nigeria/West Africa)
  paystackSubaccountCode: text("paystack_subaccount_code"),
  paystackBankCode: text("paystack_bank_code"),
  paystackAccountNumber: text("paystack_account_number"),
  paystackAccountName: text("paystack_account_name"),
  paystackOnboardingComplete: boolean("paystack_onboarding_complete").default(false).notNull(),
  // Telr fields (Middle East: UAE, Saudi Arabia, Kuwait, Qatar, etc.)
  telrMerchantId: text("telr_merchant_id"),
  telrApiKey: text("telr_api_key"),
  telrOnboardingComplete: boolean("telr_onboarding_complete").default(false).notNull(),
  // Adyen fields (Asia: excluding Middle East)
  adyenMerchantAccount: text("adyen_merchant_account"),
  adyenOnboardingComplete: boolean("adyen_onboarding_complete").default(false).notNull(),
  // Subscription fields
  subscriptionStatus: text("subscription_status").notNull().default('trialing'),
  subscriptionId: text("subscription_id"),
  trialEndsAt: timestamp("trial_ends_at"),
  currentPeriodEnd: timestamp("current_period_end"),
  // AI usage tracking for metered billing
  aiUsageCount: integer("ai_usage_count").default(0).notNull(),
  currentMonthUsage: integer("current_month_usage").default(0).notNull(),
  stripeUsageItemId: text("stripe_usage_item_id"),
  lastUsageReportedAt: timestamp("last_usage_reported_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const menuItems = pgTable("menu_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id").notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  category: text("category").notNull(),
  imageUrl: text("image_url"),
  spiceLevel: text("spice_level"),
  isVegan: boolean("is_vegan").default(false).notNull(),
  isVegetarian: boolean("is_vegetarian").default(false).notNull(),
  isHalal: boolean("is_halal").default(false).notNull(),
  isKosher: boolean("is_kosher").default(false).notNull(),
  allergens: text("allergens").array(),
  available: boolean("available").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const restaurantTables = pgTable("restaurant_tables", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id").notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
  tableNumber: text("table_number").notNull(),
  qrCodeUrl: text("qr_code_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id").notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
  tableId: varchar("table_id").references(() => restaurantTables.id, { onDelete: 'set null' }),
  customerNote: text("customer_note"),
  paymentMethod: text("payment_method").notNull(),
  paymentStatus: text("payment_status").notNull().default('pending'),
  paymentGateway: text("payment_gateway"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  paystackReference: text("paystack_reference"),
  telrTransactionRef: text("telr_transaction_ref"),
  adyenPspReference: text("adyen_psp_reference"),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull(),
  tip: decimal("tip", { precision: 10, scale: 2 }).default('0').notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default('new'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const orderItems = pgTable("order_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  menuItemId: varchar("menu_item_id").references(() => menuItems.id, { onDelete: 'set null' }),
  name: text("name").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").notNull(),
  customerNote: text("customer_note"),
});

// Extended menu details for AI knowledge base
export const extendedMenuDetails = pgTable("extended_menu_details", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  menuItemId: varchar("menu_item_id").notNull().references(() => menuItems.id, { onDelete: 'cascade' }).unique(),
  preparationMethod: text("preparation_method"),
  ingredientSources: text("ingredient_sources"),
  pairingSuggestions: text("pairing_suggestions"),
  chefNotes: text("chef_notes"),
  cookingTime: text("cooking_time"),
  specialTechniques: text("special_techniques"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Restaurant-wide knowledge for AI
export const restaurantKnowledge = pgTable("restaurant_knowledge", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id").notNull().references(() => restaurants.id, { onDelete: 'cascade' }).unique(),
  story: text("story"),
  philosophy: text("philosophy"),
  sourcingPractices: text("sourcing_practices"),
  specialTechniques: text("special_techniques"),
  awards: text("awards"),
  sustainabilityPractices: text("sustainability_practices"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// FAQ knowledge base that learns from chef answers
export const faqKnowledgeBase = pgTable("faq_knowledge_base", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id").notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  keywords: text("keywords").array(),
  relatedMenuItemIds: text("related_menu_item_ids").array(),
  usageCount: integer("usage_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Pending questions waiting for chef response
export const pendingQuestions = pgTable("pending_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id").notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
  customerSessionId: varchar("customer_session_id").notNull(),
  question: text("question").notNull(),
  menuItemContext: text("menu_item_context"),
  language: text("language").notNull().default('en'),
  status: text("status").notNull().default('pending'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Chef answers that auto-populate FAQ
export const chefAnswers = pgTable("chef_answers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pendingQuestionId: varchar("pending_question_id").notNull().references(() => pendingQuestions.id, { onDelete: 'cascade' }),
  restaurantId: varchar("restaurant_id").notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
  answer: text("answer").notNull(),
  answeredBy: varchar("answered_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Analytics - Table scans tracking
export const tableScanEvents = pgTable("table_scan_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id").notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
  tableId: varchar("table_id").references(() => restaurantTables.id, { onDelete: 'set null' }),
  tableNumber: text("table_number"),
  scannedAt: timestamp("scanned_at").defaultNow().notNull(),
}, (table) => [
  index("idx_table_scan_restaurant").on(table.restaurantId),
  index("idx_table_scan_date").on(table.scannedAt),
]);

// Analytics - AI API call tracking
export const aiApiCallEvents = pgTable("ai_api_call_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id").notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
  callType: text("call_type").notNull(), // 'speech-to-text', 'text-to-speech', 'chat-completion'
  customerSessionId: varchar("customer_session_id"),
  tokenCount: integer("token_count"),
  durationMs: integer("duration_ms"),
  calledAt: timestamp("called_at").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_call_restaurant").on(table.restaurantId),
  index("idx_ai_call_date").on(table.calledAt),
]);

// Ratings - Customer ratings for orders and menu items
export const ratings = pgTable("ratings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  restaurantId: varchar("restaurant_id").notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
  menuItemId: varchar("menu_item_id").references(() => menuItems.id, { onDelete: 'set null' }),
  itemRating: integer("item_rating"), // 1-5 stars for individual menu items
  serviceRatings: jsonb("service_ratings"), // { foodQuality: 1-5, serviceSpeed: 1-5, cleanliness: 1-5, staffFriendliness: 1-5 }
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_rating_order").on(table.orderId),
  index("idx_rating_restaurant").on(table.restaurantId),
  index("idx_rating_menu_item").on(table.menuItemId),
]);

// Assistance Requests - Customer requests for waiter assistance
export const assistanceRequests = pgTable("assistance_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restaurantId: varchar("restaurant_id").notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
  tableId: varchar("table_id").references(() => restaurantTables.id, { onDelete: 'set null' }),
  orderId: varchar("order_id").references(() => orders.id, { onDelete: 'set null' }),
  customerMessage: text("customer_message"),
  requestType: text("request_type").notNull().default('call_waiter'), // 'call_waiter', 'help_needed'
  status: text("status").notNull().default('pending'), // 'pending', 'acknowledged', 'resolved'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_assistance_restaurant").on(table.restaurantId),
  index("idx_assistance_status").on(table.status),
  index("idx_assistance_created").on(table.createdAt),
]);

// Menu Item Translations - Translated names and descriptions for menu items
export const menuItemTranslations = pgTable("menu_item_translations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  menuItemId: varchar("menu_item_id").notNull().references(() => menuItems.id, { onDelete: 'cascade' }),
  language: text("language").notNull(), // 'en', 'es', 'fr', etc.
  name: text("name").notNull(),
  description: text("description").notNull(),
  autoTranslated: boolean("auto_translated").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_translation_menu_item").on(table.menuItemId),
  index("idx_translation_language").on(table.language),
]);

// Insert schemas
export const insertRestaurantSchema = createInsertSchema(restaurants).omit({
  id: true,
  createdAt: true,
  stripeAccountId: true,
  stripeOnboardingComplete: true,
  subscriptionStatus: true,
  subscriptionId: true,
  trialEndsAt: true,
  currentPeriodEnd: true,
});

export const insertMenuItemSchema = createInsertSchema(menuItems).omit({
  id: true,
  createdAt: true,
}).extend({
  price: z.string().min(1, "Price is required"),
  allergens: z.array(z.string()).optional(),
});

export const insertRestaurantTableSchema = createInsertSchema(restaurantTables).omit({
  id: true,
  createdAt: true,
  qrCodeUrl: true,
});

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  subtotal: z.string(),
  tax: z.string(),
  total: z.string(),
});

export const insertOrderItemSchema = createInsertSchema(orderItems).omit({
  id: true,
  orderId: true, // orderId will be added by storage layer after order creation
}).extend({
  price: z.string(),
});

export const insertExtendedMenuDetailsSchema = createInsertSchema(extendedMenuDetails).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRestaurantKnowledgeSchema = createInsertSchema(restaurantKnowledge).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFaqKnowledgeBaseSchema = createInsertSchema(faqKnowledgeBase).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  usageCount: true,
});

export const insertPendingQuestionSchema = createInsertSchema(pendingQuestions).omit({
  id: true,
  createdAt: true,
});

export const insertChefAnswerSchema = createInsertSchema(chefAnswers).omit({
  id: true,
  createdAt: true,
});

export const insertTableScanEventSchema = createInsertSchema(tableScanEvents).omit({
  id: true,
  scannedAt: true,
});

export const insertAiApiCallEventSchema = createInsertSchema(aiApiCallEvents).omit({
  id: true,
  calledAt: true,
});

export const insertRatingSchema = createInsertSchema(ratings).omit({
  id: true,
  createdAt: true,
});

export const insertAssistanceRequestSchema = createInsertSchema(assistanceRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMenuItemTranslationSchema = createInsertSchema(menuItemTranslations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Select types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type Restaurant = typeof restaurants.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type RestaurantTable = typeof restaurantTables.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderWithTable = Order & {
  tableNumber: string | null;
};
export type ExtendedMenuDetails = typeof extendedMenuDetails.$inferSelect;
export type RestaurantKnowledge = typeof restaurantKnowledge.$inferSelect;
export type FaqKnowledgeBase = typeof faqKnowledgeBase.$inferSelect;
export type PendingQuestion = typeof pendingQuestions.$inferSelect;
export type ChefAnswer = typeof chefAnswers.$inferSelect;
export type TableScanEvent = typeof tableScanEvents.$inferSelect;
export type AiApiCallEvent = typeof aiApiCallEvents.$inferSelect;
export type Rating = typeof ratings.$inferSelect;
export type AssistanceRequest = typeof assistanceRequests.$inferSelect;
export type MenuItemTranslation = typeof menuItemTranslations.$inferSelect;

// Extended types with joined data
export type AssistanceRequestWithTable = AssistanceRequest & {
  tableNumber: string | null;
};

// Insert types
export type InsertRestaurant = z.infer<typeof insertRestaurantSchema>;
export type InsertMenuItem = z.infer<typeof insertMenuItemSchema>;
export type InsertRestaurantTable = z.infer<typeof insertRestaurantTableSchema>;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type InsertExtendedMenuDetails = z.infer<typeof insertExtendedMenuDetailsSchema>;
export type InsertRestaurantKnowledge = z.infer<typeof insertRestaurantKnowledgeSchema>;
export type InsertFaqKnowledgeBase = z.infer<typeof insertFaqKnowledgeBaseSchema>;
export type InsertPendingQuestion = z.infer<typeof insertPendingQuestionSchema>;
export type InsertChefAnswer = z.infer<typeof insertChefAnswerSchema>;
export type InsertTableScanEvent = z.infer<typeof insertTableScanEventSchema>;
export type InsertAiApiCallEvent = z.infer<typeof insertAiApiCallEventSchema>;
export type InsertRating = z.infer<typeof insertRatingSchema>;
export type InsertAssistanceRequest = z.infer<typeof insertAssistanceRequestSchema>;
export type InsertMenuItemTranslation = z.infer<typeof insertMenuItemTranslationSchema>;