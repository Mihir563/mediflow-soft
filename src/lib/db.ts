import Database from '@tauri-apps/plugin-sql';

let dbInstance: Database | null = null;

// Safely add a column to an existing table (no-op if it already exists)
const safeAddColumn = async (db: Database, table: string, column: string, type: string) => {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (_) {
    // Column already exists — ignore
  }
};

export const initDB = async () => {
  if (dbInstance) return dbInstance;
  
  dbInstance = await Database.load('sqlite:mediflow.db');

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
      batch_no TEXT,
      expiry_date TEXT,
      FOREIGN KEY(txn_id) REFERENCES transactions(id),
      FOREIGN KEY(item_id) REFERENCES items(id)
    )
  `);

  // Migrate existing tables that may be missing new columns  
  await safeAddColumn(dbInstance, 'transaction_items', 'item_name', 'TEXT');
  await safeAddColumn(dbInstance, 'transaction_items', 'amount', 'REAL DEFAULT 0');
  await safeAddColumn(dbInstance, 'transaction_items', 'discount_pct', 'REAL DEFAULT 0');
  await safeAddColumn(dbInstance, 'transaction_items', 'tax_pct', 'REAL DEFAULT 0');
  await safeAddColumn(dbInstance, 'items', 'tabs_per_strip', 'REAL DEFAULT 10');
  await safeAddColumn(dbInstance, 'items', 'strips_per_box', 'REAL DEFAULT 10');
  await safeAddColumn(dbInstance, 'order_book', 'status', "TEXT DEFAULT 'pending'");
  await safeAddColumn(dbInstance, 'order_book', 'ordered_at', "TEXT");

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
  await dbInstance.execute(`CREATE INDEX IF NOT EXISTS idx_txn_items_txn ON transaction_items(txn_id)`);
  await dbInstance.execute(`CREATE INDEX IF NOT EXISTS idx_txn_items_item ON transaction_items(item_id)`);
  await dbInstance.execute(`CREATE INDEX IF NOT EXISTS idx_txn_items_batch ON transaction_items(batch_no)`);

  return dbInstance;
};

export const getDB = async () => {
  if (!dbInstance) {
    return await initDB();
  }
  return dbInstance;
};
