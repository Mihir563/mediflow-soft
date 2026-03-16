import Database from '@tauri-apps/plugin-sql';

let dbInstance: Database | null = null;

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
      category TEXT,
      tax_rate REAL DEFAULT 0,
      discount REAL DEFAULT 0
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
      type TEXT, -- 'customer' or 'vendor'
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
      type TEXT NOT NULL, -- 'sale', 'purchase', 'payment'
      FOREIGN KEY(party_id) REFERENCES parties(id)
    )
  `);

  // Transaction Items table
  await dbInstance.execute(`
    CREATE TABLE IF NOT EXISTS transaction_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      txn_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      batch_no TEXT,
      expiry_date TEXT,
      FOREIGN KEY(txn_id) REFERENCES transactions(id),
      FOREIGN KEY(item_id) REFERENCES items(id)
    )
  `);

  return dbInstance;
};

export const getDB = async () => {
  if (!dbInstance) {
    return await initDB();
  }
  return dbInstance;
};
