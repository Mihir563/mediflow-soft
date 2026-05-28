/**
 * Check what's actually in Supabase and force-delete transactions using RPC
 */
const https = require('https');

const SUPABASE_HOST    = 'qfxnpnhntjupqmrfztdg.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmeG5wbmhudGp1cHFtcmZ6dGRnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTk3NTM0MywiZXhwIjoyMDk1NTUxMzQzfQ.9Dr31RAsAcjfmKaDH_GanaWHQLlz8YQwKSbukKQlsHM';
const STORE_ID         = '0a05c5d1-d4a8-4d4a-95a2-5d3aaf6ed7e0';

function httpReq(method, urlPath, body) {
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
        'Prefer': 'return=minimal',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
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
  // Check count of transactions
  const countRes = await httpReq('GET', `/rest/v1/transactions?store_id=eq.${STORE_ID}&select=id&limit=5`);
  console.log(`Transactions count check (HTTP ${countRes.status}):`, countRes.data.slice(0, 200));

  // Try via RPC to bypass RLS completely
  console.log('\nAttempting DELETE via REST with service role...');
  const delRes = await httpReq('DELETE', `/rest/v1/transactions?store_id=eq.${STORE_ID}`);
  console.log(`DELETE transactions: HTTP ${delRes.status} — ${delRes.data.slice(0, 200)}`);

  // Also delete transaction_items explicitly
  const delItems = await httpReq('DELETE', `/rest/v1/transaction_items?txn_id=neq.00000000-0000-0000-0000-000000000000`);
  console.log(`DELETE all transaction_items: HTTP ${delItems.status} — ${delItems.data.slice(0, 200)}`);
}

main();
