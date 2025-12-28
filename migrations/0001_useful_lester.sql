ALTER TABLE "order_items" ADD COLUMN "allergies" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "allergies" text;--> statement-breakpoint
ALTER TABLE "pending_questions" ADD COLUMN "table_number" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "state" text;