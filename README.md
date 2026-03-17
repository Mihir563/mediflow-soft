# MediFlow Billing Software

MediFlow is a comprehensive, desktop-first billing and inventory management application designed to match the UI and features commonly found in offline billing software like Vyapar.

Built with Next.js, Tailwind CSS, Tauri, and Better-SQLite3, it operates fully offline with blazing-fast native performance.

## Key Features

- **Full Offline Architecture:** Uses a local SQLite database for instantaneous saves and lookups.
- **Dynamic Fast Billing (POS):** Full-screen, keyboard-driven UI designed for high-speed counter billing.
- **Purchase Management:** Track inventory influx with accurate purchase, tax, and batch tracking.
- **Inventory & Stock Tracking:** Real-time stock counts with "Low Stock" alerts and complete item histories.
- **Party Ledger & Custom Pricing:** Track Accounts Receivable/Payable and assign specific default rates/discounts to specific hospitals or vendors.
- **Global Search (`Ctrl+F`):** Search instantly across items, parties, bills, and batch numbers from anywhere in the app.
- **Comprehensive Reports:** Sales, Purchases, Stock Details, and Party Ledgers with actionable data.
- **Vyapar Data Migration:** Built-in tool to import your old `Export Items.xlsx` and `PartyReport.xlsx` files directly into MediFlow.

## Database Schema Overview

The raw SQLite schema is located and initialized in `src/lib/db.ts`.

### `items`
Stores the product inventory.
- `id`: Primary Key
- `name`: Product Name
- `hsn`, `category`, `unit`: Descriptors
- `sale_price`, `purchase_price`, `tax_rate`, `discount`: Primary financial constants
- `current_stock`, `min_stock`: Inventory tracking

### `parties`
Customers and Vendors.
- `id`: Primary Key
- `name`, `phone`, `gstin`, `address`
- `type`: 'customer' | 'vendor'
- `opening_balance`: Handles legacy balances migrated from previous software.

### `party_special_rates`
Lookup table to handle the "Custom Item Rates" feature per hospital/party.
- `party_id`, `item_id`: Composite lookup
- `price`, `discount`: Overrides the default `sale_price` and `discount` on the `items` table when this party is selected in billing.

### `transactions`
Parent table for Sales and Purchase Bills.
- `id`: Primary Key
- `invoice_no`: Example `INV-0001`
- `date`
- `party_id`: Nullable (for walk-in cash customers)
- `type`: 'sale' | 'purchase'
- `total_amount`, `paid_amount`, `balance_due`: Financial accounting.
- `status`: 'paid' | 'partial' | 'unpaid'

### `transaction_items`
Child line-items belonging to a Transaction.
- `id`, `txn_id`, `item_id`
- `quantity`, `price`, `amount`
- `discount_pct`, `tax_pct`
- `batch_no`, `expiry_date`

## Global Keyboard Shortcuts
MediFlow is heavily optimized for keyboard use.

| Shortcut | Action |
| --- | --- |
| `Alt+1` to `Alt+7` | Instantly jump to any Sidebar tab |
| `Ctrl+F` | Open Global Search |
| `F4` | Search and Add Item (inside Billing) |
| `Ctrl+S` | Save current Invoice / Purchase Bill |
| `Ctrl+N` | Create new Item / Party (when on their respective screens) |
| `Ctrl+K` | Show Global Shortcuts cheat sheet |
| `Esc` | Close dropdowns / Clear focus |

## Startup Commands
Because this is a Tauri v2 application, it must be run via the Tauri CLI to have access to the native SQLite database context. Standard Next.js `npm run dev` will not connect to the database.

- **Development:** `npx tauri dev`
- **Build EXE:** `npx tauri build`
