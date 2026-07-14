const XLSX = require('xlsx');

// Check which file has item-level detail (batch, qty, unit price, discount, tax)
const files = [
  'd:\\Billing Software\\mediflow\\data\\AllTransactionsReport_01_03_19_to_31_03_26, data for the details of all medicals.xlsx',
  'd:\\Billing Software\\mediflow\\data\\StockDetailReport_01_03_19_to_14_03_26, stock details.xlsx',
];

for (const file of files) {
  const wb = XLSX.readFile(file);
  console.log('\n=== FILE:', file.split('\\').pop(), '===');
  console.log('Sheets:', wb.SheetNames);
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const json = XLSX.utils.sheet_to_json(sheet);
    if (json.length > 0) {
      console.log(`Sheet "${name}" - rows: ${json.length}`);
      console.log('Columns:', Object.keys(json[0]).join(' | '));
      console.log('Row 1:', JSON.stringify(json[0]).slice(0, 300));
      console.log('Row 2:', JSON.stringify(json[1]).slice(0, 300));
    }
  }
}
