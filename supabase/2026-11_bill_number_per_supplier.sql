-- =============================================================================
-- Allow the same PURCHASE bill number from DIFFERENT suppliers.
--
-- Before: UNIQUE (store_id, invoice_no, type)   -> 2nd supplier's bill was rejected
-- After:  purchases unique per (store_id, party_id, invoice_no)
--         sales     unique per (store_id, invoice_no)            (unchanged for sales)
--
-- HOW TO RUN: Supabase -> SQL Editor -> paste this whole file -> Run.
-- It runs in one transaction: if any step fails, NOTHING is changed.
-- Take a backup first (Database -> Backups, or the JSON export) before running.
-- =============================================================================

BEGIN;

-- 1. Pre-check: these new rules must already hold for existing data.
--    If either query raises, fix/inspect the listed bills first; nothing is changed.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.transactions
    WHERE type = 'purchase' AND invoice_no IS NOT NULL
    GROUP BY store_id, party_id, invoice_no HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION '% purchase bill number(s) are duplicated for the same supplier. Run the SELECT at the bottom of this file to list them.', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.transactions
    WHERE type = 'sale' AND invoice_no IS NOT NULL
    GROUP BY store_id, invoice_no HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION '% sale invoice number(s) are duplicated. Nothing was changed.', n;
  END IF;
END $$;

-- 2. Drop the old store-wide rule (find its name instead of guessing it).
DO $$
DECLARE c text;
BEGIN
  SELECT con.conname INTO c
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public' AND rel.relname = 'transactions' AND con.contype = 'u'
    AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
         FROM unnest(con.conkey) k JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k)
        = ARRAY['invoice_no', 'store_id', 'type'];
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.transactions DROP CONSTRAINT %I', c);
    RAISE NOTICE 'Dropped constraint %', c;
  ELSE
    RAISE NOTICE 'Old unique constraint not found (already removed?)';
  END IF;
END $$;

-- 3. New rules.
CREATE UNIQUE INDEX IF NOT EXISTS uq_txn_purchase_per_supplier
  ON public.transactions (store_id, party_id, invoice_no)
  WHERE type = 'purchase';

CREATE UNIQUE INDEX IF NOT EXISTS uq_txn_sale_invoice
  ON public.transactions (store_id, invoice_no)
  WHERE type = 'sale';

COMMIT;

-- -----------------------------------------------------------------------------
-- Helper (run separately if step 1 complained): list same-supplier duplicates
-- -----------------------------------------------------------------------------
-- SELECT t.store_id, p.name AS supplier, t.invoice_no, count(*), array_agg(t.date ORDER BY t.date)
-- FROM public.transactions t LEFT JOIN public.parties p ON p.id = t.party_id
-- WHERE t.type = 'purchase'
-- GROUP BY t.store_id, p.name, t.invoice_no HAVING count(*) > 1;
