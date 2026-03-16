const XLSX = require('xlsx');

function readHeaders(file) {
  console.log('Reading:', file);
  const workbook = XLSX.readFile(file);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // Convert sheet to JSON array
  let data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  // Find the header row (assume first non-empty row)
  for (let i = 0; i < 5; i++) {
    if (data[i] && data[i].length > 0) {
      console.log(`Row ${i} (potential header):`, data[i]);
    }
  }
  console.log('---');
}

readHeaders('d:\\Billing Software\\mediflow\\data\\Export Items (1).xlsx');
readHeaders('d:\\Billing Software\\mediflow\\data\\PartyReport , data of parties.xlsx');
