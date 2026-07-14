/**
 * populate_items_from_purchases.cjs
 *
 * Problem: Items entered manually in purchase bills exist only in
 * transaction_items but NOT in the items catalog. So mobile app Items tab is empty.
 *
 * Fix:
 *   1. Scan all purchase transaction_items for item names missing from items table
 *   2. Create catalog entries for them in local SQLite
 *   3. Sync ALL local items to Supabase cloud (bypasses RLS via service_role)
 *   4. Print the SQL to fix the RLS policy (must be run in Supabase Dashboard)
 *
 * Run: node populate_items_from_purchases.cjs
 */
const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');

const DB_PATH  = path.join(process.env.APPDATA, 'com.tauri.dev', 'mediflow.db');
const SUPABASE = 'qfxnpnhntjupqmrfztdg.supabase.co';
const SRK      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmeG5wbmhudGp1cHFtcmZ6dGRnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTk3NTM0MywiZXhwIjoyMDk1NTUxMzQzfQ.9Dr31RAsAcjfmKaDH_GanaWHQLlz8YQwKSbukKQlsHM';
const STORE_ID = '0a05c5d1-d4a8-4d4a-95a2-5d3aaf6ed7e0';

function stableUUID(prefix, oldId) {
  let h = 5381;
  const s = prefix + ':' + String(oldId);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  h = Math.abs(h);
  const h2 = Math.abs(h * 1664525 + 1013904223);
  const h3 = Math.abs(h2 * 22695477 + 1);
  const h5 = Math.abs(h3 * 1103515245 + 12345);
  const hex = (n, l) => Math.abs(n).toString(16).padStart(l, '0').slice(-l);
  return `${hex(h,8)}-${hex(h2,4)}-4${hex(h3,3)}-${(8+(h2%4)).toString(16)}${hex(h5,3)}-${hex(h*h2,12)}`;
}

function req(method, urlPath, body, extra={}) {
  return new Promise(resolve => {
    const bs = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: SUPABASE, path: urlPath, method,
      headers: {
        Authorization: `Bearer ${SRK}`, apikey: SRK,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal,resolution=merge-duplicates',
        ...extra,
        ...(bs ? {'Content-Length': Buffer.byteLength(bs)} : {})
      }
    };
    const r = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let p; try { p = JSON.parse(d); } catch { p = d; }
        resolve({ status: res.statusCode, data: p });
      });
    });
    r.on('error', e => resolve({ status: 0, data: e.message }));
    if (bs) r.write(bs);
    r.end();
  });
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i+n));
  return out;
}

