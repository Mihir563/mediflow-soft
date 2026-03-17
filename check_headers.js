const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'data');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx'));
for (const f of files) {
  try {
    const wb = xlsx.readFile(path.join(dir, f));
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = xlsx.utils.sheet_to_json(sheet, {header: 1, range: 0});
    // Find the first row that has actual data (often headers are pushed down)
    const headerRow = json.find(row => row && row.length > 5) || json[0];
    console.log(`\n--- ${f} ---`);
    console.log(headerRow);
  } catch (e) {
    console.log(`Failed ${f}: ${e.message}`);
  }
}
