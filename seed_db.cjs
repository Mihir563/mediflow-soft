/**
 * Full MediFlow seed script
 * Seeds: items (with tax_rate + discount), parties, AND all historical transactions
 * Run: node seed_db.cjs
 */
const path = require('path');
const XLSX = require('xlsx');
const BetterSqlite = require('better-sqlite3');

const DB_PATH = path.join(process.env.APPDATA, 'com.tauri.dev', 'mediflow.db');
const ITEMS_FILE = path.join(__dirname, 'data', 'Export Items (1).xlsx');
const PARTIES_FILE = path.join(__dirname, 'data', 'PartyReport , data of parties.xlsx');
const ALL_TXN_FILE = path.join(__dirname, 'data', 'AllTransactionsReport_01_03_19_to_31_03_26, data for the details of all medicals.xlsx');
const STOCK_FILE = path.join(__dirname, 'data', 'StockDetailReport_01_03_19_to_14_03_26, stock details.xlsx');

console.log('Opening DB at:', DB_PATH);
const db = BetterSqlite(DB_PATH);

// ── Create full schema ─────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    hsn TEXT, unit TEXT,
    sale_price REAL DEFAULT 0,
    purchase_price REAL DEFAULT 0,
    opening_stock REAL DEFAULT 0,
    current_stock REAL DEFAULT 0,
    category TEXT,
    tax_rate REAL DEFAULT 0,
    discount REAL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS parties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    phone TEXT, gstin TEXT, address TEXT,
    type TEXT DEFAULT 'customer',
    opening_balance REAL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT,
    date TEXT NOT NULL,
    party_id INTEGER,
    total_amount REAL NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'sale',
    payment_type TEXT DEFAULT 'cash',
    status TEXT DEFAULT 'paid',
    FOREIGN KEY(party_id) REFERENCES parties(id)
  );
  CREATE TABLE IF NOT EXISTS transaction_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txn_id INTEGER NOT NULL,
    item_id INTEGER,
    item_name TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    unit TEXT,
    price REAL NOT NULL DEFAULT 0,
    discount_pct REAL DEFAULT 0,
    discount_amt REAL DEFAULT 0,
    tax_pct REAL DEFAULT 0,
    tax_amt REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    batch_no TEXT,
    expiry_date TEXT,
    FOREIGN KEY(txn_id) REFERENCES transactions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
  CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(name);
  CREATE INDEX IF NOT EXISTS idx_txns_date ON transactions(date);
  CREATE INDEX IF NOT EXISTS idx_txns_party ON transactions(party_id);
  CREATE INDEX IF NOT EXISTS idx_txn_items_txn ON transaction_items(txn_id);
