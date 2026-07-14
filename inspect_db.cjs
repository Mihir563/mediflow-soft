const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'src-tauri', 'mediflow.db');
process.stdout.write('Opening: ' + dbPath + '\n');

try {
  const db = new Database(dbPath, { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  process.stdout.write('Tables found: ' + tables.length + '\n');
  for (const t of tables) {
    try {
      const count = db.prepare('SELECT COUNT(*) as c FROM [' + t.name + ']').get();
      const sample = db.prepare('SELECT * FROM [' + t.name + '] LIMIT 1').get();
      const cols = sample ? Object.keys(sample).join(', ') : '(empty)';
      process.stdout.write(t.name + ': ' + count.c + ' rows | cols: ' + cols + '\n');
    } catch(e2) {
      process.stdout.write(t.name + ': ERROR: ' + e2.message + '\n');
    }
  }
  db.close();
} catch(e) {
  process.stdout.write('DB ERROR: ' + e.message + '\n');
}
