/**
 * MediFlow — SQLite → Supabase Cloud Migration Script
 * 
 * Migrates Raghuveer Medical data from local SQLite to Supabase.
 * 
 * SETUP: Get your SERVICE ROLE key from:
 *   Supabase → Project Settings → API → service_role (secret)
 * 
 * Then run:
 *   node migrate_to_cloud.cjs
 */

const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const SUPABASE_URL  = 'https://qfxnpnhntjupqmrfztdg.supabase.co';

// ⚠️ PASTE YOUR SERVICE ROLE KEY BELOW (from Supabase → Settings → API)
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'PASTE_SERVICE_ROLE_KEY_HERE';

// The store_id in Supabase for "Raghuveer Medical"
// ⚠️ PASTE THE STORE UUID BELOW after creating the store in the Admin Console
const STORE_ID = process.env.STORE_ID || 'PASTE_STORE_UUID_HERE';

const DB_PATH = path.join(__dirname, 'src-tauri', 'mediflow.db');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function supabaseInsert(table, rows) {
  if (!rows.length) {
    console.log(`  [skip] ${table}: no rows`);
    return { success: true, count: 0 };
  }

  // Insert in batches of 200
  const batchSize = 200;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const result = await supabaseFetch(`/rest/v1/${table}`, 'POST', batch);
    if (result.error) {
      return { success: false, error: result.error, batch: i };
    }
    inserted += batch.length;
    process.stdout.write(`  [${table}] ${inserted}/${rows.length} inserted...\r`);
  }

  console.log(`  ✓ ${table}: ${inserted} rows migrated`);
  return { success: true, count: inserted };
}

function supabaseFetch(path, method, body) {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: 'qfxnpnhntjupqmrfztdg.supabase.co',
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY,
        'Prefer': 'return=minimal,resolution=ignore-duplicates',
        'Content-Length': Buffer.byteLength(bodyStr),
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ error: null });
        } else {
          resolve({ error: `HTTP ${res.statusCode}: ${data}` });
        }
      });
    });

    req.on('error', (e) => resolve({ error: e.message }));
    req.write(bodyStr);
    req.end();
  });
}

// ─── ID MAPPINGS (old integer IDs → new UUIDs) ───────────────────────────────

function makeUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ─── MAIN MIGRATION ──────────────────────────────────────────────────────────

