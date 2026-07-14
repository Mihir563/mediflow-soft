const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const dir = 'd:/Billing Software/mediflow/data';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx'));

files.forEach(f => {
  const wb = xlsx.readFile(path.join(dir, f));
  console.log(`\n--- ${f} ---`);
  console.log('Sheets:', wb.SheetNames);
  wb.SheetNames.forEach(sheetName => {
    const s = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], {header:1, defval:null});
    if (s.length > 5) {
       console.log(`  Sheet [${sheetName}] Head:`, s[3] ? s[3].filter(Boolean) : s[2].filter(Boolean));
    }
  });
});
