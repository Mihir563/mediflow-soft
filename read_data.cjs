const XLSX = require('xlsx');

function testExtract() {
  const file = 'd:\\Billing Software\\mediflow\\data\\Export Items (1).xlsx';
  const workbook = XLSX.readFile(file);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(sheet);
  
  console.log(`Extracted ${json.length} rows`);
  
  let validItems = 0;
  for (const row of json) {
    const name = row['Item name*'] || row['Item Name'] || row['Name'];
    if (!name) continue;
    validItems++;
  }
  
  console.log(`Valid items found: ${validItems}`);
}

testExtract();