async function main() {
  console.log('\n===========================================================');
  console.log(' MediFlow — Populate Items from Purchase History + Sync   ');
  console.log('===========================================================\n');
  console.log('Opening DB:', DB_PATH);
  const db = new Database(DB_PATH);

  // STEP 1: Find what is missing ─────────────────────────────────────────────
  const catalogNames = new Set(
    db.prepare('SELECT LOWER(TRIM(name)) as n FROM items').all().map(r => r.n)
  );
  console.log(`Catalog size: ${catalogNames.size} items`);

  const purchItems = db.prepare(`
    SELECT
      LOWER(TRIM(ti.item_name))  AS norm_name,
      ti.item_name               AS raw_name,
      ROUND(AVG(COALESCE(ti.price,0)),2) AS avg_price,
      MAX(COALESCE(ti.tax_pct,0))        AS tax_pct,
      COUNT(*)                           AS cnt
    FROM transaction_items ti
    JOIN transactions t ON t.id = ti.txn_id
    WHERE t.type = 'purchase'
      AND ti.item_name IS NOT NULL
      AND TRIM(ti.item_name) <> ''
    GROUP BY LOWER(TRIM(ti.item_name))
    ORDER BY cnt DESC
  `).all();
  console.log(`Unique purchase items: ${purchItems.length}`);

  const missing = purchItems.filter(p => p.norm_name && !catalogNames.has(p.norm_name));
  console.log(`Missing from catalog: ${missing.length}\n`);

  // STEP 2: Insert missing items into SQLite ─────────────────────────────────
  if (missing.length > 0) {
    const ins = db.prepare(`
      INSERT OR IGNORE INTO items
        (name, sale_price, purchase_price, current_stock, opening_stock,
         min_stock, tax_rate, unit, category)
      VALUES (?, ?, ?, 0, 0, 0, ?, 'TAB', 'Medicine')
    `);
    let created = 0;
    db.transaction(() => {
      for (const it of missing) {
        const name = (it.raw_name || '').trim();
        if (!name) continue;
        const pp = Math.round((it.avg_price || 0) * 100) / 100;
        const sp = Math.round(pp * 1.1 * 100) / 100;
        const result = ins.run(name, sp, pp, it.tax_pct || 0);
        if (result.changes > 0) {
          created++;
          if (created <= 15) console.log(`  + Created: "${name}" (pp=Rs.${pp}, tax=${it.tax_pct||0}%, bought ${it.cnt}x)`);
        }
      }
    })();
    if (created > 15) console.log(`  ... and ${created - 15} more`);
    console.log(`\nCreated ${created} new items in local SQLite.\n`);
  }

  // STEP 3: Sync ALL local items to Supabase ─────────────────────────────────
  console.log('Syncing all items to Supabase cloud...\n');
  const localItems   = db.prepare('SELECT * FROM items').all();
  const localParties = db.prepare('SELECT * FROM parties').all();
  const partyMap = {};
  localParties.forEach(p => { partyMap[p.id] = stableUUID('parties', p.id); });

  // Fetch existing cloud items to reuse UUIDs and avoid 409s
  const cloudUUIDByName = {};
  let offset = 0;
  while (true) {
    const res = await req('GET', `/rest/v1/items?store_id=eq.${STORE_ID}&select=id,name&limit=1000&offset=${offset}`);
    if (!Array.isArray(res.data) || !res.data.length) break;
    for (const ci of res.data) cloudUUIDByName[(ci.name||'').toLowerCase().trim()] = ci.id;
    if (res.data.length < 1000) break;
    offset += 1000;
  }
  console.log(`Existing cloud items: ${Object.keys(cloudUUIDByName).length}`);

  const seenNames = new Set();
  const payload = [];
  for (const item of localItems) {
    const normName = (item.name||'').toLowerCase().trim();
    if (!normName || seenNames.has(normName)) continue;
    seenNames.add(normName);
    const cloudId   = cloudUUIDByName[normName] || stableUUID('items', item.id);
    const vendorUUID = (item.default_vendor_id && partyMap[item.default_vendor_id])
      ? partyMap[item.default_vendor_id] : null;
    payload.push({
      id: cloudId, store_id: STORE_ID,
      name: item.name.trim(),
      hsn: item.hsn || null,
      unit: item.unit || 'TAB',
      sale_price:     Number(item.sale_price)     || 0,
      purchase_price: Number(item.purchase_price) || 0,
      opening_stock:  Number(item.opening_stock)  || 0,
      current_stock:  Number(item.current_stock)  || 0,
      min_stock:      Number(item.min_stock)       || 0,
      category:       item.category || null,
      tax_rate:       Number(item.tax_rate)  || 0,
      discount:       Number(item.discount)  || 0,
      inclusive_tax:  item.inclusive_tax === 1 || item.inclusive_tax === true,
      tabs_per_strip: Number(item.tabs_per_strip) || 10,
      strips_per_box: Number(item.strips_per_box) || 10,
      default_vendor_id: vendorUUID,
      is_active: true,
    });
  }
  console.log(`Unique items to upload: ${payload.length}`);

  let synced = 0, errors = 0;
  for (const c of chunk(payload, 100)) {
    const res = await req('POST', `/rest/v1/items`, c);
    if (res.status >= 400) {
      errors += c.length;
      console.error(`  ERR HTTP ${res.status}:`, JSON.stringify(res.data).slice(0,150));
    } else {
      synced += c.length;
      process.stdout.write(`  Synced ${synced}/${payload.length}\r`);
    }
  }
  console.log(`\n\nCloud sync: ${synced} uploaded, ${errors} errors.\n`);

  db.close();

  // STEP 4: Print the RLS fix SQL ────────────────────────────────────────────
  console.log('=================================================================');
  console.log(' IMPORTANT: Run this SQL in Supabase Dashboard → SQL Editor ');
  console.log('  to fix purchase bill saving (42501 RLS error):              ');
  console.log('=================================================================');
  console.log(`
DROP POLICY IF EXISTS "member_access_txn_items" ON public.transaction_items;

CREATE POLICY "member_access_txn_items"
    ON public.transaction_items FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM   public.transactions t
            WHERE  t.id       = txn_id
            AND    t.store_id IN (SELECT public.get_user_store_ids())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM   public.transactions t
            WHERE  t.id       = txn_id
            AND    t.store_id IN (SELECT public.get_user_store_ids())
        )
    );
`);
  console.log('=================================================================');
  console.log('\nDone! After running the SQL above:');
  console.log('  1. Pull-to-refresh on the mobile app Items tab');
  console.log('  2. All items should now appear in the list');
  console.log('  3. Saving purchase bills will no longer give RLS errors\n');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
