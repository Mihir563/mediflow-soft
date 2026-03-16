const fs = require('fs');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'com.tauri.dev', 'mediflow.db');
if (fs.existsSync(dbPath)) {
  console.log('DB Size:', fs.statSync(dbPath).size, 'bytes');
  // Copy to local dir to inspect
  fs.copyFileSync(dbPath, 'test.db');
  console.log('Copied to test.db');
} else {
  console.log('DB not found at:', dbPath);
}
