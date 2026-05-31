-- =============================================================================
-- MediFlow SaaS — One-Time Supabase Setup Script
-- Run this ONCE in the Supabase SQL Editor (Project → SQL Editor → New Query)
-- ORDER MATTERS. Do NOT rearrange sections.
-- =============================================================================


-- =============================================================================
-- SECTION 0 : Extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid(), crypt()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- trigram indexes for fast ILIKE search


-- =============================================================================
-- SECTION 1 : TABLES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1.1  stores
--      The master registry of every store created by the super-admin.
--      Each store is completely isolated from all others via RLS.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stores (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    gstin       text,
    address     text,
    phone       text,
    logo_url    text,
    plan        text        NOT NULL DEFAULT 'basic'
                            CHECK (plan IN ('basic', 'pro', 'enterprise')),
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.stores IS 'Master store registry. Only super-admin can INSERT here via Edge Function.';


-- ---------------------------------------------------------------------------
-- 1.2  store_users
--      Maps Supabase Auth users to a store with a role.
--      One person can be a cashier in Store A and owner in Store B.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.store_users (
    id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id     uuid    NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    user_id      uuid    NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
    role         text    NOT NULL DEFAULT 'cashier'
                         CHECK (role IN ('owner', 'cashier', 'viewer')),
    display_name text    NOT NULL DEFAULT '',
    is_active    boolean NOT NULL DEFAULT true,
    invited_by   uuid    REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    UNIQUE (store_id, user_id)
);

COMMENT ON TABLE public.store_users IS 'Links auth users to stores with role-based access. Drives all RLS policies.';


-- ---------------------------------------------------------------------------
-- 1.3  items
--      Product/medicine catalog. Isolated per store.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.items (
    id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id         uuid         NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    name             text         NOT NULL,
    hsn              text,
    unit             text         DEFAULT 'TAB',
    sale_price       numeric(12,2) DEFAULT 0,
    purchase_price   numeric(12,2) DEFAULT 0,
    opening_stock    numeric(12,2) DEFAULT 0,
    current_stock    numeric(12,2) DEFAULT 0,
    min_stock        numeric(12,2) DEFAULT 0,
    category         text,
    tax_rate         numeric(5,2)  DEFAULT 0,
    discount         numeric(5,2)  DEFAULT 0,
    inclusive_tax    boolean       DEFAULT false,
    tabs_per_strip   numeric       DEFAULT 10,
    strips_per_box   numeric       DEFAULT 10,
    default_vendor_id uuid         REFERENCES public.parties(id) ON DELETE SET NULL,
    is_active        boolean       NOT NULL DEFAULT true,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    updated_at       timestamptz   NOT NULL DEFAULT now(),

    UNIQUE (store_id, name)
);

COMMENT ON TABLE public.items IS 'Per-store product/medicine catalog with stock tracking.';


-- ---------------------------------------------------------------------------
-- 1.4  parties
--      Customers and vendors. Isolated per store.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.parties (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        uuid         NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    name            text         NOT NULL,
    phone           text,
    gstin           text,
    address         text,
    type            text         DEFAULT 'customer'
                                 CHECK (type IN ('customer', 'vendor')),
    opening_balance numeric(12,2) DEFAULT 0,
    is_active       boolean       NOT NULL DEFAULT true,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),

    UNIQUE (store_id, name)
);

COMMENT ON TABLE public.parties IS 'Per-store customers and vendors with ledger balance.';


-- ---------------------------------------------------------------------------
-- 1.5  transactions
--      Master invoice/bill header. Each row = one sale or purchase.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id      uuid         NOT NULL REFERENCES public.stores(id)   ON DELETE CASCADE,
    invoice_no    text,
    date          timestamptz  NOT NULL DEFAULT now(),
    party_id      uuid         REFERENCES public.parties(id)            ON DELETE SET NULL,
    total_amount  numeric(12,2) NOT NULL DEFAULT 0,
    paid_amount   numeric(12,2) DEFAULT 0,
    balance_due   numeric(12,2) DEFAULT 0,
    type          text         NOT NULL CHECK (type IN ('sale', 'purchase')),
    payment_type  text         DEFAULT 'cash'
                               CHECK (payment_type IN ('cash', 'credit', 'upi', 'cheque', 'bank')),
    status        text         DEFAULT 'paid'
                               CHECK (status IN ('paid', 'partial', 'unpaid')),
    challan_no    text,
    description   text,
    created_by    uuid         REFERENCES auth.users(id) ON DELETE SET NULL,  -- cashier audit trail
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),

    UNIQUE (store_id, invoice_no, type)
);

