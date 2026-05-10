/**
 * Cloud Sync Engine — MongoDB Atlas Data API
 * 
 * Uses pure HTTP fetch to communicate with MongoDB Atlas Data API.
 * No MongoDB driver needed — works in Tauri/browser environments.
 * 
 * Strategy: Option C (Push/Pull Override)
 * - Push: Drops all cloud collections, re-uploads entire local DB
 * - Pull: Drops all local tables, re-inserts from cloud data
 */

import { getDB } from './db';

// All tables we sync
const SYNC_TABLES = [
  'items',
  'parties',
  'transactions',
  'transaction_items',
  'order_book',
  'party_special_rates',
  'app_settings',
] as const;

type SyncTable = typeof SYNC_TABLES[number];

export interface MongoConfig {
  apiKey: string;
  appId: string;
  cluster: string;
  database: string;
}

export interface SyncProgress {
  phase: 'idle' | 'reading' | 'uploading' | 'downloading' | 'writing' | 'done' | 'error';
  table?: string;
  tableIndex?: number;
  totalTables?: number;
  rowCount?: number;
  message: string;
}

// ─── Config persistence ───────────────────────────────────────────

export async function loadMongoConfig(): Promise<MongoConfig | null> {
  try {
    const db = await getDB();
    const rows = await db.select<{ key: string; value: string }[]>(
      `SELECT key, value FROM app_settings WHERE key LIKE 'mongo_%'`
    );
    if (rows.length === 0) return null;
    const map: Record<string, string> = {};
    rows.forEach(r => { map[r.key] = r.value; });
    if (!map.mongo_api_key || !map.mongo_app_id) return null;
    return {
      apiKey: map.mongo_api_key || '',
      appId: map.mongo_app_id || '',
      cluster: map.mongo_cluster || 'Cluster0',
      database: map.mongo_database || 'mediflow_backup',
    };
  } catch {
    return null;
  }
}

