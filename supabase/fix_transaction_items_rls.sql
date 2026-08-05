-- Run once in the Supabase SQL Editor for the production project.
-- This replaces the old combined policy that is rejecting valid line-item inserts
-- with: new row violates row-level security policy for table "transaction_items".

BEGIN;

ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member_access_txn_items" ON public.transaction_items;
DROP POLICY IF EXISTS "transaction_items_select_for_store_members" ON public.transaction_items;
DROP POLICY IF EXISTS "transaction_items_insert_for_store_members" ON public.transaction_items;
DROP POLICY IF EXISTS "transaction_items_update_for_store_members" ON public.transaction_items;
DROP POLICY IF EXISTS "transaction_items_delete_for_store_members" ON public.transaction_items;

CREATE POLICY "transaction_items_select_for_store_members"
ON public.transaction_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.transactions AS transaction_record
    WHERE transaction_record.id = transaction_items.txn_id
      AND transaction_record.store_id IN (SELECT public.get_user_store_ids())
  )
);

CREATE POLICY "transaction_items_insert_for_store_members"
ON public.transaction_items
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.transactions AS transaction_record
    WHERE transaction_record.id = transaction_items.txn_id
      AND transaction_record.store_id IN (SELECT public.get_user_store_ids())
  )
);

CREATE POLICY "transaction_items_update_for_store_members"
ON public.transaction_items
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.transactions AS transaction_record
    WHERE transaction_record.id = transaction_items.txn_id
      AND transaction_record.store_id IN (SELECT public.get_user_store_ids())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.transactions AS transaction_record
    WHERE transaction_record.id = transaction_items.txn_id
      AND transaction_record.store_id IN (SELECT public.get_user_store_ids())
  )
);

CREATE POLICY "transaction_items_delete_for_store_members"
ON public.transaction_items
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.transactions AS transaction_record
    WHERE transaction_record.id = transaction_items.txn_id
      AND transaction_record.store_id IN (SELECT public.get_user_store_ids())
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_items TO authenticated;

COMMIT;