COMMENT ON TABLE public.transactions IS 'Sales invoices and purchase bills. created_by tracks which cashier generated the bill.';


-- ---------------------------------------------------------------------------
-- 1.6  transaction_items
--      Line items for each invoice. Child of transactions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transaction_items (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    txn_id        uuid          NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    item_id       uuid          REFERENCES public.items(id) ON DELETE SET NULL,
    item_name     text,                        -- snapshot name at time of sale
    quantity      numeric(12,3) NOT NULL DEFAULT 0,
    unit          text,
    price         numeric(12,2) NOT NULL DEFAULT 0,
    amount        numeric(12,2) DEFAULT 0,
    discount_pct  numeric(5,2)  DEFAULT 0,
    discount_amt  numeric(12,2) DEFAULT 0,
    tax_pct       numeric(5,2)  DEFAULT 0,
    tax_amt       numeric(12,2) DEFAULT 0,
    scheme_amount numeric(12,2) DEFAULT 0,
    batch_no      text,
    expiry_date   text
);

COMMENT ON TABLE public.transaction_items IS 'Line items for every invoice. item_name is snapshotted to survive item renames/deletes.';


-- ---------------------------------------------------------------------------
-- 1.7  party_special_rates
--      Custom pricing / discount per (party, item) pair.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.party_special_rates (
    id        uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id  uuid          NOT NULL REFERENCES public.stores(id)  ON DELETE CASCADE,
    party_id  uuid          NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
    item_id   uuid          NOT NULL REFERENCES public.items(id)   ON DELETE CASCADE,
    price     numeric(12,2),
    discount  numeric(5,2),

    UNIQUE (store_id, party_id, item_id)
);


-- ---------------------------------------------------------------------------
-- 1.8  order_book
--      Pending purchase orders (items to reorder from vendors).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_book (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id     uuid          NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    item_id      uuid          REFERENCES public.items(id) ON DELETE SET NULL,
    item_name    text,
    quantity     numeric(12,2) DEFAULT 1,
    status       text          DEFAULT 'pending'
                               CHECK (status IN ('pending', 'ordered', 'received', 'cancelled')),
    ordered_at   timestamptz,
    vendor_id    uuid          REFERENCES public.parties(id) ON DELETE SET NULL,
    vendor_name  text,
    vendor_phone text,
    created_at   timestamptz   NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- 1.9  app_settings
--      Per-store key-value settings (printer config, invoice prefix, etc.)
--      Composite PK prevents duplicate keys per store.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
    store_id  uuid  NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    key       text  NOT NULL,
    value     text,

    PRIMARY KEY (store_id, key)
);

COMMENT ON TABLE public.app_settings IS 'Key-value store for per-store configuration (printer type, GST number, invoice prefix, etc.)';


-- ---------------------------------------------------------------------------
-- 1.10  sync_log
--       Tracks offline mutations made on a local SQLite device.
--       The background sync engine reads this to push/pull changes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_log (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id    uuid        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    device_id   text        NOT NULL,            -- unique per Tauri install
    table_name  text        NOT NULL,
    record_id   uuid        NOT NULL,
    operation   text        NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    payload     jsonb,                           -- full changed row JSON
    synced_at   timestamptz,                     -- NULL = pending push to cloud
    created_at  timestamptz NOT NULL DEFAULT now(),
    version     bigint      NOT NULL DEFAULT 1,
    client_ts   timestamptz NOT NULL             -- device clock at change time
);

COMMENT ON TABLE public.sync_log IS 'Outbox queue for offline-first sync. synced_at=NULL means the change is still pending upload.';


-- =============================================================================
-- SECTION 2 : INDEXES
-- =============================================================================

-- stores
CREATE INDEX IF NOT EXISTS idx_stores_created_by  ON public.stores(created_by);
CREATE INDEX IF NOT EXISTS idx_stores_active       ON public.stores(is_active) WHERE is_active = true;

