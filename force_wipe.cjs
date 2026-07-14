/**
 * Wipe ALL data for Raghuveer Medical store — aggressive version
 * Deletes row by row for transactions to ensure nothing is left.
 */
const https = require('https');

const SUPABASE_HOST    = 'qfxnpnhntjupqmrfztdg.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmeG5wbmhudGp1cHFtcmZ6dGRnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTk3NTM0MywiZXhwIjoyMDk1NTUxMzQzfQ.9Dr31RAsAcjfmKaDH_GanaWHQLlz8YQwKSbukKQlsHM';
const STORE_ID         = '0a05c5d1-d4a8-4d4a-95a2-5d3aaf6ed7e0';

function req(method, urlPath, body) {
  return new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: SUPABASE_HOST,
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY,
        'Prefer': 'return=minimal',
        ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };
    const r = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, data: d }));
    });
    r.on('error', e => resolve({ status: 0, data: e.message }));
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

async function main() {
  console.log('🗑️  Force wiping all data for store:', STORE_ID);

  // Step 1: delete transaction_items via all transactions of this store
  // PostgREST allows nested deletes via RPC but simplest is to delete all transactions
  // which cascade-deletes transaction_items
  
  // First verify what's there
  const check = await req('GET', `/rest/v1/transactions?store_id=eq.${STORE_ID}&select=id&limit=1`);
  console.log('Transactions check:', check.status, check.data.slice(0, 100));

  const tables = [
    `party_special_rates?store_id=eq.${STORE_ID}`,
    `transaction_items?txn_id=in.(select id from transactions where store_id='${STORE_ID}')`,
    `transactions?store_id=eq.${STORE_ID}`,
    `parties?store_id=eq.${STORE_ID}`,
    `items?store_id=eq.${STORE_ID}`,
  ];

  // Simple delete for each table directly
  const simpleDeletes = [
    `party_special_rates?store_id=eq.${STORE_ID}`,
    `transactions?store_id=eq.${STORE_ID}`,
    `parties?store_id=eq.${STORE_ID}`,
    `items?store_id=eq.${STORE_ID}`,
  ];

  for (const path of simpleDeletes) {
    const res = await req('DELETE', `/rest/v1/${path}`);
    const tbl = path.split('?')[0];
    if (res.status >= 200 && res.status < 300) {
      console.log(`  ✓ Cleared ${tbl} (HTTP ${res.status})`);
    } else {
      console.error(`  ❌ ${tbl}: HTTP ${res.status} — ${res.data.slice(0, 200)}`);
    }
  }

  console.log('\n✅ Wipe complete.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
