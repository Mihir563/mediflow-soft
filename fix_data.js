const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const Database = require('better-sqlite3');

const appDataDev = path.join(process.env.APPDATA, 'com.tauri.dev', 'mediflow.db');
const appDataProd = path.join(process.env.APPDATA, 'com.mediflow.app', 'mediflow.db');

const dbPath = fs.existsSync(appDataProd) ? appDataProd : (fs.existsSync(appDataDev) ? appDataDev : null);

if (!dbPath) {
  console.error("Database not found");
  process.exit(1);
}

console.log("Using Database:", dbPath);
const db = new Database(dbPath);

const dataDir = path.join(__dirname, 'data');
const files = fs.readdirSync(dataDir);

const puFiles = files.filter(f => f.startsWith('PurchaseReport') && f.endsWith('.xlsx'));
const saFiles = files.filter(f => f.startsWith('SaleReport') && f.endsWith('.xlsx'));

function processFile(file, type) {
  const filePath = path.join(dataDir, file);
  console.log(`Processing ${type} Report: ${file}`);
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const json = xlsx.utils.sheet_to_json(sheet);
  
  let updated = 0;
  
  for (const row of json) {
    const invNo = String(row['Invoice No./Txn No.'] || row['Invoice No'] || row['Order No'] || '').trim();
    const itemNameRaw = String(row['Item Name'] || '').trim();
    if (!invNo || !itemNameRaw) continue;
    
    // Find transaction id
    const t = db.prepare(`SELECT id FROM transactions WHERE invoice_no = ? AND type = ?`).get(invNo, type);
    if (!t) continue;
    
    const qty = parseFloat(row['Quantity'] || row['Quantity In'] || row['Quantity Out']) || 1;
    
    // Find a transaction item in this txn that matches the quantity and has NO item_name
    const targetTi = db.prepare(`SELECT id FROM transaction_items WHERE txn_id = ? AND quantity = ? AND (item_name IS NULL OR item_name = '') LIMIT 1`).get(t.id, qty);
    
    if (targetTi) {
      db.prepare(`UPDATE transaction_items SET item_name = ? WHERE id = ?`).run(itemNameRaw, targetTi.id);
      updated++;
    } else {
      // Maybe it was already updated or quantity didn't match perfectly. Try just the first empty one
      const emptyTi = db.prepare(`SELECT id FROM transaction_items WHERE txn_id = ? AND (item_name IS NULL OR item_name = '') LIMIT 1`).get(t.id);
      if (emptyTi) {
         db.prepare(`UPDATE transaction_items SET item_name = ? WHERE id = ?`).run(itemNameRaw, emptyTi.id);
         updated++;
      }
    }
  }
  
  console.log(`Updated ${updated} items for ${file}`);
}

puFiles.forEach(f => processFile(f, 'purchase'));
saFiles.forEach(f => processFile(f, 'sale'));

console.log("Done updating transaction_items!");
