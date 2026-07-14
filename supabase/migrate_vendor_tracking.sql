-- MediFlow v2.0 Migration: Add vendor tracking to order_book and default_vendor to items
-- Run this in the Supabase SQL Editor to update existing databases.

-- 1. Add default_vendor_id to items table
ALTER TABLE public.items 
  ADD COLUMN IF NOT EXISTS default_vendor_id uuid REFERENCES public.parties(id) ON DELETE SET NULL;

-- 2. Add vendor columns to order_book table
ALTER TABLE public.order_book 
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.parties(id) ON DELETE SET NULL;

ALTER TABLE public.order_book 
  ADD COLUMN IF NOT EXISTS vendor_name text;

ALTER TABLE public.order_book 
  ADD COLUMN IF NOT EXISTS vendor_phone text;

-- 3. Add indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_items_default_vendor ON public.items(default_vendor_id);
CREATE INDEX IF NOT EXISTS idx_order_book_vendor ON public.order_book(vendor_id);

-- Done! The app will now:
-- 1. Auto-populate vendor on order_book rows from items.default_vendor_id
-- 2. Allow selecting a vendor per order_book row which saves back to items.default_vendor_id
-- 3. Sync vendor_id, vendor_name, vendor_phone to Supabase via the backup/restore flow
