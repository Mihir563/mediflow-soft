# MediFlow SaaS — Supabase Setup

This folder contains the one-time SQL setup for the MediFlow SaaS backend.

## Files

| File | Purpose |
|---|---|
| `schema_and_rls.sql` | **Run this once.** Creates all tables, indexes, triggers, RLS policies, helper functions, Realtime subscriptions, and the super-admin user. |
| `verify_setup.sql` | Run these queries after setup to confirm everything worked. |

---

## How to Run

### Step 1 — Open Supabase SQL Editor

1. Go to [supabase.com](https://supabase.com) → your project
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**

### Step 2 — Paste & Run the Schema

1. Open `schema_and_rls.sql` (it's in this folder)
2. Select ALL the content (Ctrl+A)
3. Paste it into the SQL Editor
4. Click **Run** (or press Ctrl+Enter)
5. Wait for all `Success` messages in the output panel

> ⚠️ The script is idempotent — it uses `IF NOT EXISTS` everywhere, so running it twice is safe. But run it only once to keep logs clean.

### Step 3 — Verify

1. Open `verify_setup.sql`
2. Run each `CHECK` block one at a time
3. All expected results should match

---

## Super Admin Account

| Field | Value |
|---|---|
| Email | `winmihir@gmail.com` |
| Password | `563563@123` |
| Role (in JWT meta) | `super_admin` |

After running the SQL, you can log in from the app with these credentials. The `is_super_admin()` PostgreSQL function reads the `role` field from `auth.users.raw_user_meta_data` and grants full unrestricted access to all stores and data.

---

## What Was Created

### Tables (10)

| Table | Purpose |
|---|---|
| `stores` | Master store registry — only super-admin creates |
| `store_users` | Maps auth users → stores with roles (owner/cashier/viewer) |
| `items` | Per-store product/medicine catalog |
| `parties` | Per-store customers and vendors |
| `transactions` | Sales invoices and purchase bills |
| `transaction_items` | Line items for each invoice |
| `party_special_rates` | Custom price/discount per (party, item) |
| `order_book` | Pending purchase orders |
| `app_settings` | Per-store key-value configuration |
| `sync_log` | Offline sync outbox queue |

### Functions (5)

| Function | Returns | Purpose |
|---|---|---|
| `get_user_store_ids()` | `SETOF uuid` | Returns all store IDs for the current JWT user |
| `is_super_admin()` | `boolean` | Checks if current user has `super_admin` role in metadata |
| `user_role_in_store(store_id)` | `text` | Returns `owner`/`cashier`/`viewer` for the current user in a store |
| `handle_updated_at()` | trigger | Auto-updates `updated_at` timestamps |
| `seed_default_store_settings(store_id)` | void | Seeds default printer/invoice settings for a new store |

### RLS Policy Summary

| Table | Super Admin | Owner | Cashier | Viewer |
|---|---|---|---|---|
| `stores` | All | Read + Update own | Read only | Read only |
| `store_users` | All | Manage cashiers | See self | See members |
| `items` | All | CRUD | Read + Write (no delete) | Read |
| `parties` | All | CRUD | Read + Write (no delete) | Read |
| `transactions` | All | CRUD | Read + Insert | Read |
| `transaction_items` | All | CRUD (via txn) | Read + Insert | Read |
| `party_special_rates` | All | CRUD | CRUD | Read |
| `order_book` | All | CRUD | CRUD | Read |
| `app_settings` | All | Read + Write | Read only | Read only |
| `sync_log` | All | CRUD | CRUD | Read |

---

## Next Steps After Setup

1. **Log in as super-admin** using `winmihir@gmail.com` / `563563@123`
2. **Create first store** — run this SQL as super-admin (or via Edge Function):
   ```sql
   INSERT INTO stores (name, gstin, address, phone, created_by)
   VALUES ('Raghuveer Medical', 'YOUR_GSTIN', 'Your Address', '9876543210',
           (SELECT id FROM auth.users WHERE email = 'winmihir@gmail.com'))
   RETURNING id;

   -- Seed default settings for the new store
   SELECT seed_default_store_settings('STORE_UUID_FROM_ABOVE');
   ```
3. **Migrate existing SQLite data** — we'll build the migration script next
4. **Set up the app** — add Supabase URL + anon key to `.env.local`
