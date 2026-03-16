const XLSX = require('xlsx');
const file = 'd:\\Billing Software\\mediflow\\data\\AllTransactionsReport_01_03_19_to_31_03_26, data for the details of all medicals.xlsx';
const wb = XLSX.readFile(file);
const sheet = wb.Sheets[wb.SheetNames[0]];
const json = XLSX.utils.sheet_to_json(sheet);
console.log('Total rows:', json.length);
console.log('Columns:', Object.keys(json[0]).join(' | '));
console.log('Sample row 1:', JSON.stringify(json[0]));
console.log('Sample row 2:', JSON.stringify(json[1]));
