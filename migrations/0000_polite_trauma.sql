CREATE TABLE "ai_api_call_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" varchar NOT NULL,
	"call_type" text NOT NULL,
	"customer_session_id" varchar,
	"token_count" integer,
	"duration_ms" integer,
	"called_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistance_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" varchar NOT NULL,
	"table_id" varchar,
	"order_id" varchar,
	"customer_message" text,
	"request_type" text DEFAULT 'call_waiter' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chef_answers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pending_question_id" varchar NOT NULL,
	"restaurant_id" varchar NOT NULL,
	"answer" text NOT NULL,
	"answered_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extended_menu_details" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_item_id" varchar NOT NULL,
	"preparation_method" text,
	"ingredient_sources" text,
	"pairing_suggestions" text,
	"chef_notes" text,
	"cooking_time" text,
	"special_techniques" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "extended_menu_details_menu_item_id_unique" UNIQUE("menu_item_id")
);
--> statement-breakpoint
CREATE TABLE "faq_knowledge_base" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" varchar NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"keywords" text[],
	"related_menu_item_ids" text[],
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_item_translations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_item_id" varchar NOT NULL,
	"language" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"auto_translated" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"category" text NOT NULL,
	"image_url" text,
	"spice_level" text,
	"is_vegan" boolean DEFAULT false NOT NULL,
	"is_vegetarian" boolean DEFAULT false NOT NULL,
	"is_halal" boolean DEFAULT false NOT NULL,
	"is_kosher" boolean DEFAULT false NOT NULL,
	"allergens" text[],
	"available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" varchar NOT NULL,
	"menu_item_id" varchar,
	"name" text NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"customer_note" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" varchar NOT NULL,
	"table_id" varchar,
	"customer_note" text,
	"payment_method" text NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"payment_gateway" text,
	"stripe_payment_intent_id" text,
	"paystack_reference" text,
	"telr_transaction_ref" text,
	"adyen_psp_reference" text,
	"subtotal" numeric(10, 2) NOT NULL,
	"tax" numeric(10, 2) NOT NULL,
	"tip" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_questions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" varchar NOT NULL,
	"customer_session_id" varchar NOT NULL,
	"question" text NOT NULL,
	"menu_item_context" text,
	"language" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" varchar NOT NULL,
	"restaurant_id" varchar NOT NULL,
	"menu_item_id" varchar,
	"item_rating" integer,
	"service_ratings" jsonb,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurant_knowledge" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" varchar NOT NULL,
	"story" text,
	"philosophy" text,
	"sourcing_practices" text,
	"special_techniques" text,
	"awards" text,
	"sustainability_practices" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_knowledge_restaurant_id_unique" UNIQUE("restaurant_id")
);
--> statement-breakpoint
CREATE TABLE "restaurant_tables" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" varchar NOT NULL,
	"table_number" text NOT NULL,
	"qr_code_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"address" text,
	"city" text,
	"country" text,
	"phone" text,
	"hours" text,
	"cover_image_url" text,
	"default_language" text DEFAULT 'en' NOT NULL,
	"currency_code" text DEFAULT 'USD' NOT NULL,
	"admin_password" text,
	"security_question_1" text,
	"security_answer_1" text,
	"security_question_2" text,
	"security_answer_2" text,
	"ai_waiter_enabled" boolean DEFAULT true NOT NULL,
	"auto_print_orders" boolean DEFAULT false NOT NULL,
	"stripe_account_id" text,
	"stripe_onboarding_complete" boolean DEFAULT false NOT NULL,
	"stripe_customer_id" text,
	"paystack_subaccount_code" text,
	"paystack_bank_code" text,
	"paystack_account_number" text,
	"paystack_account_name" text,
	"paystack_onboarding_complete" boolean DEFAULT false NOT NULL,
	"telr_merchant_id" text,
	"telr_api_key" text,
	"telr_onboarding_complete" boolean DEFAULT false NOT NULL,
	"adyen_merchant_account" text,
	"adyen_onboarding_complete" boolean DEFAULT false NOT NULL,
	"subscription_status" text DEFAULT 'trialing' NOT NULL,
	"subscription_id" text,
	"trial_ends_at" timestamp,
	"current_period_end" timestamp,
	"ai_usage_count" integer DEFAULT 0 NOT NULL,
	"current_month_usage" integer DEFAULT 0 NOT NULL,
	"stripe_usage_item_id" text,
	"last_usage_reported_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "restaurants_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_scan_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" varchar NOT NULL,
	"table_id" varchar,
	"table_number" text,
	"scanned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"accepted_terms" boolean DEFAULT false NOT NULL,
	"accepted_terms_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ai_api_call_events" ADD CONSTRAINT "ai_api_call_events_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD CONSTRAINT "assistance_requests_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD CONSTRAINT "assistance_requests_table_id_restaurant_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."restaurant_tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistance_requests" ADD CONSTRAINT "assistance_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chef_answers" ADD CONSTRAINT "chef_answers_pending_question_id_pending_questions_id_fk" FOREIGN KEY ("pending_question_id") REFERENCES "public"."pending_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chef_answers" ADD CONSTRAINT "chef_answers_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extended_menu_details" ADD CONSTRAINT "extended_menu_details_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq_knowledge_base" ADD CONSTRAINT "faq_knowledge_base_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_translations" ADD CONSTRAINT "menu_item_translations_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_restaurant_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."restaurant_tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_questions" ADD CONSTRAINT "pending_questions_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_knowledge" ADD CONSTRAINT "restaurant_knowledge_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_scan_events" ADD CONSTRAINT "table_scan_events_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_scan_events" ADD CONSTRAINT "table_scan_events_table_id_restaurant_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."restaurant_tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_call_restaurant" ON "ai_api_call_events" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "idx_ai_call_date" ON "ai_api_call_events" USING btree ("called_at");--> statement-breakpoint
CREATE INDEX "idx_assistance_restaurant" ON "assistance_requests" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "idx_assistance_status" ON "assistance_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_assistance_created" ON "assistance_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_translation_menu_item" ON "menu_item_translations" USING btree ("menu_item_id");--> statement-breakpoint
CREATE INDEX "idx_translation_language" ON "menu_item_translations" USING btree ("language");--> statement-breakpoint
CREATE INDEX "idx_rating_order" ON "ratings" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_rating_restaurant" ON "ratings" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "idx_rating_menu_item" ON "ratings" USING btree ("menu_item_id");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_table_scan_restaurant" ON "table_scan_events" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "idx_table_scan_date" ON "table_scan_events" USING btree ("scanned_at");