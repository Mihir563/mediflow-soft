import Database from '@tauri-apps/plugin-sql';

let dbInstance: Database | null = null;
// Keep every caller behind the same initialization work. Returning dbInstance
// before migrations finish allows read requests to collide with startup writes.
let dbInitPromise: Promise<Database> | null = null;

// Safely add a column to an existing table (no-op if it already exists)
const safeAddColumn = async (db: Database, table: string, column: string, type: string) => {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('duplicate column') && !msg.includes('already exists')) {
      console.warn(`safeAddColumn error adding ${column} to ${table}:`, e);
    }
  }
};

export const initDB = async () => {
  if (dbInitPromise) return dbInitPromise;
  if (dbInstance) return dbInstance;

  dbInitPromise = (async () => {
    dbInstance = await Database.load('sqlite:mediflow.db');
    // SQLite can briefly be busy while Tauri finishes opening the local file.
    // Wait for that write lock instead of failing the startup migration.
    await dbInstance.execute('PRAGMA busy_timeout = 5000');

  // Items table
  await dbInstance.execute(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      hsn TEXT,
      unit TEXT,
      sale_price REAL,
      purchase_price REAL,
      opening_stock REAL DEFAULT 0,
      current_stock REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      category TEXT,
      tax_rate REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      inclusive_tax INTEGER DEFAULT 0
    )
  `);

  // Parties table
  await dbInstance.execute(`
    CREATE TABLE IF NOT EXISTS parties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      gstin TEXT,
      address TEXT,
      type TEXT,
      opening_balance REAL DEFAULT 0
    )
  `);

  // Transactions table
  await dbInstance.execute(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT,
      date TEXT NOT NULL,
      party_id INTEGER,
      total_amount REAL NOT NULL,
      paid_amount REAL DEFAULT 0,
      balance_due REAL DEFAULT 0,
      type TEXT NOT NULL,
      payment_type TEXT DEFAULT 'cash',
      status TEXT DEFAULT 'paid',
      challan_no TEXT,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY(party_id) REFERENCES parties(id)
    )
  `);

  // Transaction Items table — item_id is nullable for migrated data where exact match wasn't found
  await dbInstance.execute(`
    CREATE TABLE IF NOT EXISTS transaction_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      txn_id INTEGER NOT NULL,
      item_id INTEGER,
      item_name TEXT,
      quantity REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      amount REAL DEFAULT 0,
      discount_pct REAL DEFAULT 0,
      tax_pct REAL DEFAULT 0,
      scheme_amount REAL DEFAULT 0,
      batch_no TEXT,
      expiry_date TEXT,
      FOREIGN KEY(txn_id) REFERENCES transactions(id),
      FOREIGN KEY(item_id) REFERENCES items(id)
    )
  `);

  // Migrate existing tables that may be missing new columns  
  await safeAddColumn(dbInstance, 'transaction_items', 'item_name', 'TEXT');
  await safeAddColumn(dbInstance, 'transaction_items', 'unit', 'TEXT');
  await safeAddColumn(dbInstance, 'transaction_items', 'amount', 'REAL DEFAULT 0');
  await safeAddColumn(dbInstance, 'transaction_items', 'discount_pct', 'REAL DEFAULT 0');
  await safeAddColumn(dbInstance, 'transaction_items', 'discount_amt', 'REAL DEFAULT 0');
  await safeAddColumn(dbInstance, 'transaction_items', 'tax_pct', 'REAL DEFAULT 0');
  await safeAddColumn(dbInstance, 'transaction_items', 'tax_amt', 'REAL DEFAULT 0');
  await safeAddColumn(dbInstance, 'transaction_items', 'scheme_amount', 'REAL DEFAULT 0');
  await safeAddColumn(dbInstance, 'items', 'tabs_per_strip', 'REAL DEFAULT 10');
  await safeAddColumn(dbInstance, 'items', 'strips_per_box', 'REAL DEFAULT 10');
  await safeAddColumn(dbInstance, 'items', 'default_vendor_id', 'INTEGER');
  await safeAddColumn(dbInstance, 'order_book', 'status', "TEXT DEFAULT 'pending'");
  await safeAddColumn(dbInstance, 'order_book', 'ordered_at', "TEXT");
  await safeAddColumn(dbInstance, 'order_book', 'vendor_id', "INTEGER");
  await safeAddColumn(dbInstance, 'order_book', 'vendor_name', "TEXT");
  await safeAddColumn(dbInstance, 'order_book', 'vendor_phone', "TEXT");
  // Add created_at to transactions if it doesn't exist yet (for existing DBs)
  await safeAddColumn(dbInstance, 'transactions', 'created_at', "TEXT");

  // Backfill created_at for older transactions
  try {
    await dbInstance.execute(`
      UPDATE transactions 
      SET created_at = date || ' 12:00:00' 
      WHERE created_at IS NULL AND date IS NOT NULL
    `);
  } catch (e) {
    console.error("Failed to backfill transactions created_at:", e);
  }

  // Auto-Deduplicate historical bugs from import scripts
  try {
    // 0. Delete fake/duplicate transactions (and their items) that have the wrong type for their party
    // (e.g. if a vendor has a "sale" transaction, it was a duplicate bug from a previous import)
    await dbInstance.execute(`
      DELETE FROM transaction_items 
      WHERE txn_id IN (
        SELECT t.id FROM transactions t
        JOIN parties p ON p.id = t.party_id
        WHERE (p.type = 'vendor' AND t.type = 'sale')
           OR (p.type = 'customer' AND t.type = 'purchase')
      )
    `);
    
    await dbInstance.execute(`
      DELETE FROM transactions 
      WHERE id IN (
        SELECT t.id FROM transactions t
        JOIN parties p ON p.id = t.party_id
        WHERE (p.type = 'vendor' AND t.type = 'sale')
           OR (p.type = 'customer' AND t.type = 'purchase')
      )
    `);

    // 1. Remove duplicate items (exact matches for same txn)
    await dbInstance.execute(`
      DELETE FROM transaction_items 
      WHERE id NOT IN (
        SELECT MIN(id) FROM transaction_items 
        GROUP BY txn_id, item_id, quantity, price
      )
    `);
    
    // 2. Re-point any orphaned transaction_items to the primary transaction before deleting duplicates
    await dbInstance.execute(`
      UPDATE transaction_items
      SET txn_id = (
        SELECT MIN(id) FROM transactions t2 
        WHERE t2.invoice_no = (SELECT invoice_no FROM transactions WHERE id = transaction_items.txn_id)
          AND t2.type = (SELECT type FROM transactions WHERE id = transaction_items.txn_id)
      )
    `);

    // 3. Remove duplicate transactions (same invoice_no + type)
    await dbInstance.execute(`
      DELETE FROM transactions 
      WHERE id NOT IN (
        SELECT MIN(id) FROM transactions 
        GROUP BY invoice_no, type
      )
    `);
  } catch (e) {
    console.error("Failed to deduplicate database:", e);
  }

  // Create trigger to automatically set created_at for future inserts where it's NULL
  try {
    await dbInstance.execute(`
      CREATE TRIGGER IF NOT EXISTS trg_transactions_created_at
      AFTER INSERT ON transactions
      FOR EACH ROW
      WHEN NEW.created_at IS NULL
      BEGIN
        UPDATE transactions 
        SET created_at = datetime('now', 'localtime') 
        WHERE id = NEW.id;
      END;
    `);
  } catch (e) {
    console.error("Failed to create trigger trg_transactions_created_at:", e);
  }

  // Party Special Rates
  await dbInstance.execute(`
    CREATE TABLE IF NOT EXISTS party_special_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      party_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      price REAL,
      discount REAL,
      FOREIGN KEY(party_id) REFERENCES parties(id),
      FOREIGN KEY(item_id) REFERENCES items(id),
      UNIQUE(party_id, item_id)
    )
  `);

  // App Settings
  await dbInstance.execute(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Order Book
  await dbInstance.execute(`
    CREATE TABLE IF NOT EXISTS order_book (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER,
      item_name TEXT,
      quantity REAL DEFAULT 1
    )
  `);

  // Performance indexes for search
  await dbInstance.execute(`CREATE INDEX IF NOT EXISTS idx_items_name ON items(name)`);
  await dbInstance.execute(`CREATE INDEX IF NOT EXISTS idx_items_hsn ON items(hsn)`);
  await dbInstance.execute(`CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(name)`);
  await dbInstance.execute(`CREATE INDEX IF NOT EXISTS idx_parties_phone ON parties(phone)`);
  await dbInstance.execute(`CREATE INDEX IF NOT EXISTS idx_transactions_invoice ON transactions(invoice_no)`);
  await dbInstance.execute(`CREATE INDEX IF NOT EXISTS idx_transactions_party ON transactions(party_id)`);
  await dbInstance.execute(`CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)`);
  await dbInstance.execute(`CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at)`);
  await dbInstance.execute(`CREATE INDEX IF NOT EXISTS idx_txn_items_txn ON transaction_items(txn_id)`);
  await dbInstance.execute(`CREATE INDEX IF NOT EXISTS idx_txn_items_item ON transaction_items(item_id)`);
  // Auto-Reconcile unlinked transaction_items into items catalog
  try {
    // 1. Link unlinked transaction_items to items table by case-insensitive name match
    await dbInstance.execute(`
      UPDATE transaction_items
      SET item_id = (
        SELECT i.id FROM items i
        WHERE LOWER(TRIM(i.name)) = LOWER(TRIM(transaction_items.item_name))
        LIMIT 1
      )
      WHERE item_id IS NULL AND item_name IS NOT NULL AND TRIM(item_name) != ''
    `);

    // 2. Auto-create catalog entries for any item_names in transaction_items that don't exist in items
    const missingItems = await dbInstance.select<{ item_name: string; unit?: string; price?: number; tax_pct?: number; discount_pct?: number }[]>(`
      SELECT item_name, MAX(unit) as unit, AVG(price) as price, MAX(tax_pct) as tax_pct, MAX(discount_pct) as discount_pct
      FROM transaction_items
      WHERE item_id IS NULL AND item_name IS NOT NULL AND TRIM(item_name) != ''
      GROUP BY LOWER(TRIM(item_name))
    `);

    for (const item of missingItems) {
      if (!item.item_name || !item.item_name.trim()) continue;
      const cleanName = item.item_name.trim();
      const priceVal = Number(item.price) || 0;
      const res = await dbInstance.execute(
        `INSERT INTO items (name, unit, purchase_price, sale_price, current_stock, min_stock, opening_stock, tax_rate, discount, tabs_per_strip, strips_per_box)
         VALUES ($1, $2, $3, $4, 0, 0, 0, $5, $6, 10, 10)`,
        [cleanName, item.unit || 'TAB', priceVal, priceVal, Number(item.tax_pct) || 0, Number(item.discount_pct) || 0]
      );
      const newId = (res as { lastInsertId?: number }).lastInsertId;
      if (newId) {
        await dbInstance.execute(
          `UPDATE transaction_items SET item_id = $1 WHERE LOWER(TRIM(item_name)) = LOWER(TRIM($2)) AND item_id IS NULL`,
          [newId, cleanName]
        );
      }
    }
  } catch (e) {
    console.error("Failed to auto-reconcile transaction items:", e);
  }

    return dbInstance!;
  })();


  try {
    return await dbInitPromise;
  } catch (error) {
    dbInstance = null;
    dbInitPromise = null;
    throw error;
  }
};

export const getDB = async () => {
  if (dbInitPromise) return await dbInitPromise;
  if (!dbInstance) {
    return await initDB();
  }
  return dbInstance;
};

// Tables synced with cloud
export const SYNC_TABLES = [
  'items',
  'parties',
  'transactions',
  'transaction_items',
  'order_book',
  'party_special_rates',
  'app_settings',
] as const;

export type SyncTable = typeof SYNC_TABLES[number];

export async function getLocalStats(): Promise<Record<string, number>> {
  const db = await getDB();
  const stats: Record<string, number> = {};
  for (const table of SYNC_TABLES) {
    try {
      const res = await db.select<{ cnt: number }[]>(`SELECT COUNT(*) as cnt FROM ${table}`);
      stats[table] = res[0]?.cnt || 0;
    } catch {
      stats[table] = 0;
    }
  }
  return stats;
}
