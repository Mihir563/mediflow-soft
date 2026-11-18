import Database from '@tauri-apps/plugin-sql';
import { appDataDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';

/**
 * One-time data fixes that run on app start, BEFORE any other startup work.
 *
 * Safety rules for every fix in this file:
 *  1. A full copy of the database is written next to mediflow.db first, and the
 *     copy is opened and checked (same bill / line counts). If that fails, the
 *     fix is skipped completely and nothing is changed.
 *  2. Only the exact bills listed are touched, matched by bill number + date
 *     (or bill number + amount). Ambiguous or missing bills are skipped.
 *  3. Only the bill's supplier (party_id) is changed. Items, amounts, stock and
 *     payments are never modified.
 *  4. Each fix runs once; the result is recorded in the `data_fixes` table.
 */

// Bills whose cloud sync failed or still needs pushing. Read by supabaseSyncHelper.
export const PENDING_SYNC_KEY = 'mf_pending_txn_sync';

export function readPendingSync(): number[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_SYNC_KEY) || '[]').map(Number).filter(Boolean);
  } catch {
    return [];
  }
}

export function writePendingSync(ids: number[]) {
  try {
    localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify([...new Set(ids)]));
  } catch { /* ignore */ }
}

// ─── Fix 2026-11: purchase bills saved under the wrong supplier ───────────────
// Checked against the paper bills on 2026-11-18. These were saved as
// "Om Sai Distributors" / "Krishna Medical" by the old supplier-guessing sync.

type SupplierKey = 'BHARAT' | 'HARDIK' | 'UMIYA';

const SUPPLIERS: Record<SupplierKey, { match: string[]; create: { name: string; phone: string; address: string } }> = {
  BHARAT: {
    match: ['BHARAT MEDICAL AGENCY'],
    create: { name: 'BHARAT MEDICAL AGENCY', phone: '9427366446', address: 'IDAR' },
  },
  HARDIK: {
    match: ['HARDIK ASSOCIATES', 'HARDIK ASSOCIATION'],
    create: { name: 'HARDIK ASSOCIATES', phone: '02772242273', address: 'HIMATNAGAR' },
  },
  UMIYA: {
    match: ['UMIYA MEDICAL AND PROVISION STORE', 'UMIYA MEDICAL AND PROVISION STORES'],
    create: { name: 'UMIYA MEDICAL AND PROVISION STORE', phone: '7486853940', address: 'HIMATNAGAR' },
  },
};

const BILL_FIXES: { invoice: string; date: string; total: number; supplier: SupplierKey }[] = [
  { invoice: 'A001937',      date: '2026-10-30', total: 1595,  supplier: 'BHARAT' },
  { invoice: 'A001201',      date: '2026-08-14', total: 1873,  supplier: 'BHARAT' },
  { invoice: 'A001166',      date: '2026-08-12', total: 6497,  supplier: 'BHARAT' },
  { invoice: 'A014093',      date: '2026-10-14', total: 1443,  supplier: 'HARDIK' },
  { invoice: '26/SZ-000560', date: '2026-08-25', total: 13810, supplier: 'UMIYA' },
  { invoice: '26/SZ-000511', date: '2026-08-13', total: 5452,  supplier: 'UMIYA' },
  { invoice: '26/SZ-000515', date: '2026-08-14', total: 5814,  supplier: 'UMIYA' },
];

const FIX_ID = '2026-11-18-supplier-relabel';

const normInvoice = (s: string) => s.toUpperCase().replace(/\s+/g, '');

