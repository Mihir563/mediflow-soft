import { supabase } from './supabase';
import { getDB } from './db';

// Stable, deterministic UUID generation based on table name and old integer ID.
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

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

interface LocalItem {
  id: number;
  name: string;
  hsn?: string | null;
  unit?: string | null;
  sale_price?: number | null;
  purchase_price?: number | null;
  opening_stock?: number | null;
  current_stock?: number | null;
  min_stock?: number | null;
  category?: string | null;
  tax_rate?: number | null;
  discount?: number | null;
  inclusive_tax?: number | boolean | null;
  tabs_per_strip?: number | null;
  strips_per_box?: number | null;
}

const normalizeItemName = (name: unknown) => String(name ?? '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleUpperCase();

const toCloudItem = (item: LocalItem, storeId: string, id: string) => ({
  id,
  store_id: storeId,
  name: String(item.name ?? '').trim(),
  hsn: item.hsn || null,
  unit: item.unit || 'TAB',
  sale_price: Number(item.sale_price) || 0,
  purchase_price: Number(item.purchase_price) || 0,
  opening_stock: Number(item.opening_stock) || 0,
  current_stock: Number(item.current_stock) || 0,
  min_stock: Number(item.min_stock) || 0,
  category: item.category || null,
  tax_rate: Number(item.tax_rate) || 0,
  discount: Number(item.discount) || 0,
  inclusive_tax: item.inclusive_tax === 1 || item.inclusive_tax === true,
  tabs_per_strip: Number(item.tabs_per_strip) || 10,
  strips_per_box: Number(item.strips_per_box) || 10,
  is_active: true,
});

/**
 * Items are unique by (store_id, name) in Supabase, not by their old SQLite ID.
 * Resolve a cloud ID by name first so local IDs from imports cannot create 409s.
 */
async function upsertItemsByName(storeId: string, localItems: LocalItem[]) {
  const cloudIdByName = new Map<string, string>();
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('items')
      .select('id, name')
      .eq('store_id', storeId)
      .range(from, from + 999);

    if (error) throw new Error(`Could not read cloud items: ${error.message}`);
    for (const cloudItem of data ?? []) {
      cloudIdByName.set(normalizeItemName(cloudItem.name), cloudItem.id);
    }
    if (!data || data.length < 1000) break;
    from += data.length;
  }

  const groups = new Map<string, LocalItem[]>();
  for (const item of localItems) {
    const key = normalizeItemName(item.name);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const cloudIdByLocalId: Record<number, string> = {};
  const payloads: ReturnType<typeof toCloudItem>[] = [];
  let duplicateRows = 0;

  for (const [name, group] of groups) {
    // Keep the most recently created local record as the catalog source of truth.
    const canonical = group.reduce((newest, item) => Number(item.id) > Number(newest.id) ? item : newest);
    const cloudId = cloudIdByName.get(name) ?? stableUUID('items', canonical.id);
    for (const item of group) cloudIdByLocalId[Number(item.id)] = cloudId;
    duplicateRows += Math.max(0, group.length - 1);
    payloads.push(toCloudItem(canonical, storeId, cloudId));
  }

  let synced = 0;
  let errors = 0;
  for (const chunk of chunkArray(payloads, 100)) {
    const { error } = await supabase.from('items').upsert(chunk, { onConflict: 'id' });
    if (error) {
      errors += chunk.length;
      console.warn('[SyncItems] Cloud item batch failed:', error.message);
    } else {
      synced += chunk.length;
    }
  }

  return { synced, errors, duplicateRows, cloudIdByLocalId };
}

/**
 * ── REAL-TIME SYNC: Push a single transaction to cloud immediately after save ──
 *
 * Called fire-and-forget after every sale/purchase save.
 * Uses upsert on stable UUIDs so it's safe to call multiple times.
 * Silently fails on network errors — data is always safe locally.
 */
export async function syncTransactionToCloud(
  storeId: string,
  localTxnId: number
): Promise<void> {
  try {
    const db = await getDB();

    // 1. Load the transaction
    const txns = await db.select<any[]>(
      `SELECT * FROM transactions WHERE id = $1`, [localTxnId]
    );
    if (!txns.length) return;
    const t = txns[0];
    const txnUUID = stableUUID('transactions', localTxnId);

    // 2. Resolve or upsert the party
    let partyUUID: string | null = null;
    if (t.party_id) {
      const parties = await db.select<any[]>(`SELECT * FROM parties WHERE id = $1`, [t.party_id]);
      if (parties.length) {
        const p = parties[0];
        partyUUID = stableUUID('parties', p.id);
        await supabase.from('parties').upsert({
          id: partyUUID,
          store_id: storeId,
          name: p.name,
          phone: p.phone || null,
          gstin: p.gstin || null,
          address: p.address || null,
          type: ['customer', 'vendor'].includes(p.type) ? p.type : 'customer',
          opening_balance: Number(p.opening_balance) || 0,
          is_active: true,
        }, { onConflict: 'id' });
      }
    }

    // 3. Upsert the transaction
    await supabase.from('transactions').upsert({
      id: txnUUID,
      store_id: storeId,
      invoice_no: t.invoice_no || null,
      date: t.date ? new Date(t.date).toISOString() : new Date().toISOString(),
      party_id: partyUUID,
      total_amount: Number(t.total_amount) || 0,
      paid_amount: Number(t.paid_amount) || 0,
      balance_due: Number(t.balance_due) || 0,
      type: t.type,
      payment_type: ['cash', 'credit', 'upi', 'cheque', 'bank'].includes(t.payment_type) ? t.payment_type : 'cash',
      status: ['paid', 'partial', 'unpaid'].includes(t.status) ? t.status : 'paid',
      challan_no: t.challan_no || null,
      description: t.description || null,
    }, { onConflict: 'id' });

    // 4. Load and upsert transaction items
    const txnItems = await db.select<any[]>(
      `SELECT * FROM transaction_items WHERE txn_id = $1`, [localTxnId]
    );

    if (txnItems.length > 0) {
      // First, delete old cloud line items for this transaction (re-upsert all)
      await supabase.from('transaction_items').delete().eq('txn_id', txnUUID);

      // Build UUID map for items — include both item_id links AND name-based lookups for null item_ids
      const itemIds = [...new Set(txnItems.map(r => r.item_id).filter(Boolean))];
      const itemUUIDMap: Record<number, string> = {};
      for (const itemId of itemIds) {
        itemUUIDMap[itemId] = stableUUID('items', itemId);
      }

      // Collect all local items to sync: those referenced by item_id AND those referenced by name
      const itemNamesWithoutId = [...new Set(
        txnItems.filter(r => !r.item_id && r.item_name).map(r => r.item_name.trim())
      )];

      // Resolve item names to IDs for items that were typed manually (no item_id)
      const nameToItemId: Record<string, number> = {};
      if (itemNamesWithoutId.length > 0) {
        const namedItems = await db.select<any[]>(`SELECT * FROM items WHERE LOWER(TRIM(name)) IN (${
          itemNamesWithoutId.map((_,i) => `$${i+1}`).join(',')
        })`, itemNamesWithoutId.map(n => n.toLowerCase()));
        for (const ni of namedItems) {
          nameToItemId[ni.name.trim()] = ni.id;
          if (!itemUUIDMap[ni.id]) {
            itemUUIDMap[ni.id] = stableUUID('items', ni.id);
            itemIds.push(ni.id);
          }
        }
      }

      // Upsert ALL items (by id or by resolved name) to cloud
      const allItemIds = [...new Set([...itemIds, ...Object.values(nameToItemId)])].filter(Boolean);
      if (allItemIds.length > 0) {
        const localItems = await db.select<LocalItem[]>(
          `SELECT * FROM items WHERE id IN (${allItemIds.join(',')})`
        );
        const syncedItems = await upsertItemsByName(storeId, localItems);
        for (const [localId, cloudId] of Object.entries(syncedItems.cloudIdByLocalId)) {
          itemUUIDMap[Number(localId)] = cloudId;
        }
      }

      // Now insert transaction_items — resolve item_id from name if needed
      const cloudItems = txnItems.map((r, idx) => {
        let resolvedItemId: string | null = null;
        if (r.item_id && itemUUIDMap[r.item_id]) {
          resolvedItemId = itemUUIDMap[r.item_id];
        } else if (!r.item_id && r.item_name) {
          const localId = nameToItemId[r.item_name?.trim()];
          if (localId && itemUUIDMap[localId]) resolvedItemId = itemUUIDMap[localId];
        }
        return {
          id: stableUUID('transaction_items', `${txnUUID}:${idx}`),
          txn_id: txnUUID,
          item_id: resolvedItemId,
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

      for (const chunk of chunkArray(cloudItems, 50)) {
        await supabase.from('transaction_items').insert(chunk);
      }
    }
  } catch (err) {
    // Never block the UI — log silently
    console.warn('[CloudSync] Real-time sync failed (data safe locally):', err);
  }
}


/**
 * ── BACKUP: Local SQLite ──> Supabase Cloud ──────────────────────────────────
 *
 * Strategy: DELETE existing cloud data for this store, then UPSERT fresh.
 *
 * Why upsert instead of insert?
 *   The cloud has secondary UNIQUE constraints (store_id+name on items/parties).
 *   We use UPSERT (onConflict: 'id') so that re-runs of backup are idempotent.
 *   We still DELETE first to clean up stale rows not present locally anymore.
 *
 * Upload order (respects FK dependencies):
 *   items (no default_vendor_id yet) → parties → back-fill items.default_vendor_id
 *   → transactions → transaction_items → special_rates → order_book → app_settings
 */

/**
 * ── QUICK ITEMS SYNC: Push all local items to cloud ──
 *
 * Faster alternative to full backup when you only need item catalog synced.
 * Call this after creating new items via purchase bills so mobile app can see them.
 */
export async function syncItemsToCloud(
  storeId: string,
  onProgress?: (msg: string, pct: number) => void
): Promise<{ synced: number; errors: number; duplicateRows: number }> {
  const db = await getDB();
  onProgress?.('Reading local items...', 0);
  const localItems = await db.select<LocalItem[]>('SELECT * FROM items');
  onProgress?.(`Preparing ${localItems.length} local items...`, 20);
  const result = await upsertItemsByName(storeId, localItems);
  onProgress?.(`Done — ${result.synced} unique items synced`, 100);
  return result;
}

export async function backupLocalToCloud(
  storeId: string,
  onProgress: (phase: string, current: number, total: number) => void
): Promise<void> {
  const db = await getDB();

  // ── 1. Read all local data ─────────────────────────────────────────────────
  onProgress('Reading local data...', 0, 100);
  const localItems    = await db.select<any[]>('SELECT * FROM items');
  const localParties  = await db.select<any[]>('SELECT * FROM parties');
  const localTxns     = await db.select<any[]>('SELECT * FROM transactions');
  const localTxnItems = await db.select<any[]>('SELECT * FROM transaction_items');
  const localRates    = await db.select<any[]>('SELECT * FROM party_special_rates');
  const localOrders   = await db.select<any[]>('SELECT * FROM order_book');
  const localSettings = await db.select<any[]>('SELECT * FROM app_settings');

  // ── 2. Build stable UUID maps ──────────────────────────────────────────────
  const itemMap:  Record<number, string> = {};
  const partyMap: Record<number, string> = {};
  const txnMap:   Record<number, string> = {};
  localItems.forEach(r   => { itemMap[r.id]  = stableUUID('items', r.id); });
  localParties.forEach(r => { partyMap[r.id] = stableUUID('parties', r.id); });
  localTxns.forEach(r    => { txnMap[r.id]   = stableUUID('transactions', r.id); });

  // ── 3. Delete ALL existing cloud data (children first, then parents) ───────
  onProgress('Clearing existing cloud data...', 5, 100);

  // transaction_items has no store_id — must fetch parent transaction IDs first
  const existingTxnIds: string[] = [];
  let txnFrom = 0;
  while (true) {
    const { data } = await supabase
      .from('transactions').select('id').eq('store_id', storeId)
      .range(txnFrom, txnFrom + 999);
    if (!data || data.length === 0) break;
    existingTxnIds.push(...data.map((r: any) => r.id));
    if (data.length < 1000) break;
    txnFrom += 1000;
  }
  if (existingTxnIds.length > 0) {
    for (const batch of chunkArray(existingTxnIds, 50)) {
      const { error } = await supabase.from('transaction_items').delete().in('txn_id', batch);
      if (error) console.warn('[Backup] transaction_items delete warning:', error.message);
    }
  }

  onProgress('Clearing cloud records...', 8, 100);
  // Delete in dependency order: child tables first, then parent tables
  await supabase.from('party_special_rates').delete().eq('store_id', storeId);
  await supabase.from('order_book').delete().eq('store_id', storeId);
  await supabase.from('transactions').delete().eq('store_id', storeId);
  // Now safe to delete parents
  await supabase.from('items').delete().eq('store_id', storeId);
  await supabase.from('parties').delete().eq('store_id', storeId);
  await supabase.from('app_settings').delete().eq('store_id', storeId);

  // Small delay to ensure Supabase propagates the deletes before re-inserting
  await new Promise(resolve => setTimeout(resolve, 500));

  onProgress('Cloud cleared. Uploading...', 12, 100);

  // ── 4. Detect optional migrated columns ───────────────────────────────────
  // items.default_vendor_id and order_book.vendor_* were added in
  // migrate_vendor_tracking.sql. Customers who haven't run that migration
  // will get a schema cache error. We detect and skip gracefully.
  let hasItemVendorCol = true;
  {
    const { error } = await supabase.from('items').select('default_vendor_id').eq('store_id', storeId).limit(1);
    if (error && error.message.includes('schema cache')) {
      console.warn('[Backup] items.default_vendor_id not in schema — skipping');
      hasItemVendorCol = false;
    }
  }

  let hasOrderVendorCols = true;
  {
    const { error } = await supabase.from('order_book').select('vendor_id').eq('store_id', storeId).limit(1);
    if (error && error.message.includes('schema cache')) {
      console.warn('[Backup] order_book vendor columns not in schema — skipping');
      hasOrderVendorCols = false;
    }
  }

  // ── 5. Upload Items (WITHOUT default_vendor_id — parties don't exist yet) ──
  // default_vendor_id is a FK → parties. We back-fill after parties are uploaded.
  if (localItems.length > 0) {
    const cloudItems = localItems.map(r => ({
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
      // default_vendor_id omitted intentionally — set after parties upload
    }));

    const chunks = chunkArray(cloudItems, 100);
    for (let i = 0; i < chunks.length; i++) {
      onProgress(`Uploading items ${i + 1}/${chunks.length}...`, 15 + Math.round(10 * i / chunks.length), 100);
      // Use upsert (onConflict: 'id') so backup is idempotent — safe even if delete didn't fully clear
      const { error } = await supabase.from('items').upsert(chunks[i], { onConflict: 'id' });
      if (error) throw new Error(`Backup items error: ${error.message}`);
    }
  }

  // ── 6. Upload Parties ──────────────────────────────────────────────────────
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
      onProgress(`Uploading parties ${i + 1}/${chunks.length}...`, 28 + Math.round(10 * i / chunks.length), 100);
      // Use upsert (onConflict: 'id') — handles unique constraint on (store_id, name)
      const { error } = await supabase.from('parties').upsert(chunks[i], { onConflict: 'id' });
      if (error) throw new Error(`Backup parties error: ${error.message}`);
    }
  }

  // ── 7. Back-fill items.default_vendor_id (parties now exist) ──────────────
  if (hasItemVendorCol && localItems.length > 0) {
    const itemsWithVendor = localItems.filter(
      r => r.default_vendor_id && partyMap[r.default_vendor_id]
    );
    if (itemsWithVendor.length > 0) {
      onProgress('Linking item default vendors...', 40, 100);
      // Batch updates: build an array of {id, default_vendor_id} and upsert
      const vendorUpdates = itemsWithVendor.map(r => ({
        id: itemMap[r.id],
        store_id: storeId,
        name: r.name,           // required for UNIQUE constraint satisfaction on upsert
        default_vendor_id: partyMap[r.default_vendor_id],
      }));
      const chunks = chunkArray(vendorUpdates, 100);
      for (const chunk of chunks) {
        const { error } = await supabase
          .from('items')
          .upsert(chunk, { onConflict: 'id' });
        if (error) {
          // Non-fatal — vendor link is a convenience field, not critical
          console.warn('[Backup] Back-fill vendor links warning:', error.message);
        }
      }
    }
  }

  // ── 8. Upload Transactions ─────────────────────────────────────────────────
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
      onProgress(`Uploading transactions ${i + 1}/${chunks.length}...`, 42 + Math.round(18 * i / chunks.length), 100);
      const { error } = await supabase.from('transactions').upsert(chunks[i], { onConflict: 'id' });
      if (error) throw new Error(`Backup transactions error: ${error.message}`);
    }
  }

  // ── 9. Upload Transaction Items ────────────────────────────────────────────
  const validTxnItems = localTxnItems.filter(r => txnMap[r.txn_id]);
  if (validTxnItems.length > 0) {
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
      onProgress(`Uploading line items ${i + 1}/${chunks.length}...`, 60 + Math.round(15 * i / chunks.length), 100);
      const { error } = await supabase.from('transaction_items').upsert(chunks[i], { onConflict: 'id' });
      if (error) throw new Error(`Backup line items error: ${error.message}`);
    }
  }

  // ── 10. Upload Special Rates ───────────────────────────────────────────────
  if (localRates.length > 0) {
    onProgress('Uploading special rates...', 78, 100);
    // Local SQLite party_special_rates uses composite PK (party_id, item_id) with NO standalone `id`.
    // Use composite stableUUID so the cloud id is deterministic and correct.
    const cloudRates = localRates
      .filter(r => itemMap[r.item_id] && partyMap[r.party_id])
      .map(r => ({
        id: stableUUID('party_special_rates', `${r.party_id}:${r.item_id}`),
        store_id: storeId,
        party_id: partyMap[r.party_id],
        item_id: itemMap[r.item_id],
        price: r.price ? Number(r.price) : null,
        discount: r.discount ? Number(r.discount) : null,
      }));

    if (cloudRates.length > 0) {
      for (const chunk of chunkArray(cloudRates, 100)) {
        const { error } = await supabase.from('party_special_rates').upsert(chunk, { onConflict: 'id' });
        if (error) throw new Error(`Backup special rates error: ${error.message}`);
      }
    }
  }

  // ── 11. Upload Order Book ──────────────────────────────────────────────────
  if (localOrders.length > 0) {
    onProgress('Uploading order book...', 83, 100);
    const cloudOrders = localOrders.map(r => {
      const row: Record<string, any> = {
        id: stableUUID('order_book', r.id),
        store_id: storeId,
        item_id: r.item_id && itemMap[r.item_id] ? itemMap[r.item_id] : null,
        item_name: r.item_name || null,
        quantity: Number(r.quantity) || 1,
        status: ['pending', 'ordered', 'received', 'cancelled'].includes(r.status) ? r.status : 'pending',
        ordered_at: r.ordered_at ? new Date(r.ordered_at).toISOString() : null,
      };
      if (hasOrderVendorCols) {
        row.vendor_id = r.vendor_id && partyMap[r.vendor_id] ? partyMap[r.vendor_id] : null;
        row.vendor_name = r.vendor_name || null;
        row.vendor_phone = r.vendor_phone || null;
      }
      return row;
    });

    const chunks = chunkArray(cloudOrders, 100);
    for (let i = 0; i < chunks.length; i++) {
      onProgress(`Uploading order book ${i + 1}/${chunks.length}...`, 85 + Math.round(5 * i / chunks.length), 100);
      const { error } = await supabase.from('order_book').upsert(chunks[i], { onConflict: 'id' });
      if (error) throw new Error(`Backup order book error: ${error.message}`);
    }
  }

  // ── 12. Upload App Settings ────────────────────────────────────────────────
  // Push ONLY rows that actually exist locally. Do NOT merge hardcoded defaults —
  // that inflates the cloud count and causes a false "Differs" in Data Comparison.
  // The app already handles default values client-side when a key is missing.
  if (localSettings.length > 0) {
    onProgress('Uploading settings...', 93, 100);
    const cloudSettings = localSettings
      .map(r => ({
        store_id: storeId,
        key: r.key,
        value: r.value ?? null,
      }));

    if (cloudSettings.length > 0) {
      for (const chunk of chunkArray(cloudSettings, 100)) {
        // onConflict uses composite key (store_id, key)
        const { error } = await supabase.from('app_settings').upsert(chunk, { onConflict: 'store_id,key' });
        if (error) throw new Error(`Backup settings error: ${error.message}`);
      }
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

  // 2. Clear local SQLite tables in reverse dependency order
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

  // 3. Insert items (without default_vendor_id — parties not yet inserted)
  const itemCloudDefaultVendorMap: Record<number, string | null> = {};
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
      if (r.default_vendor_id) itemCloudDefaultVendorMap[localItemId] = r.default_vendor_id;
    }
  }

  // 4. Insert parties
  if (cloudParties && cloudParties.length > 0) {
    for (let i = 0; i < cloudParties.length; i++) {
      onProgress(`Restoring local parties ${i + 1}/${cloudParties.length}...`, 80, 100);
      const r = cloudParties[i];
      const res = await db.execute(
        `INSERT INTO parties (name, phone, gstin, address, type, opening_balance)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [r.name, r.phone || null, r.gstin || null, r.address || null, r.type || 'customer', Number(r.opening_balance) || 0]
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

  // 5. Insert transactions
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

  // 6. Insert transaction_items
  if (cloudTxnItems && cloudTxnItems.length > 0) {
    for (let i = 0; i < cloudTxnItems.length; i++) {
      onProgress(`Restoring local line items ${i + 1}/${cloudTxnItems.length}...`, 95, 100);
      const r = cloudTxnItems[i];
      const txnIntId = txnUuidToId[r.txn_id];
      const itemIntId = r.item_id ? itemUuidToId[r.item_id] : null;
      if (!txnIntId) continue;
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

  // 7. Insert special rates
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
          console.warn('Restore special rate skipped:', err);
        }
      }
    }
  }

  // 8. Insert order_book
  if (cloudOrders && cloudOrders.length > 0) {
    for (let i = 0; i < cloudOrders.length; i++) {
      onProgress(`Restoring local order book ${i + 1}/${cloudOrders.length}...`, 99, 100);
      const r = cloudOrders[i];
      const itemIntId = r.item_id ? itemUuidToId[r.item_id] : null;
      const vendorIntId = r.vendor_id ? partyUuidToId[r.vendor_id] : null;
      await db.execute(
        `INSERT INTO order_book (item_id, item_name, quantity, status, ordered_at, vendor_id, vendor_name, vendor_phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [itemIntId, r.item_name || null, Number(r.quantity) || 1, r.status || 'pending', r.ordered_at || null,
         vendorIntId, r.vendor_name || null, r.vendor_phone || null]
      );
    }
  }

  // 9. Insert app_settings
  if (cloudSettings && cloudSettings.length > 0) {
    for (let i = 0; i < cloudSettings.length; i++) {
      onProgress(`Restoring local app settings ${i + 1}/${cloudSettings.length}...`, 100, 100);
      const r = cloudSettings[i];
      await db.execute(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2`,
        [r.key, r.value || null]
      );
    }
  }

  onProgress('Cloud Restore completed successfully!', 100, 100);
}
