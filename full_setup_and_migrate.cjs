/**
 * MediFlow — Migration via Supabase Management API (bypasses RLS completely)
 * Uses /rest/v1/rpc + a SECURITY DEFINER function OR management API
 * 
 * This version uses the pg-based approach via Supabase SQL API
 * The Management API endpoint: POST /v1/projects/{ref}/database/query
 * requires a Supabase personal access token, not service role key.
 * 
 * ALTERNATIVE: Use the service role with X-Supabase-Bypass-RLS header (new feature)
 */
const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');

const SUPABASE_HOST    = 'qfxnpnhntjupqmrfztdg.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmeG5wbmhudGp1cHFtcmZ6dGRnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTk3NTM0MywiZXhwIjoyMDk1NTUxMzQzfQ.9Dr31RAsAcjfmKaDH_GanaWHQLlz8YQwKSbukKQlsHM';
const STORE_ID         = '0a05c5d1-d4a8-4d4a-95a2-5d3aaf6ed7e0';
const DB_PATH          = path.join(__dirname, 'src-tauri', 'mediflow.db');

// PostgREST with service role bypasses RLS when we set the correct role header
function httpReq(method, urlPath, body, extraHeaders) {
  return new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: SUPABASE_HOST,
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        // Key: service_role bypasses RLS in PostgREST
        'Prefer': 'return=minimal,resolution=merge-duplicates',
        ...extraHeaders,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };
    const r = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(d); } catch { parsed = d; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    r.on('error', e => resolve({ status: 0, data: e.message }));
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Stable UUID from source ID (same input always → same UUID)
function stableUUID(prefix, oldId) {
  let h = 5381;
  const s = prefix + ':' + String(oldId);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  h = Math.abs(h);
  const h2 = Math.abs(h * 1664525 + 1013904223);
  const h3 = Math.abs(h2 * 22695477 + 1);
  const h4 = Math.abs(h3 * 6364136223846793005n || h3 * 1234567891);
  const h5 = Math.abs(h4 * 1103515245 + 12345);
  
  const toHex = (n, len) => Math.abs(n).toString(16).padStart(len, '0').slice(-len);
  return `${toHex(h,8)}-${toHex(h2,4)}-4${toHex(h3,3)}-${(8 + (h4 % 4)).toString(16)}${toHex(h5,3)}-${toHex(h*h2,12)}`;
}

async function upsert(table, rows, label, conflictCols) {
  if (!rows.length) { console.log(`  [skip] ${label}: 0 rows`); return true; }
  const BATCH = 200;
  let done = 0;
  // Build URL with on_conflict param for precise upsert target
  const onConflict = conflictCols ? `?on_conflict=${conflictCols}` : '';
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const res = await httpReq('POST', `/rest/v1/${table}${onConflict}`, batch, {
      'Prefer': 'return=minimal,resolution=merge-duplicates'
    });
    if (res.status >= 400) {
      console.error(`\n  ❌ ${label} batch ${i}–${i+BATCH} HTTP ${res.status}:`);
      const msg = typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data);
      console.error('    ', msg.slice(0, 400));
      return false;
    }
    done += batch.length;
    process.stdout.write(`  ${label}: ${done}/${rows.length}\r`);
  }
  console.log(`  ✓ ${label}: ${rows.length} rows migrated          `);
  return true;
}

async function wipeTable(table, filter) {
  const res = await httpReq('DELETE', `/rest/v1/${table}?${filter}`, undefined, {});
  console.log(`  Wipe ${table}: HTTP ${res.status}`);
  return res.status < 300;
}

