-- Migration: Add missing columns to restaurants and pending_questions tables
-- Date: 2025-12-22
-- Description: 
--   1. Add 'state' column to restaurants table for US sales tax calculation
--   2. Add 'table_id' and 'table_number' columns to pending_questions table

-- ============================================
-- PART 1: Add 'state' column to restaurants
-- ============================================
-- This column stores the US state code (e.g., 'CA', 'NY', 'TX') for sales tax calculation
ALTER TABLE "restaurants" 
ADD COLUMN IF NOT EXISTS "state" text;

-- ============================================
-- PART 2: Add columns to pending_questions
-- ============================================
-- Add table_id column (nullable, foreign key to restaurant_tables)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'pending_questions' AND column_name = 'table_id'
    ) THEN
        ALTER TABLE "pending_questions" ADD COLUMN "table_id" varchar;
    END IF;
END $$;

-- Add table_number column (nullable, denormalized for convenience)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'pending_questions' AND column_name = 'table_number'
    ) THEN
        ALTER TABLE "pending_questions" ADD COLUMN "table_number" text;
    END IF;
END $$;

-- Add foreign key constraint for table_id (only if it doesn't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'pending_questions_table_id_restaurant_tables_id_fk'
    ) THEN
        ALTER TABLE "pending_questions" 
        ADD CONSTRAINT "pending_questions_table_id_restaurant_tables_id_fk" 
        FOREIGN KEY ("table_id") REFERENCES "public"."restaurant_tables"("id") 
        ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;
END $$;

-- ============================================
-- Verification queries (optional - uncomment to verify)
-- ============================================
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'restaurants' AND column_name = 'state';
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pending_questions' AND column_name IN ('table_id', 'table_number');
