-- Add table_id column to pending_questions table (matching assistance_requests pattern)
-- Note: table_number will be obtained via JOIN with restaurant_tables, not stored directly
ALTER TABLE "pending_questions" 
ADD COLUMN "table_id" varchar;

-- Add foreign key constraint for table_id
ALTER TABLE "pending_questions" 
ADD CONSTRAINT "pending_questions_table_id_restaurant_tables_id_fk" 
FOREIGN KEY ("table_id") REFERENCES "public"."restaurant_tables"("id") 
ON DELETE set null ON UPDATE no action;