export async function saveMongoConfig(config: MongoConfig): Promise<void> {
  const db = await getDB();
  const entries = [
    ['mongo_api_key', config.apiKey],
    ['mongo_app_id', config.appId],
    ['mongo_cluster', config.cluster],
    ['mongo_database', config.database],
  ];
  for (const [key, value] of entries) {
    await db.execute(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2`,
      [key, value]
    );
  }
}

// ─── MongoDB Atlas Data API helpers ───────────────────────────────

function getBaseUrl(appId: string): string {
  return `https://data.mongodb-api.com/app/${appId}/endpoint/data/v1`;
}

async function mongoRequest(
  config: MongoConfig,
  action: string,
  body: Record<string, any>
): Promise<any> {
  const url = `${getBaseUrl(config.appId)}/action/${action}`;
  const payload = {
    dataSource: config.cluster,
    database: config.database,
    ...body,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': config.apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MongoDB API error (${res.status}): ${text}`);
  }

  return res.json();
}

// ─── PUSH: Local → Cloud ──────────────────────────────────────────

export async function pushToCloud(
  config: MongoConfig,
  onProgress: (p: SyncProgress) => void
): Promise<void> {
  const db = await getDB();

  for (let i = 0; i < SYNC_TABLES.length; i++) {
    const table = SYNC_TABLES[i];

    // Phase 1: Read local data
    onProgress({
      phase: 'reading',
      table,
      tableIndex: i + 1,
      totalTables: SYNC_TABLES.length,
      message: `Reading local "${table}"...`,
    });

    const rows = await db.select<any[]>(`SELECT * FROM ${table}`);

    // Phase 2: Delete existing cloud collection data
    onProgress({
      phase: 'uploading',
      table,
      tableIndex: i + 1,
      totalTables: SYNC_TABLES.length,
      rowCount: rows.length,
      message: `Clearing cloud "${table}"...`,
    });

    try {
      await mongoRequest(config, 'deleteMany', {
        collection: table,
        filter: {},
      });
    } catch {
      // Collection may not exist yet — that's fine
    }

    // Phase 3: Insert all rows (in batches of 100)
    if (rows.length > 0) {
      onProgress({
        phase: 'uploading',
        table,
        tableIndex: i + 1,
        totalTables: SYNC_TABLES.length,
        rowCount: rows.length,
        message: `Uploading ${rows.length} rows to "${table}"...`,
      });

      const batchSize = 100;
      for (let b = 0; b < rows.length; b += batchSize) {
        const batch = rows.slice(b, b + batchSize);
        // Add _localId to preserve SQLite row identity
        const documents = batch.map(row => ({
          ...row,
          _localId: row.id ?? row.key, // items/parties use id, app_settings uses key
        }));
        await mongoRequest(config, 'insertMany', {
          collection: table,
          documents,
        });
      }
    }
  }

  // Save sync timestamp
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO app_settings (key, value) VALUES ('mongo_last_push', $1) ON CONFLICT(key) DO UPDATE SET value = $1`,
    [now]
  );

  onProgress({
    phase: 'done',
    message: `✅ All ${SYNC_TABLES.length} tables pushed to cloud successfully!`,
  });
}

// ─── PULL: Cloud → Local ──────────────────────────────────────────

export async function pullFromCloud(
  config: MongoConfig,
  onProgress: (p: SyncProgress) => void
): Promise<void> {
  const db = await getDB();

  // First, download all data from cloud
  const cloudData: Record<string, any[]> = {};

  for (let i = 0; i < SYNC_TABLES.length; i++) {
    const table = SYNC_TABLES[i];

    onProgress({
      phase: 'downloading',
      table,
      tableIndex: i + 1,
      totalTables: SYNC_TABLES.length,
      message: `Downloading "${table}" from cloud...`,
    });

    try {
      const result = await mongoRequest(config, 'find', {
        collection: table,
        filter: {},
        limit: 50000, // safety limit
      });
      cloudData[table] = result.documents || [];
    } catch {
      cloudData[table] = [];
    }
  }

  // Now replace local data
  // Order matters: delete children first (transaction_items, party_special_rates), then parents
  const deleteOrder: SyncTable[] = [
    'transaction_items',
    'party_special_rates',
    'order_book',
    'app_settings',
    'transactions',
    'parties',
    'items',
  ];

  // Insert order: parents first, then children
  const insertOrder: SyncTable[] = [
    'items',
    'parties',
    'transactions',
    'transaction_items',
    'order_book',
    'party_special_rates',
    'app_settings',
  ];

  // Delete all local data
  for (const table of deleteOrder) {
    onProgress({
      phase: 'writing',
      table,
      message: `Clearing local "${table}"...`,
    });
    await db.execute(`DELETE FROM ${table}`);
  }

  // Insert cloud data
  for (let i = 0; i < insertOrder.length; i++) {
    const table = insertOrder[i];
    const rows = cloudData[table] || [];

    onProgress({
      phase: 'writing',
      table,
      tableIndex: i + 1,
      totalTables: insertOrder.length,
      rowCount: rows.length,
      message: `Restoring ${rows.length} rows to "${table}"...`,
    });

    for (const row of rows) {
      // Remove MongoDB-specific fields
      const cleanRow = { ...row };
      delete cleanRow._id;
      delete cleanRow._localId;

      const columns = Object.keys(cleanRow);
      if (columns.length === 0) continue;

      const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
      const values = columns.map(col => cleanRow[col]);

      try {
        await db.execute(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
          values
        );
      } catch (e) {
        console.warn(`Failed to insert row into ${table}:`, e, cleanRow);
      }
    }
  }

  // Save sync timestamp
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO app_settings (key, value) VALUES ('mongo_last_pull', $1) ON CONFLICT(key) DO UPDATE SET value = $1`,
    [now]
  );

  onProgress({
    phase: 'done',
    message: `✅ All data restored from cloud successfully!`,
  });
}

// ─── Cloud stats (for UI display) ─────────────────────────────────

export async function getCloudStats(
  config: MongoConfig
): Promise<Record<string, number>> {
  const stats: Record<string, number> = {};
  for (const table of SYNC_TABLES) {
    try {
      const result = await mongoRequest(config, 'find', {
        collection: table,
        filter: {},
        projection: { _id: 1 },
        limit: 50000,
      });
      stats[table] = result.documents?.length || 0;
    } catch {
      stats[table] = 0;
    }
  }
  return stats;
}

export async function getLocalStats(): Promise<Record<string, number>> {
  const db = await getDB();
  const stats: Record<string, number> = {};
  for (const table of SYNC_TABLES) {
    try {
      const res = await db.select<{ cnt: number }[]>(`SELECT COUNT(*) as cnt FROM ${table}`);
      stats[table] = res[0]?.cnt || 0;
    } catch {
      stats[table] = 0;
    }
  }
  return stats;
}