-- store_users
CREATE INDEX IF NOT EXISTS idx_store_users_store   ON public.store_users(store_id);
CREATE INDEX IF NOT EXISTS idx_store_users_user    ON public.store_users(user_id);
CREATE INDEX IF NOT EXISTS idx_store_users_active  ON public.store_users(user_id, store_id) WHERE is_active = true;

-- items
CREATE INDEX IF NOT EXISTS idx_items_store          ON public.items(store_id);
CREATE INDEX IF NOT EXISTS idx_items_store_name     ON public.items(store_id, name);
CREATE INDEX IF NOT EXISTS idx_items_store_hsn      ON public.items(store_id, hsn);
CREATE INDEX IF NOT EXISTS idx_items_store_category ON public.items(store_id, category);
-- GIN trigram index: powers ILIKE '%medicine%' full-text search at scale
CREATE INDEX IF NOT EXISTS idx_items_name_trgm      ON public.items USING gin (name gin_trgm_ops);
-- Partial index: cheap low-stock alert queries
CREATE INDEX IF NOT EXISTS idx_items_low_stock       ON public.items(store_id, current_stock)
    WHERE current_stock <= min_stock AND is_active = true;

-- parties
CREATE INDEX IF NOT EXISTS idx_parties_store        ON public.parties(store_id);
CREATE INDEX IF NOT EXISTS idx_parties_store_name   ON public.parties(store_id, name);
CREATE INDEX IF NOT EXISTS idx_parties_store_phone  ON public.parties(store_id, phone);
CREATE INDEX IF NOT EXISTS idx_parties_store_type   ON public.parties(store_id, type);
CREATE INDEX IF NOT EXISTS idx_parties_name_trgm    ON public.parties USING gin (name gin_trgm_ops);

-- transactions
CREATE INDEX IF NOT EXISTS idx_txns_store           ON public.transactions(store_id);
CREATE INDEX IF NOT EXISTS idx_txns_store_date      ON public.transactions(store_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_txns_store_type      ON public.transactions(store_id, type);
CREATE INDEX IF NOT EXISTS idx_txns_store_party     ON public.transactions(store_id, party_id);
CREATE INDEX IF NOT EXISTS idx_txns_store_invoice   ON public.transactions(store_id, invoice_no);
-- Partial index: only unpaid bills (used for outstanding-dues queries)
CREATE INDEX IF NOT EXISTS idx_txns_unpaid          ON public.transactions(store_id, party_id)
    WHERE status != 'paid';

-- transaction_items
CREATE INDEX IF NOT EXISTS idx_txn_items_txn        ON public.transaction_items(txn_id);
CREATE INDEX IF NOT EXISTS idx_txn_items_item       ON public.transaction_items(item_id);
CREATE INDEX IF NOT EXISTS idx_txn_items_batch      ON public.transaction_items(batch_no);

-- order_book
CREATE INDEX IF NOT EXISTS idx_order_book_store     ON public.order_book(store_id);
CREATE INDEX IF NOT EXISTS idx_order_book_status    ON public.order_book(store_id, status);

-- sync_log
CREATE INDEX IF NOT EXISTS idx_sync_pending         ON public.sync_log(store_id, device_id, synced_at)
    WHERE synced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sync_table           ON public.sync_log(store_id, table_name, created_at);


-- =============================================================================
-- SECTION 3 : TRIGGERS — auto-update updated_at timestamps
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Apply trigger to every table that has updated_at
DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'stores', 'store_users', 'items', 'parties', 'transactions'
    ] LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_updated_at ON public.%I;
             CREATE TRIGGER trg_updated_at
             BEFORE UPDATE ON public.%I
             FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();',
            tbl, tbl
        );
    END LOOP;
END;
$$;


-- =============================================================================
-- SECTION 4 : HELPER FUNCTIONS  (SECURITY DEFINER = runs as DB owner, not client)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 4.1  get_user_store_ids()
--      Returns every store_id the current JWT-authenticated user belongs to.
--      Called inside RLS policies — must be fast (indexed lookup).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_store_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT store_id
    FROM   public.store_users
    WHERE  user_id   = auth.uid()
    AND    is_active  = true;
$$;