async function tableExists(db: Database, name: string) {
  const r = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=$1`, [name]
  );
  return Number(r[0]?.n) > 0;
}

/** Write a full copy of the database and prove it is readable and complete. */
export async function backupDatabase(db: Database, label: string): Promise<string> {
  const dir = await join(await appDataDir(), 'backups'); // created by the Rust side on start
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = await join(dir, `mediflow-backup-${label}-${stamp}.db`);
  await db.execute(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

  const live = await db.select<{ t: number; ti: number; p: number }[]>(
    `SELECT (SELECT COUNT(*) FROM transactions) AS t, (SELECT COUNT(*) FROM transaction_items) AS ti, (SELECT COUNT(*) FROM parties) AS p`
  );
  const copy = await Database.load(`sqlite:${file}`);
  try {
    const bk = await copy.select<{ t: number; ti: number; p: number }[]>(
      `SELECT (SELECT COUNT(*) FROM transactions) AS t, (SELECT COUNT(*) FROM transaction_items) AS ti, (SELECT COUNT(*) FROM parties) AS p`
    );
    const a = live[0], b = bk[0];
    if (!a || !b || a.t !== b.t || a.ti !== b.ti || a.p !== b.p) {
      throw new Error(`backup check failed (live ${JSON.stringify(a)} vs copy ${JSON.stringify(b)})`);
    }
  } finally {
    await copy.close().catch(() => {});
  }
  return file;
}

async function resolveSupplier(db: Database, key: SupplierKey, log: string[]): Promise<number> {
  const s = SUPPLIERS[key];
  for (const name of s.match) {
    const r = await db.select<{ id: number }[]>(
      `SELECT id FROM parties WHERE UPPER(TRIM(name)) = $1 ORDER BY id LIMIT 1`, [name]
    );
    if (r.length) return r[0].id;
  }
  const res = await db.execute(
    `INSERT INTO parties (name, phone, address, type, opening_balance) VALUES ($1, $2, $3, 'vendor', 0)`,
    [s.create.name, s.create.phone, s.create.address]
  );
  const id = Number((res as { lastInsertId?: number }).lastInsertId);
  if (!id) throw new Error(`could not create supplier ${s.create.name}`);
  log.push(`created supplier "${s.create.name}" (id ${id})`);
  return id;
}

async function fixWrongSuppliers(db: Database) {
  if (!(await tableExists(db, 'transactions')) || !(await tableExists(db, 'parties'))) return; // fresh install

  await db.execute(`CREATE TABLE IF NOT EXISTS data_fixes (id TEXT PRIMARY KEY, applied_at TEXT, backup_file TEXT, log TEXT)`);
  const done = await db.select<{ id: string }[]>(`SELECT id FROM data_fixes WHERE id = $1`, [FIX_ID]);
  if (done.length) return;

  // 1. Backup first. Any error here aborts the whole fix with nothing changed.
  const backupFile = await backupDatabase(db, 'before-supplier-fix');
  const log: string[] = [`backup: ${backupFile}`];
  const changedIds: number[] = [];
  const supplierIds: Partial<Record<SupplierKey, number>> = {};

  // 2. Fix each listed bill.
  for (const fix of BILL_FIXES) {
    const cands = await db.select<{ id: number; date: string; total_amount: number; party_id: number | null; party_name: string | null }[]>(
      `SELECT t.id, t.date, t.total_amount, t.party_id, p.name AS party_name
         FROM transactions t LEFT JOIN parties p ON p.id = t.party_id
        WHERE t.type = 'purchase' AND REPLACE(UPPER(TRIM(t.invoice_no)), ' ', '') = $1`,
      [normInvoice(fix.invoice)]
    );
    const byDate = cands.filter(c => String(c.date || '').slice(0, 10) === fix.date);
    const byTotal = cands.filter(c => Math.abs(Number(c.total_amount) - fix.total) < 1);
    const pick = byDate.length === 1 ? byDate[0] : byDate.length === 0 && byTotal.length === 1 ? byTotal[0] : null;
    if (!pick) {
      log.push(`${fix.invoice}: SKIPPED (${cands.length} bills with this number, ${byDate.length} on ${fix.date})`);
      continue;
    }

    supplierIds[fix.supplier] ??= await resolveSupplier(db, fix.supplier, log);
    const target = supplierIds[fix.supplier]!;
    if (pick.party_id === target) {
      log.push(`${fix.invoice}: already correct`);
      continue;
    }
    await db.execute(`UPDATE transactions SET party_id = $1 WHERE id = $2 AND type = 'purchase'`, [target, pick.id]);
    changedIds.push(pick.id);
    const newName = (await db.select<{ name: string }[]>(`SELECT name FROM parties WHERE id = $1`, [target]))[0]?.name;
    log.push(`${fix.invoice} (bill id ${pick.id}): "${pick.party_name ?? 'none'}" -> "${newName}"`);
  }

  // 3. Record that this ran, then queue changed bills so the cloud copy is updated too.
  await db.execute(
    `INSERT INTO data_fixes (id, applied_at, backup_file, log) VALUES ($1, datetime('now','localtime'), $2, $3)`,
    [FIX_ID, backupFile, log.join('\n')]
  );
  if (changedIds.length) writePendingSync([...readPendingSync(), ...changedIds]);
  console.log(`[DataFix ${FIX_ID}]\n${log.join('\n')}`);
}

// ─── Daily automatic backup: one verified copy per day, newest 3 kept ─────────
const DAILY_KEY = 'mf_last_daily_backup';
const DAILY_KEEP = 3;

async function dailyBackup(db: Database) {
  if (!(await tableExists(db, 'transactions'))) return;
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
  let last: string | null = null;
  try { last = localStorage.getItem(DAILY_KEY); } catch { /* ignore */ }
  if (last === today) return;
  const file = await backupDatabase(db, 'daily');
  try { localStorage.setItem(DAILY_KEY, today); } catch { /* ignore */ }
  const removed = await invoke<string[]>('prune_backups', { kind: 'daily', keep: DAILY_KEEP });
  console.log(`[DailyBackup] saved ${file}${removed.length ? `, removed old: ${removed.join(', ')}` : ''}`);
}

/** Never throws — a failed backup or fix must not stop the app from opening. */
export async function runStartupDataFixes(db: Database) {
  try {
    await fixWrongSuppliers(db);
  } catch (e) {
    console.error(`[DataFix ${FIX_ID}] not applied, nothing changed after the failure point:`, e);
  }
  try {
    await dailyBackup(db);
  } catch (e) {
    console.error('[DailyBackup] failed (will retry next start):', e);
  }
}
