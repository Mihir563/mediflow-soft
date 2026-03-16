/**
 * Migrate DB schema: add missing columns, then rebuild.
 */
const path = require('path');
const BetterSqlite = require('better-sqlite3');
const DB_PATH = path.join(process.env.APPDATA, 'com.tauri.dev', 'mediflow.db');
const db = BetterSqlite(DB_PATH);

// Add missing columns to items table (ignore if already exist)
const tryAlter = (sql) => { try { db.exec(sql); console.log('✅', sql.slice(0,60)); } catch(e) { console.log('⚠️  (already exists)', sql.slice(0,60)); } };

tryAlter(`ALTER TABLE items ADD COLUMN tax_rate REAL DEFAULT 0`);
tryAlter(`ALTER TABLE items ADD COLUMN discount REAL DEFAULT 0`);
tryAlter(`ALTER TABLE transactions ADD COLUMN payment_type TEXT DEFAULT 'cash'`);
tryAlter(`ALTER TABLE transactions ADD COLUMN status TEXT DEFAULT 'paid'`);
tryAlter(`ALTER TABLE transaction_items ADD COLUMN item_name TEXT`);
tryAlter(`ALTER TABLE transaction_items ADD COLUMN unit TEXT`);
tryAlter(`ALTER TABLE transaction_items ADD COLUMN discount_pct REAL DEFAULT 0`);
tryAlter(`ALTER TABLE transaction_items ADD COLUMN discount_amt REAL DEFAULT 0`);
tryAlter(`ALTER TABLE transaction_items ADD COLUMN tax_pct REAL DEFAULT 0`);
tryAlter(`ALTER TABLE transaction_items ADD COLUMN tax_amt REAL DEFAULT 0`);
tryAlter(`ALTER TABLE transaction_items ADD COLUMN amount REAL DEFAULT 0`);

// Make name column UNIQUE if not already
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_items_name_uniq ON items(name)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_parties_name_uniq ON parties(name)`);
  console.log('✅ Unique indexes created');
} catch(e) { console.log('⚠️  Indexes:', e.message); }

console.log('\n✅ Schema migration done!');
db.close();