-- ---------------------------------------------------------------------------
-- 4.2  is_super_admin()
--      Returns true if the current user is the super-admin.
--      Stored in auth.users.raw_user_meta_data->>'role'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT (raw_user_meta_data->>'role' = 'super_admin' OR email = 'winmihir@gmail.com')
         FROM   auth.users
         WHERE  id = auth.uid()),
        false
    );
$$;


-- ---------------------------------------------------------------------------
-- 4.3  user_role_in_store(p_store_id uuid)
--      Returns the caller's role ('owner'|'cashier'|'viewer') in a given store,
--      or NULL if they don't belong to that store.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_role_in_store(p_store_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT role
    FROM   public.store_users
    WHERE  store_id  = p_store_id
    AND    user_id   = auth.uid()
    AND    is_active = true
    LIMIT  1;
$$;


-- =============================================================================
-- SECTION 5 : ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- Core philosophy:
--   • Super-admin → full access to everything (USING is_super_admin())
--   • Store members → can only see/touch their own store's data
--   • Cashiers → can INSERT sales but cannot DELETE or change settings
-- =============================================================================

ALTER TABLE public.stores             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parties            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_special_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_book         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_log           ENABLE ROW LEVEL SECURITY;


-- ── STORES ──────────────────────────────────────────────────────────────────

-- Super-admin: read + write everything
CREATE POLICY "super_admin_all_stores"
    ON public.stores
    FOR ALL
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- Regular users: only see stores they are active members of
CREATE POLICY "member_can_see_own_store"
    ON public.stores
    FOR SELECT
    USING (id IN (SELECT public.get_user_store_ids()));

-- Owners can update their own store's metadata (name, phone, address, logo)
CREATE POLICY "owner_can_update_store"
    ON public.stores
    FOR UPDATE
    USING (
        public.user_role_in_store(id) = 'owner'
    )
    WITH CHECK (
        public.user_role_in_store(id) = 'owner'
    );


-- ── STORE_USERS ──────────────────────────────────────────────────────────────

-- Super-admin: full access
CREATE POLICY "super_admin_all_store_users"
    ON public.store_users
    FOR ALL
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- Any authenticated member: see other members of their own store
CREATE POLICY "member_can_see_store_members"
    ON public.store_users
    FOR SELECT
    USING (store_id IN (SELECT public.get_user_store_ids()));

-- A user can always see their own record (needed on login before store is loaded)
CREATE POLICY "user_can_see_self"
    ON public.store_users
    FOR SELECT
    USING (user_id = auth.uid());

-- Owners can manage cashiers (INSERT / UPDATE / DELETE) within their store
CREATE POLICY "owner_manages_cashiers"
    ON public.store_users
    FOR ALL
    USING  (public.user_role_in_store(store_id) = 'owner')
    WITH CHECK (public.user_role_in_store(store_id) = 'owner');


-- ── ITEMS ────────────────────────────────────────────────────────────────────

-- Super-admin
CREATE POLICY "super_admin_all_items"
    ON public.items FOR ALL
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- Any store member can read items
CREATE POLICY "member_can_read_items"
    ON public.items
    FOR SELECT
    USING (store_id IN (SELECT public.get_user_store_ids()));

-- Owners and cashiers can INSERT and UPDATE items (for stock management)
CREATE POLICY "staff_can_insert_items"
    ON public.items
    FOR INSERT
    WITH CHECK (
        store_id IN (SELECT public.get_user_store_ids())
    );

CREATE POLICY "staff_can_update_items"
    ON public.items
    FOR UPDATE
    USING (store_id IN (SELECT public.get_user_store_ids()))
    WITH CHECK (store_id IN (SELECT public.get_user_store_ids()));

-- Only OWNERS can delete items (not cashiers)
CREATE POLICY "owner_can_delete_items"
    ON public.items
    FOR DELETE
    USING (public.user_role_in_store(store_id) = 'owner');


-- ── PARTIES ──────────────────────────────────────────────────────────────────

CREATE POLICY "super_admin_all_parties"
    ON public.parties FOR ALL
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

CREATE POLICY "member_read_parties"
    ON public.parties FOR SELECT
    USING (store_id IN (SELECT public.get_user_store_ids()));

CREATE POLICY "staff_insert_parties"
    ON public.parties FOR INSERT
    WITH CHECK (store_id IN (SELECT public.get_user_store_ids()));

