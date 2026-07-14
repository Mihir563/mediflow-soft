const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(process.env.APPDATA, 'com.tauri.dev', 'mediflow.db');
const db = new Database(dbPath);

const purchases = db.prepare(`SELECT count(*) as c FROM transaction_items WHERE txn_id IN (SELECT id FROM transactions WHERE type='purchase')`).get();
console.log('Purchase Items Count:', purchases.c);

// Also let's check what exactly the user uploaded - the original file was "PurchaseReport_01_03_19_to_31_03_26, purchase history.xlsx"
// Is it possible the party was saved somewhere else?
const sales = db.prepare(`SELECT count(*) as c FROM transaction_items WHERE txn_id IN (SELECT id FROM transactions WHERE type='sale')`).get();
console.log('Sale Items Count:', sales.c);

const itemCheck = db.prepare(`SELECT * FROM items LIMIT 5`).all();
console.log('Items sample:', itemCheck != null);
