-- =====================================================
-- FinFlow WhatsApp Bot — Supabase Setup
-- =====================================================
-- Run this in Supabase SQL Editor before deploying the bot.
-- This adds the whatsapp_phone column to the settings
-- table and creates an index for fast phone lookups.
-- =====================================================

-- 1. Add whatsapp_phone column to settings table
ALTER TABLE settings
ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT;

-- 2. Add unique index on whatsapp_phone for fast lookups
-- (Only one account per WhatsApp number)
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_whatsapp_phone
ON settings (whatsapp_phone)
WHERE whatsapp_phone IS NOT NULL;

-- 3. Verify RLS policies allow service role access
-- The service role key bypasses RLS by default in Supabase.
-- These policies ensure the bot can read/write even if RLS
-- is enabled on these tables.

-- Allow service role to read settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'settings'
    AND policyname = 'Service role can read settings'
  ) THEN
    CREATE POLICY "Service role can read settings"
    ON settings FOR SELECT
    TO service_role
    USING (true);
  END IF;
END $$;

-- Allow service role to update settings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'settings'
    AND policyname = 'Service role can update settings'
  ) THEN
    CREATE POLICY "Service role can update settings"
    ON settings FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;

-- Allow service role to insert transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'transactions'
    AND policyname = 'Service role can insert transactions'
  ) THEN
    CREATE POLICY "Service role can insert transactions"
    ON transactions FOR INSERT
    TO service_role
    WITH CHECK (true);
  END IF;
END $$;

-- Allow service role to read transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'transactions'
    AND policyname = 'Service role can read transactions'
  ) THEN
    CREATE POLICY "Service role can read transactions"
    ON transactions FOR SELECT
    TO service_role
    USING (true);
  END IF;
END $$;

-- 4. Verify the column was added successfully
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'settings'
AND column_name = 'whatsapp_phone';