async function migrate() {
  console.log('\n========================================');
  console.log('  MediFlow — SQLite → Supabase Migration');
  console.log('========================================\n');

  // Validate config
  if (SERVICE_ROLE_KEY === 'PASTE_SERVICE_ROLE_KEY_HERE') {
    console.error('❌ ERROR: Set SUPABASE_SERVICE_ROLE_KEY environment variable or paste key in script.');
    console.error('   Get it from: Supabase Dashboard → Project Settings → API → service_role\n');
    process.exit(1);
  }
  if (STORE_ID === 'PASTE_STORE_UUID_HERE') {
    console.error('❌ ERROR: Set STORE_ID environment variable.');
    console.error('   Get it from: Supabase Dashboard → Table Editor → stores → copy the id of Raghuveer Medical\n');
    process.exit(1);
  }

  console.log(`✓ Supabase URL    : ${SUPABASE_URL}`);
  console.log(`✓ Store ID        : ${STORE_ID}`);
  console.log(`✓ Source DB       : ${DB_PATH}\n`);

  // Open SQLite
  const db = new Database(DB_PATH, { readonly: true });

  // ── 1. Build ID maps: old integer id → new UUID ────────────────────────────
  console.log('Building ID maps…');

  const itemIdMap = {};
  const partyIdMap = {};
  const txnIdMap = {};

  const localItems    = db.prepare('SELECT * FROM items').all();
  const localParties  = db.prepare('SELECT * FROM parties').all();
  const localTxns     = db.prepare('SELECT * FROM transactions').all();
  const localTxnItems = db.prepare('SELECT * FROM transaction_items').all();
  const localRates    = db.prepare('SELECT * FROM party_special_rates').all();

  // Generate UUIDs for every local row
  for (const r of localItems)   itemIdMap[r.id]  = makeUUID();
  for (const r of localParties) partyIdMap[r.id] = makeUUID();
  for (const r of localTxns)    txnIdMap[r.id]   = makeUUID();

  console.log(`  ${localItems.length} items, ${localParties.length} parties, ${localTxns.length} transactions, ${localTxnItems.length} line items\n`);

  // ── 2. Migrate items ────────────────────────────────────────────────────────
  console.log('Migrating ITEMS…');
  const cloudItems = localItems.map(r => ({
    id:             itemIdMap[r.id],
    store_id:       STORE_ID,
    name:           r.name,
    hsn:            r.hsn || null,
    unit:           r.unit || 'TAB',
    sale_price:     r.sale_price || 0,
    purchase_price: r.purchase_price || 0,
    opening_stock:  r.opening_stock || 0,
    current_stock:  r.current_stock || 0,
    min_stock:      r.min_stock || 0,
    category:       r.category || null,
    tax_rate:       r.tax_rate || 0,
    discount:       r.discount || 0,
    inclusive_tax:  r.inclusive_tax ? true : false,
  }));
  const itemsResult = await supabaseInsert('items', cloudItems);
  if (!itemsResult.success) {
    console.error('❌ Items migration failed:', itemsResult.error);
    process.exit(1);
  }

  // ── 3. Migrate parties ──────────────────────────────────────────────────────
  console.log('Migrating PARTIES…');
  const cloudParties = localParties.map(r => ({
    id:              partyIdMap[r.id],
    store_id:        STORE_ID,
    name:            r.name,
    phone:           r.phone || null,
    gstin:           r.gstin || null,
    address:         r.address || null,
    type:            r.type || 'customer',
    opening_balance: r.opening_balance || 0,
  }));
  const partiesResult = await supabaseInsert('parties', cloudParties);
  if (!partiesResult.success) {
    console.error('❌ Parties migration failed:', partiesResult.error);
    process.exit(1);
  }

  // ── 4. Migrate transactions ─────────────────────────────────────────────────
  console.log('Migrating TRANSACTIONS…');
  const cloudTxns = localTxns.map(r => ({
    id:           txnIdMap[r.id],
    store_id:     STORE_ID,
    invoice_no:   r.invoice_no || null,
    date:         r.date || new Date().toISOString(),
    party_id:     r.party_id && partyIdMap[r.party_id] ? partyIdMap[r.party_id] : null,
    total_amount: r.total_amount || 0,
    paid_amount:  r.paid_amount || 0,
    balance_due:  r.balance_due || 0,
    type:         r.type,
    payment_type: r.payment_type || 'cash',
    status:       r.status || 'paid',
    challan_no:   r.challan_no || null,
    description:  r.description || null,
  }));
  const txnsResult = await supabaseInsert('transactions', cloudTxns);
  if (!txnsResult.success) {
    console.error('❌ Transactions migration failed:', txnsResult.error);
    process.exit(1);
  }

  // ── 5. Migrate transaction_items ────────────────────────────────────────────
  console.log('Migrating TRANSACTION ITEMS…');
  const cloudTxnItems = localTxnItems
    .filter(r => txnIdMap[r.txn_id])  // skip orphans
    .map(r => ({
      id:           makeUUID(),
      txn_id:       txnIdMap[r.txn_id],
      item_id:      r.item_id && itemIdMap[r.item_id] ? itemIdMap[r.item_id] : null,
      item_name:    r.item_name || null,
      quantity:     r.quantity || 0,
      unit:         r.unit || null,
      price:        r.price || 0,
      amount:       r.amount || 0,
      discount_pct: r.discount_pct || 0,
      discount_amt: r.discount_amt || 0,
      tax_pct:      r.tax_pct || 0,
      tax_amt:      r.tax_amt || 0,
      scheme_amount:0,
      batch_no:     r.batch_no || null,
      expiry_date:  r.expiry_date || null,
    }));
  const txnItemsResult = await supabaseInsert('transaction_items', cloudTxnItems);
  if (!txnItemsResult.success) {
    console.error('❌ Transaction items migration failed:', txnItemsResult.error);
    process.exit(1);
  }

  // ── 6. Migrate party_special_rates ─────────────────────────────────────────
  if (localRates.length > 0) {
    console.log('Migrating SPECIAL RATES…');
    const cloudRates = localRates
      .filter(r => partyIdMap[r.party_id] && itemIdMap[r.item_id])
      .map(r => ({
        id:       makeUUID(),
        store_id: STORE_ID,
        party_id: partyIdMap[r.party_id],
        item_id:  itemIdMap[r.item_id],
        price:    r.price || null,
        discount: r.discount || null,
      }));
    await supabaseInsert('party_special_rates', cloudRates);
  }

  db.close();

  console.log('\n========================================');
  console.log('  ✅ Migration Complete!');
  console.log('========================================');
  console.log('  Refresh your MediFlow app to see all');
  console.log('  Raghuveer Medical data in the cloud!');
  console.log('========================================\n');
}

migrate().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
