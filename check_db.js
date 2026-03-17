const path = require('path');
const DB_PATH = path.join(process.env.APPDATA, 'com.tauri.dev', 'mediflow.db');
const db = require('better-sqlite3')(DB_PATH);

const txns = db.prepare("SELECT type, COUNT(*) as cnt, MIN(date) as min_d, MAX(date) as max_d FROM transactions GROUP BY type").all();
console.log("Txns summary:", txns);

const sampleSales = db.prepare("SELECT date, type FROM transactions WHERE type='sale' LIMIT 5").all();
console.log("Sample sales dates:", sampleSales);