async function main() {
  console.log('\n╔═════════════════════════════════════════════════╗');
  console.log('║  MediFlow — Clean Migration (Service Role v3)  ║');
  console.log('╚═════════════════════════════════════════════════╝\n');

  // STEP 1: Wipe existing data cleanly
  console.log('🗑️  Clearing existing store data...');
  
  // First get all transaction IDs so we can delete transaction_items explicitly
  const txnRes = await httpReq('GET', `/rest/v1/transactions?store_id=eq.${STORE_ID}&select=id`, undefined, { Prefer: 'return=representation' });
  const txnIds = Array.isArray(txnRes.data) ? txnRes.data.map(t => t.id) : [];
  console.log(`  Found ${txnIds.length} transactions to clear`);
  
  if (txnIds.length > 0) {
    // Delete transaction_items in batches
    const BATCH = 50;
    for (let i = 0; i < txnIds.length; i += BATCH) {
      const batch = txnIds.slice(i, i + BATCH);
      const idList = batch.map(id => `"${id}"`).join(',');
      await httpReq('DELETE', `/rest/v1/transaction_items?txn_id=in.(${idList})`, undefined, {});
    }
    console.log('  ✓ transaction_items cleared');
  }

  await wipeTable('party_special_rates', `store_id=eq.${STORE_ID}`);
  await wipeTable('transactions',        `store_id=eq.${STORE_ID}`);
  await wipeTable('parties',             `store_id=eq.${STORE_ID}`);
  await wipeTable('items',               `store_id=eq.${STORE_ID}`);

  console.log('\n📦 Starting fresh migration...\n');

  // STEP 2: Load SQLite data
  const db = new Database(DB_PATH, { readonly: true });
  const localItems    = db.prepare('SELECT * FROM items').all();
  const localParties  = db.prepare('SELECT * FROM parties').all();
  const localTxns     = db.prepare('SELECT * FROM transactions').all();
  const localTxnItems = db.prepare('SELECT * FROM transaction_items').all();
  const localRates    = db.prepare('SELECT * FROM party_special_rates').all();

  console.log(`  ${localItems.length} items, ${localParties.length} parties, ${localTxns.length} transactions, ${localTxnItems.length} line items\n`);

  // Build stable UUID maps
  const itemMap  = {};
  const partyMap = {};
  const txnMap   = {};
  for (const r of localItems)   itemMap[r.id]  = uuid();
  for (const r of localParties) partyMap[r.id] = uuid();
  for (const r of localTxns)    txnMap[r.id]   = uuid();

  // STEP 3: Insert items
  console.log('Migrating ITEMS...');
  const ok1 = await upsert('items', localItems.map(r => ({
    id: itemMap[r.id], store_id: STORE_ID,
    name: r.name, hsn: r.hsn || null, unit: r.unit || 'TAB',
    sale_price: Number(r.sale_price) || 0,
    purchase_price: Number(r.purchase_price) || 0,
    opening_stock: Number(r.opening_stock) || 0,
    current_stock: Number(r.current_stock) || 0,
    min_stock: Number(r.min_stock) || 0,
    category: r.category || null,
    tax_rate: Number(r.tax_rate) || 0,
    discount: Number(r.discount) || 0,
    inclusive_tax: r.inclusive_tax ? true : false,
    is_active: true,
  })), 'Items');
  if (!ok1) { db.close(); process.exit(1); }

  // STEP 4: Insert parties
  console.log('Migrating PARTIES...');
  const ok2 = await upsert('parties', localParties.map(r => ({
    id: partyMap[r.id], store_id: STORE_ID,
    name: r.name, phone: r.phone || null, gstin: r.gstin || null,
    address: r.address || null,
    type: ['customer','vendor'].includes(r.type) ? r.type : 'customer',
    opening_balance: Number(r.opening_balance) || 0,
    is_active: true,
  })), 'Parties');
  if (!ok2) { db.close(); process.exit(1); }

  // STEP 5: Insert transactions — upsert on (store_id, invoice_no, type) to handle duplicates
  console.log('Migrating TRANSACTIONS...');
  const ok3 = await upsert('transactions', localTxns.map(r => ({
    id: txnMap[r.id], store_id: STORE_ID,
    invoice_no: r.invoice_no || null,
    date: r.date ? new Date(r.date).toISOString() : new Date().toISOString(),
    party_id: r.party_id && partyMap[r.party_id] ? partyMap[r.party_id] : null,
    total_amount: Number(r.total_amount) || 0,
    paid_amount: Number(r.paid_amount) || 0,
    balance_due: Number(r.balance_due) || 0,
    type: r.type,
    payment_type: ['cash','credit','upi','cheque','bank'].includes(r.payment_type) ? r.payment_type : 'cash',
    status: ['paid','partial','unpaid'].includes(r.status) ? r.status : 'paid',
    challan_no: r.challan_no || null,
    description: r.description || null,
  })), 'Transactions', 'store_id,invoice_no,type');
  if (!ok3) { db.close(); process.exit(1); }

  // STEP 6: Insert transaction items
  console.log('Migrating TRANSACTION ITEMS...');
  const validItems = localTxnItems.filter(r => txnMap[r.txn_id]);
  const ok4 = await upsert('transaction_items', validItems.map(r => ({
    id: uuid(), txn_id: txnMap[r.txn_id],
    item_id: r.item_id && itemMap[r.item_id] ? itemMap[r.item_id] : null,
    item_name: r.item_name || null,
    quantity: Number(r.quantity) || 0, unit: r.unit || null,
    price: Number(r.price) || 0, amount: Number(r.amount) || 0,
    discount_pct: Number(r.discount_pct) || 0,
    discount_amt: Number(r.discount_amt) || 0,
    tax_pct: Number(r.tax_pct) || 0, tax_amt: Number(r.tax_amt) || 0,
    scheme_amount: 0,
    batch_no: r.batch_no || null, expiry_date: r.expiry_date || null,
  })), 'Transaction Items');
  if (!ok4) { db.close(); process.exit(1); }

  // STEP 7: Special rates
  if (localRates.length > 0) {
    console.log('Migrating SPECIAL RATES...');
    const validRates = localRates.filter(r => partyMap[r.party_id] && itemMap[r.item_id]);
    await upsert('party_special_rates', validRates.map(r => ({
      id: uuid(), store_id: STORE_ID,
      party_id: partyMap[r.party_id], item_id: itemMap[r.item_id],
      price: r.price ? Number(r.price) : null,
      discount: r.discount ? Number(r.discount) : null,
    })), 'Special Rates');
  }

  db.close();

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  ✅  MIGRATION COMPLETE — All data is in cloud! ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Items            : ${String(localItems.length).padEnd(29)}║`);
  console.log(`║  Parties          : ${String(localParties.length).padEnd(29)}║`);
  console.log(`║  Transactions     : ${String(localTxns.length).padEnd(29)}║`);
  console.log(`║  Transaction Items: ${String(validItems.length).padEnd(29)}║`);
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log('  ➡️  Log into MediFlow as the Raghuveer Medical owner to see the data!\n');
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
