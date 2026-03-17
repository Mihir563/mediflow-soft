const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const appDataDev = path.join(process.env.APPDATA, 'com.tauri.dev', 'mediflow.db');
const appDataProd = path.join(process.env.APPDATA, 'com.mediflow.app', 'mediflow.db');

const dbPath = fs.existsSync(appDataProd) ? appDataProd : (fs.existsSync(appDataDev) ? appDataDev : null);
if (!dbPath) {
  console.error("Database not found");
  process.exit(1);
}

const db = new Database(dbPath);

console.log("Fixing missing item names inside the database directly by copying from the items table...");

const result = db.prepare(`
  UPDATE transaction_items
  SET item_name = LOWER((SELECT name FROM items WHERE items.id = transaction_items.item_id))
  WHERE (item_name IS NULL OR item_name = '') 
    AND item_id IS NOT NULL;
`).run();

console.log(`Updated ${result.changes} items with missing names!`);

// Also fix any items that might have somehow been inserted with item_id=null but let's check if there are any
const countNull = db.prepare('SELECT COUNT(*) as c FROM transaction_items WHERE item_name IS NULL OR item_name = ""').get();
console.log(`Remaining missing item names: ${countNull.c}`);
