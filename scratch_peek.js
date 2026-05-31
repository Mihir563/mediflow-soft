const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'src-tauri', 'mediflow.db');

async function main() {
  console.log('Opening local SQLite DB at:', DB_PATH);
  const db = new Database(DB_PATH, { readonly: true });
  
  console.log('\n--- Checking Transactions ---');
  const txnsCount = db.prepare("SELECT type, COUNT(*) as cnt FROM transactions GROUP BY type").all();
  console.log('Transactions count:', txnsCount);
  
  console.log('\n--- Checking Parties ---');
  const partiesCount = db.prepare("SELECT type, COUNT(*) as cnt FROM parties GROUP BY type").all();
  console.log('Parties count:', partiesCount);

  console.log('\n--- Checking Order Book ---');
  const orders = db.prepare("SELECT * FROM order_book LIMIT 10").all();
  console.log('First few order book entries:', orders);
  
  if (orders.length > 0) {
    console.log('\n--- Checking last purchase for first few order items ---');
    for (const order of orders) {
      const lastPurchaseQuery = `
        SELECT t.id, t.party_id, p.name as party_name, p.phone as party_phone, ti.price 
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti.txn_id
        LEFT JOIN parties p ON p.id = t.party_id
        WHERE ti.item_id = ? AND t.type = 'purchase'
        ORDER BY t.date DESC, t.id DESC
        LIMIT 1
      `;
      const res = db.prepare(lastPurchaseQuery).all(order.item_id);
      console.log(`- Item ${order.item_name} (ID: ${order.item_id}) -> Last Purchase:`, res);
    }
  }

  db.close();
}

main().catch(console.error);
