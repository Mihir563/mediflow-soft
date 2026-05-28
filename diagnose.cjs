const https = require('https');

const SUPABASE_HOST    = 'qfxnpnhntjupqmrfztdg.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmeG5wbmhudGp1cHFtcmZ6dGRnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTk3NTM0MywiZXhwIjoyMDk1NTUxMzQzfQ.9Dr31RAsAcjfmKaDH_GanaWHQLlz8YQwKSbukKQlsHM';

function httpGet(path) {
  return new Promise((resolve) => {
    const options = {
      hostname: SUPABASE_HOST, path, method: 'GET',
      headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}`, 'apikey': SERVICE_ROLE_KEY }
    };
    const r = https.request(options, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    r.on('error', e => resolve(e.message));
    r.end();
  });
}

async function main() {
  // Get all stores
  const stores = await httpGet('/rest/v1/stores?select=id,name&order=name');
  console.log('\nAll stores:');
  stores.forEach(s => console.log(`  [${s.id}] ${s.name}`));

  // Check transaction counts per store
  console.log('\nTransaction counts per store:');
  for (const s of stores) {
    const txns = await httpGet(`/rest/v1/transactions?store_id=eq.${s.id}&select=id&limit=5`);
    const count = Array.isArray(txns) ? txns.length : '?';
    console.log(`  [${s.id}] ${s.name}: ${count > 0 ? count + '+ rows' : '0 rows'}`);
  }

  // Find INV-0947 specifically
  const inv = await httpGet(`/rest/v1/transactions?invoice_no=eq.INV-0947&select=id,store_id,invoice_no,type`);
  console.log('\nINV-0947 record:', JSON.stringify(inv));
}

main();
