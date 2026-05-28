/**
 * MediFlow — Wipe partial migration data from Supabase store
 * Deletes items, parties, transactions, transaction_items for Raghuveer Medical
 * so we can do a clean re-migration.
 */
const https = require('https');

const SUPABASE_HOST    = 'qfxnpnhntjupqmrfztdg.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmeG5wbmhudGp1cHFtcmZ6dGRnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTk3NTM0MywiZXhwIjoyMDk1NTUxMzQzfQ.9Dr31RAsAcjfmKaDH_GanaWHQLlz8YQwKSbukKQlsHM';
const STORE_ID         = '0a05c5d1-d4a8-4d4a-95a2-5d3aaf6ed7e0';

function httpDel(urlPath) {
  return new Promise((resolve) => {
    const options = {
      hostname: SUPABASE_HOST,
      path: urlPath,
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY,
        'Prefer': 'return=minimal',
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', e => resolve({ status: 0, data: e.message }));
    req.end();
  });
}

async function main() {
  console.log('\n🗑️  Wiping partial migration data for store:', STORE_ID);
  console.log('   (transaction_items cascade-deleted with transactions)\n');

  // Delete in dependency order — cascade handles transaction_items automatically
  const tables = [
    ['party_special_rates', `store_id=eq.${STORE_ID}`],
    ['order_book',          `store_id=eq.${STORE_ID}`],
    ['transactions',        `store_id=eq.${STORE_ID}`],  // cascades → transaction_items
    ['parties',             `store_id=eq.${STORE_ID}`],
    ['items',               `store_id=eq.${STORE_ID}`],
  ];

  for (const [table, filter] of tables) {
    const res = await httpDel(`/rest/v1/${table}?${filter}`);
    if (res.status >= 200 && res.status < 300) {
      console.log(`  ✓ Cleared ${table}`);
    } else {
      console.error(`  ❌ Failed to clear ${table}: HTTP ${res.status} — ${res.data}`);
    }
  }

  console.log('\n✅ Done! Now run: node full_setup_and_migrate.cjs\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
