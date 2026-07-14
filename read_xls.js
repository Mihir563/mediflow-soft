const xlsx = require('xlsx');
const fs = require('fs');

const p1 = 'd:/Billing Software/mediflow/data/PurchaseReport_01_03_19_to_31_03_26, purchase history.xlsx';
const p2 = 'd:/Billing Software/mediflow/data/AllTransactionsReport_01_03_19_to_31_03_26, data for the details of all medicals.xlsx';

function inspect(file) {
  console.log('--- Inspecting', file.split('/').pop(), '---');
  const wb = xlsx.readFile(file);
  const s = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1, defval:null});
  const first20 = s.slice(0, 20);
  
  // Custom print to see structure clearly
  first20.forEach((row, i) => {
    // only print non-null cells
    const data = row.map((c, j) => c ? `[Col${j}:${c}]` : null).filter(Boolean);
    console.log(`Row ${i}:`, data.join(' | '));
  });
}

inspect(p1);
inspect(p2);