`);

// Clear old data
console.log('Clearing old data...');
db.exec(`DELETE FROM transaction_items; DELETE FROM transactions; DELETE FROM parties; DELETE FROM items;`);

// ── 1. Seed Items ──────────────────────────────────────────────
console.log('\n📦 Reading Items...');
const itemsWb = XLSX.readFile(ITEMS_FILE);
const itemsSheet = itemsWb.Sheets[itemsWb.SheetNames[0]];
const itemsJson = XLSX.utils.sheet_to_json(itemsSheet);
console.log(`  ${itemsJson.length} rows found`);

const insertItem = db.prepare(`INSERT OR IGNORE INTO items (name,hsn,unit,sale_price,purchase_price,opening_stock,current_stock,category,tax_rate,discount) VALUES (?,?,?,?,?,?,?,?,?,?)`);
const seedItems = db.transaction((rows) => {
  let n = 0;
  for (const row of rows) {
    const name = (row['Item name*'] || '').toString().trim();
    if (!name) continue;
    const hsn = String(row['Item code'] || '');
    const unit = String(row['Base Unit (x)'] || '');
    const sale_price = parseFloat(row['Default Mrp'] || row['Sale price']) || 0;
    const purchase_price = parseFloat(row['Purchase price']) || 0;
    const stock = parseFloat(row['Current stock quantity'] || 0);
    const category = String(row['Category'] || '');
    const taxStr = String(row['Tax Rate'] || '');
    const taxMatch = taxStr.match(/(\d+(\.\d+)?)/);
    const tax_rate = taxMatch ? parseFloat(taxMatch[1]) : 0;
    const discount = parseFloat(row['Sale Discount'] || 0);
    insertItem.run(name, hsn, unit, sale_price, purchase_price, stock, stock, category, tax_rate, discount);
    n++;
  }
  return n;
});
const itemCount = seedItems(itemsJson);
console.log(`  ✅ ${itemCount} items inserted`);

// ── 2. Seed Parties ────────────────────────────────────────────
console.log('\n👥 Reading Parties...');
const partiesWb = XLSX.readFile(PARTIES_FILE);
const partiesSheet = partiesWb.Sheets[partiesWb.SheetNames[0]];
const partiesJson = XLSX.utils.sheet_to_json(partiesSheet);
console.log(`  ${partiesJson.length} rows found`);

const insertParty = db.prepare(`INSERT OR IGNORE INTO parties (name,phone,gstin,address,type,opening_balance) VALUES (?,?,?,?,?,?)`);
const seedParties = db.transaction((rows) => {
  let n = 0;
  for (const row of rows) {
    const name = (row['Name'] || '').toString().trim();
    if (!name) continue;
    const phone = String(row['Phone No.'] || '');
    const gstin = String(row['GSTIN'] || '');
    const address = String(row['Address'] || '');
    const receivable = parseFloat(row['Receivable Balance']) || 0;
    const payable = parseFloat(row['Payable Balance']) || 0;
    const ob = receivable > 0 ? receivable : -payable;
    const type = payable > 0 ? 'vendor' : 'customer';
    insertParty.run(name, phone, gstin, address, type, ob);
    n++;
  }
  return n;
});
const partyCount = seedParties(partiesJson);
console.log(`  ✅ ${partyCount} parties inserted`);

// ── 3. Seed Transactions from AllTransactionsReport ────────────
console.log('\n📋 Reading All Transactions (Item Details sheet)...');
const txnWb = XLSX.readFile(ALL_TXN_FILE);
// The "Item Details" sheet has per-item rows with batch, qty, price, tax, discount
const itemDetailSheet = txnWb.Sheets['Item Details'];
const summarySheet = txnWb.Sheets['Custom Report'];
const rawItemDetails = XLSX.utils.sheet_to_json(itemDetailSheet);
const rawSummary = XLSX.utils.sheet_to_json(summarySheet);

// First two rows are header metadata, row 1 is actual header names
// Extract actual column names from row[0]
const headerRow = rawItemDetails[0];
const summaryHeaderRow = rawSummary[0];

const COL = {
  date: 'Generated on Mar 14, 2026 at 12:31 pm',
  invoiceNo: '__EMPTY',
  partyName: '__EMPTY_1',
  itemName: '__EMPTY_2',
  itemCode: '__EMPTY_3',
  hsn: '__EMPTY_4',
  category: '__EMPTY_5',
  batchNo: '__EMPTY_6',
  expDate: '__EMPTY_7',
  challan: '__EMPTY_8',
  size: '__EMPTY_9',
  qty: '__EMPTY_10',
  unit: '__EMPTY_11',
  unitPrice: '__EMPTY_12',
  discPct: '__EMPTY_13',
  discAmt: '__EMPTY_14',
  taxPct: '__EMPTY_15',
  taxAmt: '__EMPTY_16',
  txnType: '__EMPTY_17',
  amount: '__EMPTY_18',
};

// Skip first 2 header rows, process actual data
const itemDetails = rawItemDetails.slice(1); // skip first row (which is headers as values)
const summaryRows = rawSummary.slice(1);

console.log(`  Item detail rows: ${itemDetails.length}`);

// Build party lookup by name
const partyByName = new Map();
const allParties = db.prepare('SELECT id, name FROM parties').all();
for (const p of allParties) partyByName.set(p.name.trim().toUpperCase(), p.id);

// Build item lookup by name
const itemByName = new Map();
const allItems = db.prepare('SELECT id, name FROM items').all();
for (const it of allItems) itemByName.set(it.name.trim().toUpperCase(), it.id);

// Group item detail rows by invoice number to create one transaction per invoice
const invoiceMap = new Map();
for (const row of itemDetails) {
  const invNo = String(row[COL.invoiceNo] || '').trim();
  if (!invNo || invNo === 'Invoice No./Txn No.') continue; // skip header repeat rows
  if (!invoiceMap.has(invNo)) invoiceMap.set(invNo, []);
  invoiceMap.get(invNo).push(row);
}

// Use summary to get date, party, total, type for each invoice
const summaryMap = new Map(); // invNo → summary row
for (const row of summaryRows) {
  const invNo = String(row[COL.invoiceNo] || '').trim();
  if (invNo && invNo !== 'Reference No') summaryMap.set(invNo, row);
}

// Helper: parse DD/MM/YYYY → YYYY-MM-DD
function parseDate(s) {
  if (!s) return new Date().toISOString();
  s = String(s).trim();
  if (s.includes('/')) {
    const [d, m, y] = s.split('/');
    if (y) return `${y.padStart(4,'0')}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00`;
  }
  // Excel serial number?
  if (!isNaN(s)) {
    const d = new Date(Math.round((parseFloat(s) - 25569) * 86400 * 1000));
    return d.toISOString().split('T')[0] + 'T00:00:00';
  }
  return s + 'T00:00:00';
}

const insertTxn = db.prepare(`INSERT INTO transactions (invoice_no, date, party_id, total_amount, type, payment_type, status) VALUES (?,?,?,?,?,?,?)`);
const insertTxnItem = db.prepare(`INSERT INTO transaction_items (txn_id, item_id, item_name, quantity, unit, price, discount_pct, discount_amt, tax_pct, tax_amt, amount, batch_no, expiry_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

const seedTxns = db.transaction(() => {
  let txnCount = 0;
  let txnItemCount = 0;

  for (const [invNo, rows] of invoiceMap.entries()) {
    const summaryRow = summaryMap.get(invNo);
    const firstRow = rows[0];
    const dateStr = summaryRow ? summaryRow[COL.date] : firstRow[COL.date];
    const date = parseDate(dateStr);
    const rawType = String(summaryRow ? summaryRow[COL.txnType] : firstRow[COL.txnType] || 'sale').trim().toLowerCase();
    const txnType = rawType.includes('purchase') ? 'purchase' : 'sale';
    const total = parseFloat(summaryRow ? summaryRow['__EMPTY_4'] : 0) || rows.reduce((s, r) => s + (parseFloat(r[COL.amount]) || 0), 0);
    const partyName = String(summaryRow ? summaryRow[COL.partyName] : firstRow[COL.partyName] || '').trim().toUpperCase();
    const partyId = partyByName.get(partyName) || null;
    const paymentType = String(summaryRow ? summaryRow['__EMPTY_5'] : 'cash').toLowerCase() || 'cash';
    const status = String(summaryRow ? summaryRow['__EMPTY_9'] : 'paid').toLowerCase().includes('paid') ? 'paid' : 'unpaid';

    const res = insertTxn.run(invNo, date, partyId, total, txnType, paymentType, status);
    const txnId = res.lastInsertRowid;
    txnCount++;

    for (const row of rows) {
      const itemNameRaw = String(row[COL.itemName] || '').trim();
      if (!itemNameRaw) continue;
      const itemId = itemByName.get(itemNameRaw.toUpperCase()) || null;
      const qty = parseFloat(row[COL.qty]) || 1;
      const unit = String(row[COL.unit] || '');
      const price = parseFloat(row[COL.unitPrice]) || 0;
      const discPct = parseFloat(row[COL.discPct]) || 0;
      const discAmt = parseFloat(row[COL.discAmt]) || 0;
      const taxPct = parseFloat(row[COL.taxPct]) || 0;
      const taxAmt = parseFloat(row[COL.taxAmt]) || 0;
      const amount = parseFloat(row[COL.amount]) || 0;
      const batchNo = String(row[COL.batchNo] || '');
      const expDate = String(row[COL.expDate] || '');

      insertTxnItem.run(txnId, itemId, itemNameRaw, qty, unit, price, discPct, discAmt, taxPct, taxAmt, amount, batchNo, expDate);
      txnItemCount++;
    }
  }
  return { txnCount, txnItemCount };
});

const { txnCount, txnItemCount } = seedTxns();
console.log(`  ✅ ${txnCount} transactions, ${txnItemCount} line items inserted`);

// ── 4. Update stock from StockDetailReport ────────────────────
console.log('\n📊 Updating closing stock from StockDetailReport...');
const stockWb = XLSX.readFile(STOCK_FILE);
const stockSheet = stockWb.Sheets[stockWb.SheetNames[0]];
const stockJson = XLSX.utils.sheet_to_json(stockSheet);

const updateStock = db.prepare(`UPDATE items SET current_stock=? WHERE name=? COLLATE NOCASE`);
const seedStock = db.transaction((rows) => {
  let n = 0;
  for (const row of rows) {
    const name = String(row['Item Name'] || '').trim();
    if (!name) continue;
    const closing = parseFloat(row['Closing Quantity'] || 0);
    updateStock.run(closing, name);
    n++;
  }
  return n;
});
const stockCount = seedStock(stockJson);
console.log(`  ✅ Stock updated for ${stockCount} items`);

// ── Final stats ────────────────────────────────────────────────
const stats = {
  items: db.prepare('SELECT COUNT(*) as c FROM items').get().c,
  parties: db.prepare('SELECT COUNT(*) as c FROM parties').get().c,
  txns: db.prepare('SELECT COUNT(*) as c FROM transactions').get().c,
  txnItems: db.prepare('SELECT COUNT(*) as c FROM transaction_items').get().c,
};
console.log(`\n🎉 Database ready:`);
console.log(`   Items:    ${stats.items}`);
console.log(`   Parties:  ${stats.parties}`);
console.log(`   Invoices: ${stats.txns}`);
console.log(`   Lines:    ${stats.txnItems}`);
db.close();
