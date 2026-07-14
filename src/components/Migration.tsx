'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import Database from '@tauri-apps/plugin-sql';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

const parseSheetRows = (sheet: XLSX.WorkSheet) => {
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, defval: null });
  const headerIndex = matrix.findIndex((row) =>
    row.some((cell) => typeof cell === 'string' && (
      cell.includes('Item name') ||
      cell === 'Name' ||
      cell === 'Date' ||
      cell === 'Party Name' ||
      cell === 'Invoice No./Txn No.'
    ))
  );

  if (headerIndex === -1) {
    return [] as Record<string, string | number | null>[];
  }

  const headers = (matrix[headerIndex] || []).map((cell, index) => {
    const text = String(cell ?? '').trim();
    return text || `__col_${index}`;
  });

  return matrix
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ''))
    .map((row) => {
      const entry: Record<string, string | number | null> = {};
      headers.forEach((header, index) => {
        entry[header] = row[index] ?? null;
      });
      return entry;
    });
};

const normalizeName = (value: string) => value.toLowerCase().replace(/[\s./()-]+/g, '');

export default function Migration() {
  const [itemsFile, setItemsFile] = useState<File | null>(null);
  const [partiesFile, setPartiesFile] = useState<File | null>(null);
  const [purchaseFile, setPurchaseFile] = useState<File | null>(null);
  const [saleFile, setSaleFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    console.log('[Migration]', msg);
    setLogs(prev => [...prev, msg]);
  };

  const processItems = async (file: File, db: Database) => {
    addLog(`Reading file: ${file.name} (${file.size} bytes)`);
    const buffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    const workbook = XLSX.read(uint8, { type: 'array' });
    
    addLog(`Sheets found: ${workbook.SheetNames.join(', ')}`);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json: any[] = parseSheetRows(sheet);
    
    addLog(`Rows parsed: ${json.length}`);
    if (json.length > 0) {
      addLog(`Sample row keys: ${Object.keys(json[0]).join(', ')}`);
    }

    let inserted = 0;
    let skipped = 0;
    
    for (const row of json) {
      const name = row['Item name*'] || row['Item Name'] || row['Name'];
      if (!name || typeof name !== 'string' || name.trim() === '') { skipped++; continue; }
      
      const hsn = String(row['Item code'] || row['HSN'] || '');
      const unit = String(row['Base Unit (x)'] || row['Unit'] || '');
      const sale_price = parseFloat(row['Default Mrp'] || row['Sale price'] || row['Sale Price']) || 0;
      const purchase_price = parseFloat(row['Purchase price'] || row['Purchase Price']) || 0;
      const stock = parseFloat(row['Current stock quantity'] || row['Current stock'] || row['Opening Stock'] || row['Quantity']) || 0;
      const category = String(row['Category'] || '');

      try {
        await db.execute(
          `INSERT OR IGNORE INTO items (name, hsn, unit, sale_price, purchase_price, opening_stock, current_stock, category)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [name.trim(), hsn, unit, sale_price, purchase_price, stock, stock, category]
        );
        inserted++;
      } catch (err: any) {
        addLog(`Error inserting item "${name}": ${err.message}`);
      }
    }
    
    addLog(`Items done: ${inserted} inserted, ${skipped} skipped.`);
    return inserted;
  };

  const processParties = async (file: File, db: Database) => {
    addLog(`Reading parties file: ${file.name}`);
    const buffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    const workbook = XLSX.read(uint8, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json: any[] = parseSheetRows(sheet);
    
    addLog(`Party rows parsed: ${json.length}`);
    if (json.length > 0) {
      addLog(`Sample party keys: ${Object.keys(json[0]).join(', ')}`);
    }

    let inserted = 0;
    for (const row of json) {
      const name = row['Party Name'] || row['Name'];
      if (!name || typeof name !== 'string' || name.trim() === '') continue;

      const phone = String(row['Phone No.'] || row['Phone Number'] || '');
      const gstin = String(row['GSTIN'] || '');
      const address = String(row['Billing Address'] || row['Address'] || '');
      const receivable = parseFloat(row['Receivable Balance']) || 0;
      const payable = parseFloat(row['Payable Balance']) || 0;
      const ob = receivable > 0 ? receivable : -payable;
      const type = payable > 0 ? 'vendor' : 'customer';

      try {
        await db.execute(
          `INSERT OR IGNORE INTO parties (name, phone, gstin, address, type, opening_balance)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [name.trim(), phone, gstin, address, type, ob]
        );
        inserted++;
      } catch (err: any) {
        addLog(`Error inserting party "${name}": ${err.message}`);
      }
    }
    addLog(`Parties done: ${inserted} inserted.`);
    return inserted;
  };

  const processTransactions = async (file: File, db: Database, type: 'sale' | 'purchase') => {
    addLog(`Reading ${type} file: ${file.name}`);
    const buffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    const workbook = XLSX.read(uint8, { type: 'array' });
    const mainSheet = workbook.Sheets[workbook.SheetNames[0]];
    const mainJson: any[] = parseSheetRows(mainSheet);
    
    let itemsJson: any[] = [];
    if (workbook.SheetNames.includes('Item Details')) {
       itemsJson = parseSheetRows(workbook.Sheets['Item Details']);
    }

    addLog(`${type} main rows: ${mainJson.length}, item rows: ${itemsJson.length}`);
    if (mainJson.length === 0) return 0;
    
    let txnInserted = 0;
    let itemsInserted = 0;
    
    // Pre-cache maps to avoid slow lookups
    const itemsRes = await db.select<any[]>('SELECT id, name FROM items');
    const itemMap = new Map(itemsRes.flatMap(i => {
      const raw = String(i.name || '').trim();
      if (!raw) return [];
      return [
        [raw.toLowerCase(), i.id],
        [normalizeName(raw), i.id],
      ];
    }));
    
    const partiesRes = await db.select<any[]>('SELECT id, name FROM parties');
    const partyMap = new Map(partiesRes.flatMap(p => {
      const raw = String(p.name || '').trim();
      if (!raw) return [];
      return [
        [raw.toLowerCase(), p.id],
        [normalizeName(raw), p.id],
      ];
    }));

    // Group rows by invoice_no since multiple items belong to one invoice
    const txns = new Map<string, { mainRow: any, items: any[] }>();
    
    for (const row of mainJson) {
      const invNo = String(row['Invoice No./Txn No.'] || row['Invoice No'] || row['Order No'] || '').trim();
      if (!invNo) continue;
      txns.set(invNo, { mainRow: row, items: [] });
    }

    const sourceItems = itemsJson.length > 0 ? itemsJson : mainJson;
    for (const row of sourceItems) {
      const invNo = String(row['Invoice No./Txn No.'] || row['Invoice No'] || row['Order No'] || '').trim();
      if (!invNo) continue;
      if (!txns.has(invNo)) {
         txns.set(invNo, { mainRow: row, items: [] });
      }
      txns.get(invNo)!.items.push(row);
    }

    for (const [invNo, data] of txns.entries()) {
      const first = data.mainRow;
      const rows = data.items;
      const dateStr = String(first['Date'] || '');
      let isoDate = new Date().toISOString();
      if (dateStr) {
        // Handle DD/MM/YYYY or DD-MM-YYYY
        const parts = dateStr.split(/[-/]/);
        if (parts.length === 3) isoDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`).toISOString();
      }
      
      const partyNameRaw = String(first['Party Name'] || '').trim();
      const partyName = partyNameRaw.toLowerCase();
      const partyId = partyName
        ? (partyMap.get(partyName) || partyMap.get(normalizeName(partyNameRaw)) || null)
        : null;
      const totalAmount = parseFloat(first['Total Amount'] || first['Amount'] || first['Purchase Amount'] || first['Sale Amount']) || 0;
      const paymentType = String(first['Payment Type'] || 'Cash');
      const paidStr = first['Received/Paid Amount'] || first['Received Amount'] || first['Paid Amount'];
      const paidAmt = paidStr ? parseFloat(paidStr) : totalAmount;
      const balStr = first['Balance Due'] || first['Balance'];
      const balanceDue = balStr ? parseFloat(balStr) : 0;
      const status = String(first['Payment Status'] || (balanceDue > 0 ? 'unpaid' : 'paid')).toLowerCase();

      try {
        const existingTxn = await db.select<any[]>('SELECT id FROM transactions WHERE invoice_no = $1 AND type = $2 LIMIT 1', [invNo, type]);
        let txnId: number;
        
        if (existingTxn.length > 0) {
          txnId = existingTxn[0].id;
          await db.execute('DELETE FROM transaction_items WHERE txn_id = $1', [txnId]);
          await db.execute(
            `UPDATE transactions SET date=$1, party_id=$2, total_amount=$3, paid_amount=$4, balance_due=$5, status=$6, payment_type=$7 WHERE id=$8`,
            [isoDate, partyId, totalAmount, paidAmt, balanceDue, status, paymentType, txnId]
          );
        } else {
          const res = await db.execute(
            `INSERT INTO transactions (invoice_no, date, party_id, type, total_amount, paid_amount, balance_due, status, payment_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [invNo, isoDate, partyId, type, totalAmount, paidAmt, balanceDue, status, paymentType]
          );
          txnInserted++;
          txnId = res.lastInsertId || 0;
        }

        // Insert items
        for (const row of rows) {
          const itemNameRaw = String(row['Item Name'] || '').trim();
          const itemName = itemNameRaw.toLowerCase();
          if (!itemNameRaw) continue;
          
          const itemId = itemMap.get(itemName) || itemMap.get(normalizeName(itemNameRaw)) || null;
          const qty = parseFloat(row['Quantity'] || row['Quantity In'] || row['Quantity Out']) || 1;
          const price = parseFloat(row['UnitPrice'] || row['Unit Price'] || row['Price']) || 0;
          const discPct = parseFloat(row['Discount Percent'] || '0') || 0;
          const taxPct = parseFloat(row['Tax Percent'] || row['GST'] || '0') || 0;
          const amount = parseFloat(row['Amount'] || row['Total Amount']) || 0;
          const batch = String(row['Batch No.'] || row['Batch'] || '');
          const exp = String(row['Exp. Date'] || row['Expiry'] || '');

          await db.execute(
            `INSERT INTO transaction_items (txn_id, item_id, item_name, quantity, price, amount, discount_pct, tax_pct, batch_no, expiry_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [txnId, itemId, itemNameRaw, qty, price, amount, discPct, taxPct, batch, exp]
          );
          itemsInserted++;
        }
      } catch (err: any) {
        addLog(`Error inserting ${type} txn ${invNo}: ${err.message}`);
      }
    }

    addLog(`${type} done: ${txnInserted} txns, ${itemsInserted} items inserted.`);
    return txnInserted;
  };

  const handleMigrate = async () => {
    setLogs([]);
    setStatus('Connecting to database...');
    try {
      // Open DB directly, not via getDB() singleton, to ensure fresh connection
      const db = await Database.load('sqlite:mediflow.db');
      addLog('DB connected.');
      
      // Make sure tables exist
      await db.execute(`CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        hsn TEXT, unit TEXT, sale_price REAL, purchase_price REAL,
        opening_stock REAL DEFAULT 0, current_stock REAL DEFAULT 0, category TEXT
      )`);
      await db.execute(`CREATE TABLE IF NOT EXISTS parties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, phone TEXT, gstin TEXT, address TEXT,
        type TEXT, opening_balance REAL DEFAULT 0
      )`);

      // Count existing rows before migration
      const existingItems = await db.select<any[]>('SELECT COUNT(*) as cnt FROM items');
      addLog(`Existing items before migration: ${existingItems[0]?.cnt}`);

      let itemCount = 0;
      let partyCount = 0;
      let purchaseCount = 0;
      let saleCount = 0;
      
      if (itemsFile) {
        setStatus('Processing items...');
        itemCount = await processItems(itemsFile, db);
      }
      
      if (partiesFile) {
        setStatus('Processing parties...');
        partyCount = await processParties(partiesFile, db);
      }

      if (purchaseFile) {
        setStatus('Processing purchases...');
        purchaseCount = await processTransactions(purchaseFile, db, 'purchase');
      }

      if (saleFile) {
        setStatus('Processing sales...');
        saleCount = await processTransactions(saleFile, db, 'sale');
      }

      // Verify after migration
      const finalItems = await db.select<any[]>('SELECT COUNT(*) as cnt FROM items');
      addLog(`Total items in DB after migration: ${finalItems[0]?.cnt}`);
      
      addLog('Running automated data integrity cleanup...');
      const repairRes = await db.execute(`
        UPDATE transaction_items
        SET item_name = LOWER((SELECT name FROM items WHERE items.id = transaction_items.item_id))
        WHERE (item_name IS NULL OR item_name = '') 
          AND item_id IS NOT NULL;
      `);
      addLog(`Database repairs complete. Fixed corrupted item names: ${(repairRes as any).rowsAffected || 'done'}`);

      setStatus(`✅ Migration complete! Items: ${itemCount}, Parties: ${partyCount}, Purchases: ${purchaseCount}, Sales: ${saleCount}`);
    } catch (error: any) {
      addLog(`FATAL ERROR: ${error.message || JSON.stringify(error)}`);
      setStatus(`❌ Error: ${error.message}`);
    }
  };

  return (
    <div className="flex flex-col items-center p-6 gap-4 w-full">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Data Migration</CardTitle>
          <CardDescription>Upload Vyapar Excel sheets to seed local SQLite</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="items">Export Items.xlsx</Label>
              <Input id="items" type="file" accept=".xlsx" onChange={(e) => setItemsFile(e.target.files?.[0] || null)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="parties">PartyReport.xlsx</Label>
              <Input id="parties" type="file" accept=".xlsx" onChange={(e) => setPartiesFile(e.target.files?.[0] || null)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="purchases">Purchase Report.xlsx</Label>
              <Input id="purchases" type="file" accept=".xlsx" onChange={(e) => setPurchaseFile(e.target.files?.[0] || null)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sales">Sale Report.xlsx</Label>
              <Input id="sales" type="file" accept=".xlsx" onChange={(e) => setSaleFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          <Button onClick={handleMigrate} disabled={!itemsFile && !partiesFile && !purchaseFile && !saleFile} className="w-full">Run Full Migration</Button>
          {status && <p className="text-sm mt-2 font-medium">{status}</p>}
          
          {logs.length > 0 && (
            <div className="mt-4 bg-slate-900 text-green-400 rounded-md p-4 font-mono text-xs max-h-64 overflow-y-auto">
              {logs.map((log, i) => (
                <div key={i}>&gt; {log}</div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
