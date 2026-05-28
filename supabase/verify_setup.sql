-- =============================================================================
-- MediFlow SaaS — Post-Setup Verification Queries
-- Run these AFTER schema_and_rls.sql to confirm everything is working.
-- Run them one block at a time in the Supabase SQL Editor.
-- =============================================================================


-- ─── CHECK 1: All tables exist ───────────────────────────────────────────────
SELECT table_name
FROM   information_schema.tables
WHERE  table_schema = 'public'
ORDER  BY table_name;

-- Expected: app_settings, items, order_book, parties, party_special_rates,
--           stores, store_users, sync_log, transaction_items, transactions


-- ─── CHECK 2: All RLS policies exist ─────────────────────────────────────────
SELECT
    schemaname,
    tablename,
    policyname,
    cmd
FROM   pg_policies
WHERE  schemaname = 'public'
ORDER  BY tablename, policyname;

-- Expected: 2-5 policies per table


-- ─── CHECK 3: Super admin exists in auth.users ────────────────────────────────
SELECT
    id,
    email,
    email_confirmed_at,
    raw_user_meta_data->>'role'   AS app_role,
    raw_user_meta_data->>'display_name' AS display_name,
    created_at
FROM auth.users
WHERE email = 'winmihir@gmail.com';

-- Expected: 1 row with app_role = 'super_admin'


-- ─── CHECK 4: Identity record exists (needed for password login) ──────────────
SELECT
    ai.id,
    ai.user_id,
    ai.provider,
    ai.provider_id,
    ai.created_at
FROM auth.identities ai
JOIN auth.users      au ON au.id = ai.user_id
WHERE au.email = 'winmihir@gmail.com';

-- Expected: 1 row with provider = 'email'


-- ─── CHECK 5: Helper functions exist ─────────────────────────────────────────
SELECT
    routine_name,
    routine_type,
    security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND   routine_name   IN ('get_user_store_ids', 'is_super_admin',
                         'user_role_in_store', 'handle_updated_at',
                         'seed_default_store_settings')
ORDER BY routine_name;

-- Expected: 5 rows


-- ─── CHECK 6: Triggers exist ──────────────────────────────────────────────────
SELECT
    trigger_name,
    event_object_table,
    action_timing,
    event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
AND   trigger_name   = 'trg_updated_at'
ORDER BY event_object_table;

-- Expected: 5 rows (stores, store_users, items, parties, transactions)


-- ─── CHECK 7: All indexes exist ───────────────────────────────────────────────
SELECT
    indexname,
    tablename,
    indexdef
FROM   pg_indexes
WHERE  schemaname = 'public'
ORDER  BY tablename, indexname;

-- Expected: 25+ indexes


-- ─── CHECK 8: Extensions are active ──────────────────────────────────────────
SELECT
    extname,
    extversion
FROM   pg_extension
WHERE  extname IN ('pgcrypto', 'pg_trgm');

-- Expected: 2 rows


-- ─── CHECK 9: Realtime publications ──────────────────────────────────────────
SELECT
    pubname,
    tablename
FROM   pg_publication_tables
WHERE  pubname = 'supabase_realtime'
ORDER  BY tablename;

-- Expected: transactions, transaction_items, items, parties, order_book, sync_log
