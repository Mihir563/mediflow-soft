import { supabase } from './supabase';
import { getDB } from './db';

// Tables we synchronize
const TABLES_TO_SYNC = [
  'items',
  'parties',
  'transactions',
  'transaction_items',
  'party_special_rates',
] as const;

// Stable, deterministic UUID generation based on table name and old integer ID.
// This prevents duplicates and ensures that foreign keys align perfectly across uploads.
function stableUUID(table: string, oldId: number | string): string {
  let h = 5381;
  const s = `${table}:${oldId}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  h = Math.abs(h);
  const h2 = Math.abs(h * 1664525 + 1013904223);
  const h3 = Math.abs(h2 * 22695477 + 1);
  const h4 = Math.abs(h3 * 1103515245 + 12345);
  const h5 = Math.abs(h4 * 1234567891 + 99);
  
  const toHex = (n: number, len: number) => Math.abs(n).toString(16).padStart(len, '0').slice(-len);
  return `${toHex(h, 8)}-${toHex(h2, 4)}-4${toHex(h3, 3)}-${(8 + (h4 % 4)).toString(16)}${toHex(h5, 3)}-${toHex(h * h2, 12)}`;
}

// Helper to batch rows
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * ── BACKUP: Local SQLite ──> Supabase Cloud ──────────────────────────────────
 */
export async function backupLocalToCloud(
  storeId: string,
  onProgress: (phase: string, current: number, total: number) => void
): Promise<void> {
  const db = await getDB();

  // 1. Fetch all local SQLite data
  onProgress('Reading local items...', 0, 100);
  const localItems = await db.select<any[]>('SELECT * FROM items');
  
  onProgress('Reading local parties...', 10, 100);
  const localParties = await db.select<any[]>('SELECT * FROM parties');
  
  onProgress('Reading local transactions...', 20, 100);
  const localTxns = await db.select<any[]>('SELECT * FROM transactions');
  
  onProgress('Reading local line items...', 30, 100);
  const localTxnItems = await db.select<any[]>('SELECT * FROM transaction_items');
  
  onProgress('Reading local special rates...', 35, 100);
  const localRates = await db.select<any[]>('SELECT * FROM party_special_rates');

  onProgress('Reading local order book...', 40, 100);
  const localOrders = await db.select<any[]>('SELECT * FROM order_book');

  onProgress('Reading local app settings...', 42, 100);
  const localSettings = await db.select<any[]>('SELECT * FROM app_settings');

  // ── Build initial stable ID maps (fallback for purely offline data) ─────────
  const itemMap: Record<number, string> = {};
  const partyMap: Record<number, string> = {};
  const txnMap: Record<number, string> = {};

  localItems.forEach(r => { itemMap[r.id] = stableUUID('items', r.id); });
  localParties.forEach(r => { partyMap[r.id] = stableUUID('parties', r.id); });
  localTxns.forEach(r => { txnMap[r.id] = stableUUID('transactions', r.id); });

  // ── Pre-fetch existing cloud records to resolve UUID conflicts ──────────────
  //
  // CRITICAL: When a device is used in online mode, its transactions, items, and
  // parties are already stored in Supabase with cloud-generated random UUIDs.
  // If backup generates stableUUIDs from local integer IDs (different UUIDs),
  // upsert would try to INSERT duplicates → unique constraint violation on
  // (store_id, invoice_no, type).
  //
  // We pre-fetch all existing cloud records and match them to local records by
  // natural keys so backup always updates-in-place for already-synced data.
  //
  // IMPORTANT: Supabase silently caps all queries at 1000 rows by default.
  // We must paginate to guarantee we see every record for large stores.

  onProgress('Checking existing cloud data...', 43, 100);

  // Paginated fetch — loops until all rows are received
  async function fetchAllCloud<T = any>(
    table: string,
    select: string,
    storeIdFilter: string,
    pageSize = 1000
  ): Promise<T[]> {
    const all: T[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .eq('store_id', storeIdFilter)
        .range(from, from + pageSize - 1);
      if (error) {
        console.warn(`[Backup] fetchAllCloud(${table}) error:`, error.message);
        break;
      }
      if (!data || data.length === 0) break;
      all.push(...(data as T[]));
      if (data.length < pageSize) break; // Last page — we're done
      from += pageSize;
    }
    return all;
  }

  const [existingCloudItems, existingCloudParties, existingCloudTxns] = await Promise.all([
    fetchAllCloud('items',        'id, name',                      storeId),
    fetchAllCloud('parties',      'id, name, phone',               storeId),
    fetchAllCloud('transactions', 'id, invoice_no, type, date, total_amount', storeId),
  ]);

  // Build natural-key → cloud UUID lookup maps
  const cloudItemByName: Record<string, string> = {};
  existingCloudItems.forEach((r: any) => {
    if (r.name) cloudItemByName[r.name.trim().toLowerCase()] = r.id;
  });

  const cloudPartyByName: Record<string, string> = {};
  existingCloudParties.forEach((r: any) => {
    if (r.name) cloudPartyByName[r.name.trim().toLowerCase()] = r.id;
  });

  // Primary match: invoice_no + type (most reliable for numbered bills)
  const cloudTxnByKey: Record<string, string> = {};
  // Secondary match: date + total_amount + type (fallback for NULL invoice_no / walk-in sales)
  // Uses an ARRAY of cloud IDs per fingerprint so that multiple walk-in sales with the
  // same date+amount each get a distinct cloud UUID consumed one-by-one.
  const cloudTxnByFingerprint: Record<string, string[]> = {};
  existingCloudTxns.forEach((r: any) => {
    if (r.invoice_no) {
      cloudTxnByKey[`${r.invoice_no}|${r.type}`] = r.id;
    } else {
      // Build fingerprint from date + amount + type + created_at for maximum precision
      const dateKey = r.date ? String(r.date).split('T')[0] : '_';
      const amtKey  = r.total_amount != null ? Number(r.total_amount).toFixed(2) : '_';
      const fp = `${dateKey}|${amtKey}|${r.type}`;
      if (!cloudTxnByFingerprint[fp]) cloudTxnByFingerprint[fp] = [];
      cloudTxnByFingerprint[fp].push(r.id);
    }
  });

  // Track consumed cloud UUIDs to prevent two local records mapping to the same cloud row
  const consumedCloudIds = new Set<string>();

  // Override stableUUID maps with existing cloud UUIDs where a match is found
  localItems.forEach(r => {
    const cloudId = r.name ? cloudItemByName[r.name.trim().toLowerCase()] : null;
    if (cloudId) itemMap[r.id] = cloudId;
  });

  localParties.forEach(r => {
    const cloudId = r.name ? cloudPartyByName[r.name.trim().toLowerCase()] : null;
    if (cloudId) partyMap[r.id] = cloudId;
  });

  localTxns.forEach(r => {
    if (r.invoice_no) {
      // Primary match by invoice number
      const cloudId = cloudTxnByKey[`${r.invoice_no}|${r.type}`];
      if (cloudId && !consumedCloudIds.has(cloudId)) {
        txnMap[r.id] = cloudId;
        consumedCloudIds.add(cloudId);
        return;
      }
    }
    // Secondary match by date+amount fingerprint (walk-in / no invoice_no)
    const dateKey = r.date ? String(r.date).split('T')[0] : '_';
    const amtKey  = r.total_amount != null ? Number(r.total_amount).toFixed(2) : '_';
    const fp = `${dateKey}|${amtKey}|${r.type}`;
    const candidates = cloudTxnByFingerprint[fp];
    if (candidates && candidates.length > 0) {
      // Consume the first unconsumed candidate from the array
      const idx = candidates.findIndex(id => !consumedCloudIds.has(id));
      if (idx !== -1) {
        txnMap[r.id] = candidates[idx];
        consumedCloudIds.add(candidates[idx]);
        return;
      }
    }
    // No match found — stableUUID will be used (fresh insert, first backup from this device)
  });

  // 2. Upload Items
  // Self-healing: tries with default_vendor_id first (latest schema), falls back
  // to without it if the customer's Supabase hasn't run migrate_vendor_tracking.sql.
  if (localItems.length > 0) {
    const buildCloudItems = (includeVendor: boolean) => localItems.map(r => {
      const row: Record<string, any> = {
        id: itemMap[r.id],
        store_id: storeId,
        name: r.name,
        hsn: r.hsn || null,
        unit: r.unit || 'TAB',
        sale_price: Number(r.sale_price) || 0,
        purchase_price: Number(r.purchase_price) || 0,
        opening_stock: Number(r.opening_stock) || 0,
        current_stock: Number(r.current_stock) || 0,
        min_stock: Number(r.min_stock) || 0,
        category: r.category || null,
        tax_rate: Number(r.tax_rate) || 0,
        discount: Number(r.discount) || 0,
        inclusive_tax: r.inclusive_tax === 1 || r.inclusive_tax === true,
        tabs_per_strip: Number(r.tabs_per_strip) || 10,
        strips_per_box: Number(r.strips_per_box) || 10,
        is_active: true,
      };
      if (includeVendor) {
        row.default_vendor_id = r.default_vendor_id && partyMap[r.default_vendor_id]
          ? partyMap[r.default_vendor_id] : null;
      }
      return row;
    });

    // Try with vendor column first, fall back without it if schema cache rejects it
    let includeVendor = true;
    const cloudItems = buildCloudItems(true);

    const chunks = chunkArray(cloudItems, 100);
    for (let i = 0; i < chunks.length; i++) {
      onProgress(`Uploading items batch ${i + 1}/${chunks.length}...`, 45, 100);
      const { error } = await supabase.from('items').upsert(chunks[i], { onConflict: 'id' });
      if (error) {
        // Schema cache miss — column doesn't exist in this Supabase instance yet
        if (error.message.includes('schema cache') && includeVendor) {
          console.warn('[Backup] default_vendor_id not in schema cache — retrying items without it');
          includeVendor = false;
          // Rebuild ALL items without the vendor column and restart from batch 0
          const cleanItems = buildCloudItems(false);
          const cleanChunks = chunkArray(cleanItems, 100);
          for (let j = 0; j < cleanChunks.length; j++) {
            onProgress(`Uploading items batch ${j + 1}/${cleanChunks.length}...`, 45, 100);
            const { error: retryErr } = await supabase.from('items').upsert(cleanChunks[j], { onConflict: 'id' });
            if (retryErr) throw new Error(`Backup items error: ${retryErr.message}`);
          }
          break; // Already uploaded all items in the retry loop
        }
        throw new Error(`Backup items error: ${error.message}`);
      }
    }
  }

  // 3. Upload Parties
  if (localParties.length > 0) {
    const cloudParties = localParties.map(r => ({
      id: partyMap[r.id],
      store_id: storeId,
      name: r.name,
      phone: r.phone || null,
      gstin: r.gstin || null,
      address: r.address || null,
      type: ['customer', 'vendor'].includes(r.type) ? r.type : 'customer',
      opening_balance: Number(r.opening_balance) || 0,
      is_active: true,
    }));

    const chunks = chunkArray(cloudParties, 100);
    for (let i = 0; i < chunks.length; i++) {
      onProgress(`Uploading parties batch ${i + 1}/${chunks.length}...`, 60, 100);
      const { error } = await supabase.from('parties').upsert(chunks[i], { onConflict: 'id' });
      if (error) throw new Error(`Backup parties error: ${error.message}`);
    }
  }

  // 4. Upload Transactions
  if (localTxns.length > 0) {
    const cloudTxns = localTxns.map(r => ({
      id: txnMap[r.id],
      store_id: storeId,
      invoice_no: r.invoice_no || null,
      date: r.date ? new Date(r.date).toISOString() : new Date().toISOString(),
      party_id: r.party_id && partyMap[r.party_id] ? partyMap[r.party_id] : null,
      total_amount: Number(r.total_amount) || 0,
      paid_amount: Number(r.paid_amount) || 0,
      balance_due: Number(r.balance_due) || 0,
      type: r.type,
      payment_type: ['cash', 'credit', 'upi', 'cheque', 'bank'].includes(r.payment_type) ? r.payment_type : 'cash',
      status: ['paid', 'partial', 'unpaid'].includes(r.status) ? r.status : 'paid',
      challan_no: r.challan_no || null,
      description: r.description || null,
    }));

    const chunks = chunkArray(cloudTxns, 100);
    for (let i = 0; i < chunks.length; i++) {
      onProgress(`Uploading transactions batch ${i + 1}/${chunks.length}...`, 75, 100);
      const { error } = await supabase.from('transactions').upsert(chunks[i], { onConflict: 'id' });
      if (error) throw new Error(`Backup transactions error: ${error.message}`);
    }
  }

  // 5. Upload Transaction Items
  const validTxnItems = localTxnItems.filter(r => txnMap[r.txn_id]);
  if (validTxnItems.length > 0) {
    const allCloudTxnIds = [...new Set(validTxnItems.map(r => txnMap[r.txn_id]))];

    const deleteBatches = chunkArray(allCloudTxnIds, 50);
    for (let i = 0; i < deleteBatches.length; i++) {
      onProgress(`Clearing old line items batch ${i + 1}/${deleteBatches.length}...`, 78, 100);
      const { error } = await supabase
        .from('transaction_items')
        .delete()
        .in('txn_id', deleteBatches[i]);
      if (error) throw new Error(`Backup clear line items error: ${error.message}`);
    }

    const byTxn: Record<string, any[]> = {};
    validTxnItems.forEach(r => {
      const txnUuid = txnMap[r.txn_id];
      if (!byTxn[txnUuid]) byTxn[txnUuid] = [];
      byTxn[txnUuid].push(r);
    });

    const cloudTxnItems = validTxnItems.map(r => {
      const txnUuid = txnMap[r.txn_id];
      const rowIdx = byTxn[txnUuid].indexOf(r);
      return {
        id: stableUUID('transaction_items', `${txnUuid}:${rowIdx}`),
        txn_id: txnUuid,
        item_id: r.item_id && itemMap[r.item_id] ? itemMap[r.item_id] : null,
        item_name: r.item_name || null,
        quantity: Number(r.quantity) || 0,
        unit: r.unit || null,
        price: Number(r.price) || 0,
        amount: Number(r.amount) || 0,
        discount_pct: Number(r.discount_pct) || 0,
        discount_amt: Number(r.discount_amt) || 0,
        tax_pct: Number(r.tax_pct) || 0,
        tax_amt: Number(r.tax_amt) || 0,
        scheme_amount: Number(r.scheme_amount) || 0,
        batch_no: r.batch_no || null,
        expiry_date: r.expiry_date || null,
      };
    });

    const chunks = chunkArray(cloudTxnItems, 100);
    for (let i = 0; i < chunks.length; i++) {
      onProgress(`Uploading transaction items batch ${i + 1}/${chunks.length}...`, 85, 100);
      const { error } = await supabase.from('transaction_items').insert(chunks[i]);
      if (error) throw new Error(`Backup transaction items error (batch ${i + 1}): ${error.message}`);
    }
  }

  // 6. Upload Special Rates
  onProgress('Syncing special rates...', 93, 100);
  const { error: delRatesErr } = await supabase
    .from('party_special_rates')
    .delete()
    .eq('store_id', storeId);
  if (delRatesErr) throw new Error(`Backup special rates delete error: ${delRatesErr.message}`);

  if (localRates.length > 0) {
    const cloudRates = localRates
      .filter(r => itemMap[r.item_id] && partyMap[r.party_id])
      .map(r => ({
        id: stableUUID('party_special_rates', r.id),
        store_id: storeId,
        party_id: partyMap[r.party_id],
        item_id: itemMap[r.item_id],
        price: r.price ? Number(r.price) : null,
        discount: r.discount ? Number(r.discount) : null,
      }));

    console.log(`[Sync] Special rates: uploading ${cloudRates.length} to cloud`);
    const chunks = chunkArray(cloudRates, 100);
    for (let i = 0; i < chunks.length; i++) {
      onProgress(`Uploading special rates batch ${i + 1}/${chunks.length}...`, 95, 100);
      const { error } = await supabase.from('party_special_rates').insert(chunks[i]);
      if (error) {
        console.warn(`[Sync] Special rates insert warning: ${error.message}`);
      }
    }
  }

  // 7. Upload Order Book
  if (localOrders.length > 0) {
    const cloudOrders = localOrders.map(r => ({
      id: stableUUID('order_book', r.id),
      store_id: storeId,
      item_id: r.item_id && itemMap[r.item_id] ? itemMap[r.item_id] : null,
      item_name: r.item_name || null,
      quantity: Number(r.quantity) || 1,
      status: ['pending', 'ordered', 'received', 'cancelled'].includes(r.status) ? r.status : 'pending',
      ordered_at: r.ordered_at ? new Date(r.ordered_at).toISOString() : null,
      vendor_id: r.vendor_id && partyMap[r.vendor_id] ? partyMap[r.vendor_id] : null,
      vendor_name: r.vendor_name || null,
      vendor_phone: r.vendor_phone || null,
    }));

    const chunks = chunkArray(cloudOrders, 100);
    for (let i = 0; i < chunks.length; i++) {
      onProgress(`Uploading order book batch ${i + 1}/${chunks.length}...`, 97, 100);
      const { error } = await supabase.from('order_book').upsert(chunks[i], { onConflict: 'id' });
      if (error) throw new Error(`Backup order book error: ${error.message}`);
    }
  }

  // 8. Upload App Settings
  onProgress('Syncing app settings...', 97, 100);

  // then overlay whatever the user has explicitly saved locally.
  const defaultShowKeys: Record<string, string> = {
    show_mrp: 'true', show_stock: 'true', show_batch: 'true',
    show_expiry: 'true', show_hsn: 'true', show_tax: 'true', show_discount: 'true',
    fy_start_month: '4',
  };
  const settingsMap: Record<string, string> = { ...defaultShowKeys };
  localSettings.forEach(r => {
    if (r.key !== 'gemini_api_key') {
      settingsMap[r.key] = r.value ?? 'true';
    }
  });

  const cloudSettings = Object.entries(settingsMap).map(([key, value]) => ({
    store_id: storeId,
    key,
    value: value ?? null,
  }));

  if (cloudSettings.length > 0) {
    const chunks = chunkArray(cloudSettings, 100);
    for (let i = 0; i < chunks.length; i++) {
      onProgress(`Uploading app settings batch ${i + 1}/${chunks.length}...`, 99, 100);
      // upsert on (store_id, key) — safe to run multiple times, no duplicate errors
      const { error } = await supabase
        .from('app_settings')
        .upsert(chunks[i], { onConflict: 'store_id,key' });
      if (error) throw new Error(`Backup app settings error: ${error.message}`);
    }
  }

  onProgress('Cloud Backup completed successfully!', 100, 100);
}

/**
 * ── RESTORE: Supabase Cloud ──> Local SQLite ──────────────────────────────────
 */
export async function restoreCloudToLocal(
  storeId: string,
  onProgress: (phase: string, current: number, total: number) => void
): Promise<void> {
  const db = await getDB();

  // 1. Download all data from Supabase
  onProgress('Downloading cloud items...', 10, 100);
  const { data: cloudItems, error: e1 } = await supabase.from('items').select('*').eq('store_id', storeId);
  if (e1) throw new Error(`Restore items error: ${e1.message}`);

  onProgress('Downloading cloud parties...', 20, 100);
  const { data: cloudParties, error: e2 } = await supabase.from('parties').select('*').eq('store_id', storeId);
  if (e2) throw new Error(`Restore parties error: ${e2.message}`);

  onProgress('Downloading cloud transactions...', 30, 100);
  const { data: cloudTxns, error: e3 } = await supabase.from('transactions').select('*').eq('store_id', storeId);
  if (e3) throw new Error(`Restore transactions error: ${e3.message}`);

  // Fetch transaction line items
  onProgress('Downloading cloud line items...', 40, 100);
  const cloudTxnItems: any[] = [];
  if (cloudTxns && cloudTxns.length > 0) {
    const txnChunks = chunkArray(cloudTxns.map(t => t.id), 50);
    for (const chunk of txnChunks) {
      const { data, error } = await supabase.from('transaction_items').select('*').in('txn_id', chunk);
      if (error) throw new Error(`Restore txn items error: ${error.message}`);
      if (data) cloudTxnItems.push(...data);
    }
  }

  onProgress('Downloading cloud special rates...', 50, 100);
  const { data: cloudRates, error: e4 } = await supabase.from('party_special_rates').select('*').eq('store_id', storeId);
  if (e4) throw new Error(`Restore rates error: ${e4.message}`);

  onProgress('Downloading cloud order book...', 53, 100);
  const { data: cloudOrders, error: e5 } = await supabase.from('order_book').select('*').eq('store_id', storeId);
  if (e5) throw new Error(`Restore order book error: ${e5.message}`);

  onProgress('Downloading cloud app settings...', 56, 100);
  const { data: cloudSettings, error: e6 } = await supabase.from('app_settings').select('*').eq('store_id', storeId);
  if (e6) throw new Error(`Restore app settings error: ${e6.message}`);

  // 2. Clear local SQLite database tables in reverse dependency order
  // Under NO circumstances should any SQLite tables be deleted unless we are overwriting
  // during a user-approved Cloud Restore.
  onProgress('Preparing local database...', 60, 100);
  await db.execute('DELETE FROM party_special_rates');
  await db.execute('DELETE FROM transaction_items');
  await db.execute('DELETE FROM transactions');
  await db.execute('DELETE FROM parties');
  await db.execute('DELETE FROM items');
  await db.execute('DELETE FROM order_book');
  await db.execute('DELETE FROM app_settings');

  // ID Maps: Cloud UUID -> Local auto-incremented Integer ID
  const itemUuidToId: Record<string, number> = {};
  const partyUuidToId: Record<string, number> = {};
  const txnUuidToId: Record<string, number> = {};

  // 3. Insert into items (without default_vendor_id — parties not yet inserted)
  const itemCloudDefaultVendorMap: Record<number, string | null> = {}; // localId -> cloud vendor uuid
  if (cloudItems && cloudItems.length > 0) {
    for (let i = 0; i < cloudItems.length; i++) {
      onProgress(`Restoring local items ${i + 1}/${cloudItems.length}...`, 70, 100);
      const r = cloudItems[i];
      const res = await db.execute(
        `INSERT INTO items (name, hsn, unit, sale_price, purchase_price, opening_stock, current_stock, min_stock, category, tax_rate, discount, inclusive_tax, tabs_per_strip, strips_per_box)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          r.name, r.hsn || null, r.unit || 'TAB',
          Number(r.sale_price) || 0, Number(r.purchase_price) || 0,
          Number(r.opening_stock) || 0, Number(r.current_stock) || 0, Number(r.min_stock) || 0,
          r.category || null, Number(r.tax_rate) || 0, Number(r.discount) || 0,
          r.inclusive_tax ? 1 : 0, Number(r.tabs_per_strip) || 10, Number(r.strips_per_box) || 10
        ]
      );
      const localItemId = res.lastInsertId!;
      itemUuidToId[r.id] = localItemId;
      // Remember default_vendor_id cloud UUID to apply after parties are inserted
      if (r.default_vendor_id) itemCloudDefaultVendorMap[localItemId] = r.default_vendor_id;
    }
  }

  // 4. Insert into parties
  if (cloudParties && cloudParties.length > 0) {
    for (let i = 0; i < cloudParties.length; i++) {
      onProgress(`Restoring local parties ${i + 1}/${cloudParties.length}...`, 80, 100);
      const r = cloudParties[i];
      const res = await db.execute(
        `INSERT INTO parties (name, phone, gstin, address, type, opening_balance)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          r.name, r.phone || null, r.gstin || null, r.address || null,
          r.type || 'customer', Number(r.opening_balance) || 0
        ]
      );
      partyUuidToId[r.id] = res.lastInsertId!;
    }
    // Back-fill items.default_vendor_id now that parties have local IDs
    for (const [localItemId, cloudVendorUUID] of Object.entries(itemCloudDefaultVendorMap)) {
      const localVendorId = cloudVendorUUID ? partyUuidToId[cloudVendorUUID] : null;
      if (localVendorId) {
        await db.execute(`UPDATE items SET default_vendor_id = $1 WHERE id = $2`, [localVendorId, Number(localItemId)]);
      }
    }
  }

  // 5. Insert into transactions
  if (cloudTxns && cloudTxns.length > 0) {
    for (let i = 0; i < cloudTxns.length; i++) {
      onProgress(`Restoring local transactions ${i + 1}/${cloudTxns.length}...`, 90, 100);
      const r = cloudTxns[i];
      const partyIntId = r.party_id ? partyUuidToId[r.party_id] : null;
      
      const res = await db.execute(
        `INSERT INTO transactions (invoice_no, date, party_id, total_amount, paid_amount, balance_due, type, payment_type, status, challan_no, description, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          r.invoice_no || null,
          r.date ? r.date.replace('T', ' ').slice(0, 19) : new Date().toISOString().replace('T', ' ').slice(0, 19),
          partyIntId, Number(r.total_amount) || 0, Number(r.paid_amount) || 0, Number(r.balance_due) || 0,
          r.type, r.payment_type || 'cash', r.status || 'paid', r.challan_no || null, r.description || null,
          r.created_at ? r.created_at.replace('T', ' ').slice(0, 19) : new Date().toISOString().replace('T', ' ').slice(0, 19)
        ]
      );
      txnUuidToId[r.id] = res.lastInsertId!;
    }
  }

  // 6. Insert into transaction_items
  if (cloudTxnItems && cloudTxnItems.length > 0) {
    for (let i = 0; i < cloudTxnItems.length; i++) {
      onProgress(`Restoring local line items ${i + 1}/${cloudTxnItems.length}...`, 95, 100);
      const r = cloudTxnItems[i];
      const txnIntId = txnUuidToId[r.txn_id];
      const itemIntId = r.item_id ? itemUuidToId[r.item_id] : null;

      if (!txnIntId) continue; // Skip orphaned records

      await db.execute(
        `INSERT INTO transaction_items (txn_id, item_id, item_name, quantity, unit, price, discount_pct, discount_amt, tax_pct, tax_amt, amount, batch_no, expiry_date, scheme_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          txnIntId, itemIntId, r.item_name || null,
          Number(r.quantity) || 0, r.unit || null, Number(r.price) || 0,
          Number(r.discount_pct) || 0, Number(r.discount_amt) || 0,
          Number(r.tax_pct) || 0, Number(r.tax_amt) || 0,
          Number(r.amount) || 0, r.batch_no || null, r.expiry_date || null,
          Number(r.scheme_amount) || 0
        ]
      );
    }
  }

  // 7. Insert into special rates
  if (cloudRates && cloudRates.length > 0) {
    for (let i = 0; i < cloudRates.length; i++) {
      onProgress(`Restoring special rates ${i + 1}/${cloudRates.length}...`, 98, 100);
      const r = cloudRates[i];
      const partyIntId = partyUuidToId[r.party_id];
      const itemIntId = itemUuidToId[r.item_id];

      if (partyIntId && itemIntId) {
        try {
          await db.execute(
            `INSERT INTO party_special_rates (party_id, item_id, price, discount)
             VALUES ($1, $2, $3, $4) ON CONFLICT(party_id, item_id) DO UPDATE SET price = $3, discount = $4`,
            [partyIntId, itemIntId, r.price ? Number(r.price) : null, r.discount ? Number(r.discount) : null]
          );
        } catch (err) {
          console.warn('Restore special rate skipped/failed:', err);
        }
      }
    }
  }

  // 8. Insert into order_book
  if (cloudOrders && cloudOrders.length > 0) {
    for (let i = 0; i < cloudOrders.length; i++) {
      onProgress(`Restoring local order book ${i + 1}/${cloudOrders.length}...`, 99, 100);
      const r = cloudOrders[i];
      const itemIntId = r.item_id ? itemUuidToId[r.item_id] : null;
      const vendorIntId = r.vendor_id ? partyUuidToId[r.vendor_id] : null;
      await db.execute(
        `INSERT INTO order_book (item_id, item_name, quantity, status, ordered_at, vendor_id, vendor_name, vendor_phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          itemIntId, r.item_name || null, Number(r.quantity) || 1,
          r.status || 'pending', r.ordered_at || null,
          vendorIntId, r.vendor_name || null, r.vendor_phone || null,
        ]
      );
    }
  }

  // 9. Insert into app_settings
  if (cloudSettings && cloudSettings.length > 0) {
    for (let i = 0; i < cloudSettings.length; i++) {
      onProgress(`Restoring local app settings ${i + 1}/${cloudSettings.length}...`, 100, 100);
      const r = cloudSettings[i];
      await db.execute(
        `INSERT INTO app_settings (key, value)
         VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2`,
        [r.key, r.value || null]
      );
    }
  }

  onProgress('Cloud Restore completed successfully!', 100, 100);
}
