const xlsx = require('xlsx');
const p = 'd:/Billing Software/mediflow/data/PurchaseReport_01_03_19_to_31_03_26, purchase history.xlsx';
const wb = xlsx.readFile(p);
const s = xlsx.utils.sheet_to_json(wb.Sheets['Item Details'], {header:1, defval:null});
const limit = s.slice(0, 10);
limit.forEach(r => console.log(r.filter(Boolean).join(' | ')));
