'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import Database from '@tauri-apps/plugin-sql';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export default function Migration() {
  const [itemsFile, setItemsFile] = useState<File | null>(null);
  const [partiesFile, setPartiesFile] = useState<File | null>(null);
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
    const json: any[] = XLSX.utils.sheet_to_json(sheet);
    
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
    const json: any[] = XLSX.utils.sheet_to_json(sheet);
    
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
      
      if (itemsFile) {
        setStatus('Processing items...');
        itemCount = await processItems(itemsFile, db);
      }
      
      if (partiesFile) {
        setStatus('Processing parties...');
        partyCount = await processParties(partiesFile, db);
      }

      // Verify after migration
      const finalItems = await db.select<any[]>('SELECT COUNT(*) as cnt FROM items');
      addLog(`Total items in DB after migration: ${finalItems[0]?.cnt}`);
      
      setStatus(`✅ Migration complete! Items: ${itemCount}, Parties: ${partyCount}`);
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
          <div className="space-y-2">
            <Label htmlFor="items">Export Items.xlsx</Label>
            <Input id="items" type="file" accept=".xlsx" onChange={(e) => setItemsFile(e.target.files?.[0] || null)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="parties">PartyReport.xlsx</Label>
            <Input id="parties" type="file" accept=".xlsx" onChange={(e) => setPartiesFile(e.target.files?.[0] || null)} />
          </div>
          <Button onClick={handleMigrate} disabled={!itemsFile && !partiesFile}>Run Migration</Button>
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
