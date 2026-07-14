const xlsx = require('xlsx');
const Database = require('better-sqlite3');

const DB_PATHS = [
  'D:/Billing Software/mediflow/src-tauri/mediflow.db',
  'D:/Billing Software/mediflow/src-tauri/target/debug/mediflow.db',
  process.env.APPDATA ? `${process.env.APPDATA.replace(/\\/g, '/')}/com.tauri.dev/mediflow.db` : null,
  process.env.APPDATA ? `${process.env.APPDATA.replace(/\\/g, '/')}/com.mediflow.app/mediflow.db` : null,
];

const PURCHASE_FILE = 'D:/Billing Software/mediflow/data/PurchaseReport_01_03_19_to_31_03_26, purchase history.xlsx';

function parseSheetRows(sheet) {
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const headerIndex = matrix.findIndex((row) =>
    row.some((cell) => typeof cell === 'string' && (
      cell === 'Date' ||
      cell === 'Party Name' ||
      cell === 'Invoice No./Txn No.' ||
      cell === 'Invoice No'
    ))
  );
  if (headerIndex === -1) return [];

  const headers = (matrix[headerIndex] || []).map((cell, index) => {
    const text = String(cell ?? '').trim();
    return text || `__col_${index}`;
  });

  return matrix
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ''))
    .map((row) => {
      const entry = {};
      headers.forEach((header, index) => {
        entry[header] = row[index] ?? null;
      });
      return entry;
    });
}

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[\s./()-]+/g, '');
}

function parseDate(value) {
  const text = String(value || '').trim();
  if (!text) return new Date().toISOString();
  const parts = text.split(/[/-]/);
  if (parts.length === 3) {
    const [d, m, y] = parts;
    return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00`;
  }
  return text;
}

const workbook = xlsx.readFile(PURCHASE_FILE);
const mainRows = parseSheetRows(workbook.Sheets[workbook.SheetNames[0]]);
const detailRows = parseSheetRows(workbook.Sheets['Item Details']);

const mainByInvoice = new Map();
for (const row of mainRows) {
  const invoiceNo = String(row['Invoice No'] || row['Invoice No./Txn No.'] || '').trim();
  if (!invoiceNo) continue;
  mainByInvoice.set(invoiceNo, row);
}

const detailByInvoice = new Map();
for (const row of detailRows) {
  const invoiceNo = String(row['Invoice No./Txn No.'] || row['Invoice No'] || '').trim();
  if (!invoiceNo) continue;
  if (!detailByInvoice.has(invoiceNo)) detailByInvoice.set(invoiceNo, []);
  detailByInvoice.get(invoiceNo).push(row);
}

for (const dbPath of DB_PATHS.filter(Boolean)) {
  const db = new Database(dbPath);
  const items = db.prepare('SELECT id, name FROM items').all();
  const itemMap = new Map();
  for (const item of items) {
    itemMap.set(normalizeName(item.name), item.id);
  }

  const parties = db.prepare('SELECT id, name FROM parties').all();
  const partyMap = new Map();
  for (const party of parties) {
    partyMap.set(normalizeName(party.name), party.id);
  }

  const insertTxn = db.prepare(`
    INSERT INTO transactions (invoice_no, date, party_id, total_amount, paid_amount, balance_due, type, payment_type, status, challan_no, description)
    VALUES (?, ?, ?, ?, ?, ?, 'purchase', ?, ?, ?, ?)
  `);
  const updateTxn = db.prepare(`
    UPDATE transactions
    SET date = ?,
        party_id = ?,
        total_amount = ?,
        paid_amount = ?,
        balance_due = ?,
        payment_type = ?,
        status = ?,
        challan_no = ?,
        description = ?
    WHERE id = ?
  `);
  const findTxn = db.prepare(`SELECT id FROM transactions WHERE invoice_no = ? AND type = 'purchase'`);
  const deleteItems = db.prepare('DELETE FROM transaction_items WHERE txn_id = ?');
  const insertItem = db.prepare(`
    INSERT INTO transaction_items (txn_id, item_id, item_name, quantity, price, amount, discount_pct, tax_pct, batch_no, expiry_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const repair = db.transaction(() => {
    let txCount = 0;
    let lineCount = 0;

    for (const [invoiceNo, lines] of detailByInvoice.entries()) {
      const main = mainByInvoice.get(invoiceNo) || lines[0];
      const partyName = String(main['Party Name'] || lines[0]?.['Party Name'] || '').trim();
      const partyId = partyMap.get(normalizeName(partyName)) || null;
      const totalAmount = Number(main['Total Amount'] || main['Amount'] || 0) || lines.reduce((sum, line) => sum + (Number(line['Amount']) || 0), 0);
      const paidAmount = Number(main['Received/Paid Amount'] || main['Received Amount'] || main['Paid Amount'] || 0) || 0;
      const balanceDue = Number(main['Balance Due'] || main['Balance'] || 0) || 0;
      const paymentType = String(main['Payment Type'] || 'Cash').toLowerCase();
      const status = String(main['Payment Status'] || (balanceDue > 0 ? 'unpaid' : 'paid')).toLowerCase();
      const challanNo = String(lines[0]?.['Challan/Order No.'] || main['Order No'] || '').trim();
      const description = String(main['Description'] || '').trim();
      const date = parseDate(main['Date'] || lines[0]?.['Date']);

      const existingTxn = findTxn.get(invoiceNo);
      let txnId = existingTxn?.id;
      if (txnId) {
        updateTxn.run(date, partyId, totalAmount, paidAmount, balanceDue, paymentType, status, challanNo, description, txnId);
      } else {
        const result = insertTxn.run(invoiceNo, date, partyId, totalAmount, paidAmount, balanceDue, paymentType, status, challanNo, description);
        txnId = Number(result.lastInsertRowid);
      }
      if (!txnId) continue;
      deleteItems.run(txnId);
      txCount++;

      for (const line of lines) {
        const itemName = String(line['Item Name'] || '').trim();
        if (!itemName) continue;
        insertItem.run(
          txnId,
          itemMap.get(normalizeName(itemName)) || null,
          itemName,
          Number(line['Quantity'] || 1) || 1,
          Number(line['UnitPrice'] || line['Unit Price'] || 0) || 0,
          Number(line['Amount'] || 0) || 0,
          Number(line['Discount Percent'] || 0) || 0,
          Number(line['Tax Percent'] || 0) || 0,
          String(line['Batch No.'] || '').trim(),
          String(line['Exp. Date'] || '').trim(),
        );
        lineCount++;
      }
    }

    return { txCount, lineCount };
  });

  const result = repair();
  console.log(dbPath, result);
  db.close();
}