CREATE POLICY "staff_update_parties"
    ON public.parties FOR UPDATE
    USING (store_id IN (SELECT public.get_user_store_ids()))
    WITH CHECK (store_id IN (SELECT public.get_user_store_ids()));

CREATE POLICY "owner_delete_parties"
    ON public.parties FOR DELETE
    USING (public.user_role_in_store(store_id) = 'owner');


-- ── TRANSACTIONS ─────────────────────────────────────────────────────────────

CREATE POLICY "super_admin_all_transactions"
    ON public.transactions FOR ALL
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- All store members can read transactions
CREATE POLICY "member_read_transactions"
    ON public.transactions FOR SELECT
    USING (store_id IN (SELECT public.get_user_store_ids()));

-- Any staff member can create transactions (sales/purchases)
CREATE POLICY "staff_insert_transactions"
    ON public.transactions FOR INSERT
    WITH CHECK (store_id IN (SELECT public.get_user_store_ids()));

-- Any staff can update (e.g., mark payment received) — but DELETE is owner-only
CREATE POLICY "staff_update_transactions"
    ON public.transactions FOR UPDATE
    USING  (store_id IN (SELECT public.get_user_store_ids()))
    WITH CHECK (store_id IN (SELECT public.get_user_store_ids()));

-- CRITICAL: Only store OWNERS can delete transactions
CREATE POLICY "owner_delete_transactions"
    ON public.transactions FOR DELETE
    USING (public.user_role_in_store(store_id) = 'owner');


-- ── TRANSACTION_ITEMS ─────────────────────────────────────────────────────────
-- transaction_items has no store_id — we join via transactions for security.

CREATE POLICY "super_admin_all_txn_items"
    ON public.transaction_items FOR ALL
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- Access allowed if the parent transaction is in one of the user's stores
CREATE POLICY "member_access_txn_items"
    ON public.transaction_items FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM   public.transactions t
            WHERE  t.id       = public.transaction_items.txn_id
            AND    t.store_id IN (SELECT public.get_user_store_ids())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM   public.transactions t
            WHERE  t.id       = public.transaction_items.txn_id
            AND    t.store_id IN (SELECT public.get_user_store_ids())
        )
    );


-- ── PARTY_SPECIAL_RATES ───────────────────────────────────────────────────────

CREATE POLICY "super_admin_all_special_rates"
    ON public.party_special_rates FOR ALL
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

CREATE POLICY "member_access_special_rates"
    ON public.party_special_rates FOR ALL
    USING  (store_id IN (SELECT public.get_user_store_ids()))
    WITH CHECK (store_id IN (SELECT public.get_user_store_ids()));


-- ── ORDER_BOOK ───────────────────────────────────────────────────────────────

CREATE POLICY "super_admin_all_order_book"
    ON public.order_book FOR ALL
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

CREATE POLICY "member_access_order_book"
    ON public.order_book FOR ALL
    USING  (store_id IN (SELECT public.get_user_store_ids()))
    WITH CHECK (store_id IN (SELECT public.get_user_store_ids()));


-- ── APP_SETTINGS ──────────────────────────────────────────────────────────────

CREATE POLICY "super_admin_all_settings"
    ON public.app_settings FOR ALL
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- Any store member can read settings (needed to load printer config, etc.)
CREATE POLICY "member_read_settings"
    ON public.app_settings FOR SELECT
    USING (store_id IN (SELECT public.get_user_store_ids()));

-- Only owners can change store settings
CREATE POLICY "owner_write_settings"
    ON public.app_settings FOR ALL
    USING  (public.user_role_in_store(store_id) = 'owner')
    WITH CHECK (public.user_role_in_store(store_id) = 'owner');


-- ── SYNC_LOG ─────────────────────────────────────────────────────────────────

CREATE POLICY "super_admin_all_sync_log"
    ON public.sync_log FOR ALL
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

CREATE POLICY "member_access_sync_log"
    ON public.sync_log FOR ALL
    USING  (store_id IN (SELECT public.get_user_store_ids()))
    WITH CHECK (store_id IN (SELECT public.get_user_store_ids()));


