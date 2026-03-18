const db = require('better-sqlite3')(require('path').join(process.env.APPDATA, 'com.tauri.dev', 'mediflow.db')); 
const totalP = db.prepare(`SELECT COUNT(*) as c FROM transaction_items WHERE txn_id IN (SELECT id FROM transactions WHERE type='purchase')`).get().c;
console.log('Total purchase items in DB:', totalP);

const items = db.prepare(`SELECT * FROM transaction_items WHERE item_name LIKE '%asth%' AND txn_id IN (SELECT id FROM transactions WHERE type='purchase')`).all();
console.log('Purchase Items containing "asth":', items.length);
if (items.length > 0) {
    const sample = items[0];
    const txn = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(sample.txn_id);
    const party = db.prepare(`SELECT name FROM parties WHERE id = ?`).get(txn.party_id);
    console.log('Sample item:', sample.item_name, '| Type:', txn.type, '| Party:', party ? party.name : null);
}