-- =============================================================================
-- SECTION 6 : SUPER ADMIN BOOTSTRAP
-- =============================================================================
-- This creates the super-admin user account in Supabase Auth and flags them
-- with role='super_admin' in their JWT metadata.
--
-- ⚠️  IMPORTANT: This directly inserts into auth.users with a hashed password.
--     This approach works ONLY when run inside the Supabase SQL Editor (you have
--     database owner privileges). It will NOT work from the app client.
--
-- Email    : winmihir@gmail.com
-- Password : 563563@123
-- =============================================================================

DO $$
DECLARE
    v_user_id uuid;
    v_existing uuid;
BEGIN
    -- Check if super admin already exists
    SELECT id INTO v_existing
    FROM auth.users
    WHERE email = 'winmihir@gmail.com'
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
        RAISE NOTICE 'Super admin winmihir@gmail.com already exists. Skipping creation.';

        -- Still ensure the metadata role is set correctly
        UPDATE auth.users
        SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object('role', 'super_admin')
        WHERE id = v_existing;

        RAISE NOTICE 'Ensured super_admin role is set in metadata.';
        RETURN;
    END IF;

    -- Generate a stable UUID for the super-admin
    v_user_id := gen_random_uuid();

    -- Insert into auth.users (Supabase internal table)
    INSERT INTO auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        is_super_admin,
        created_at,
        updated_at,
        last_sign_in_at,
        confirmation_token,
        email_change,
        email_change_token_new,
        recovery_token
    )
    VALUES (
        v_user_id,
        '00000000-0000-0000-0000-000000000000',  -- default instance_id
        'authenticated',
        'authenticated',
        'winmihir@gmail.com',
        crypt('563563@123', gen_salt('bf')),       -- bcrypt-hashed password
        now(),                                     -- email pre-confirmed
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object(
            'role',         'super_admin',
            'display_name', 'Mihir (Super Admin)'
        ),
        false,   -- is_super_admin (Supabase internal flag — we use our own role)
        now(),
        now(),
        now(),
        '',
        '',
        '',
        ''
    );

    -- Insert the corresponding identity record (required for email+password sign-in)
    INSERT INTO auth.identities (
        id,
        user_id,
        provider_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at
    )
    VALUES (
        gen_random_uuid(),
        v_user_id,
        v_user_id::text,
        jsonb_build_object(
            'sub',   v_user_id::text,
            'email', 'winmihir@gmail.com'
        ),
        'email',
        now(),
        now(),
        now()
    );

    RAISE NOTICE 'Super admin created successfully! ID = %', v_user_id;
END;
$$;


-- =============================================================================
-- SECTION 7 : REALTIME (enable for live multi-device sync)
-- =============================================================================
-- Allows Supabase Realtime to broadcast changes on these tables.
-- The client subscribes via:
--   supabase.channel('store-changes').on('postgres_changes', ...)

ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transaction_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.parties;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_book;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_log;


-- =============================================================================
-- SECTION 8 : DEFAULT SETTINGS HELPER FUNCTION
-- =============================================================================
-- Called after creating a store to seed sensible default settings.

CREATE OR REPLACE FUNCTION public.seed_default_store_settings(p_store_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.app_settings (store_id, key, value)
    VALUES
        (p_store_id, 'invoice_prefix',      'INV'),
        (p_store_id, 'purchase_prefix',     'PUR'),
        (p_store_id, 'printer_type',        'thermal_80mm'),
        (p_store_id, 'printer_auto_print',  'false'),
        (p_store_id, 'currency_symbol',     '₹'),
        (p_store_id, 'date_format',         'DD/MM/YYYY'),
        (p_store_id, 'low_stock_alert',     'true'),
        (p_store_id, 'gst_enabled',         'true')
    ON CONFLICT (store_id, key) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.seed_default_store_settings IS
    'Call this after inserting a new store to seed default configuration values.';


-- =============================================================================
-- DONE ✅
-- =============================================================================
-- Summary of what was created:
--   Tables  : stores, store_users, items, parties, transactions,
--             transaction_items, party_special_rates, order_book,
--             app_settings, sync_log
--   Indexes : 25+ performance indexes including GIN trigram for search
--   Triggers: auto updated_at on 5 tables
--   Functions: handle_updated_at, get_user_store_ids, is_super_admin,
--              user_role_in_store, seed_default_store_settings
--   RLS     : Full multi-tenant isolation on all 10 tables
--   Auth    : Super admin created (winmihir@gmail.com)
--   Realtime: Enabled on 6 core tables
-- =============================================================================
