'use client';
import { useState, useEffect } from 'react';
import { getDB } from '@/lib/db';
import { Download, Search } from 'lucide-react';

type ReportType = 'sale' | 'purchase' | 'stock' | 'ledger';

export default function Reports() {
  const [reportType, setReportType] = useState<ReportType>('sale');
  const [from, setFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadReport(); }, [reportType, from, to]);

  const loadReport = async () => {
    setLoading(true);
    try {
      const db = await getDB();
      let res: any[] = [];
      if (reportType === 'sale') {
        res = await db.select<any[]>(`SELECT t.id, t.invoice_no, t.date, t.total_amount, p.name as party_name FROM transactions t LEFT JOIN parties p ON t.party_id=p.id WHERE t.type='sale' AND t.date>=$1 AND t.date<=$2 ORDER BY t.date DESC`, [from, to + 'T23:59:59']);
      } else if (reportType === 'purchase') {
        res = await db.select<any[]>(`SELECT t.id, t.invoice_no, t.date, t.total_amount, p.name as party_name FROM transactions t LEFT JOIN parties p ON t.party_id=p.id WHERE t.type='purchase' AND t.date>=$1 AND t.date<=$2 ORDER BY t.date DESC`, [from, to + 'T23:59:59']);
      } else if (reportType === 'stock') {
        res = await db.select<any[]>(`SELECT id, name, category, unit, purchase_price, sale_price, opening_stock, current_stock FROM items ORDER BY name`);
      } else if (reportType === 'ledger') {
        res = await db.select<any[]>(`SELECT p.name, p.phone, p.type, p.opening_balance, COALESCE(SUM(CASE WHEN t.type='sale' THEN t.total_amount ELSE 0 END),0) as sales_total, COALESCE(SUM(CASE WHEN t.type='purchase' THEN t.total_amount ELSE 0 END),0) as purchase_total FROM parties p LEFT JOIN transactions t ON t.party_id=p.id GROUP BY p.id ORDER BY p.name`);
      }
      setData(res);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const filtered = data.filter(row => {
    const q = search.toLowerCase();
    return !q || Object.values(row).some(v => String(v).toLowerCase().includes(q));
  });

  const exportCSV = () => {
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const csv = [headers.join(','), ...data.map(row => headers.map(h => `"${row[h] ?? ''}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${reportType}_report.csv`; a.click();
  };

  const totals = {
    amount: filtered.reduce((s, r) => s + (r.total_amount || r.sale_price * r.current_stock || 0), 0),
    salesTotal: filtered.reduce((s, r) => s + (r.sales_total || 0), 0),
    purchaseTotal: filtered.reduce((s, r) => s + (r.purchase_total || 0), 0),
  };

  const tabs: { key: ReportType; label: string }[] = [
    { key: 'sale', label: '📈 Sale Report' },
    { key: 'purchase', label: '📦 Purchase Report' },
    { key: 'stock', label: '🗄️ Stock Summary' },
    { key: 'ledger', label: '👥 Party Ledger' },
  ];

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="px-6 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-1">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setReportType(t.key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${reportType === t.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={exportCSV} className="flex items-center gap-2 h-9 px-4 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
            <Download size={14} /> Export CSV
          </button>
        </div>
        {reportType !== 'stock' && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">From</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="h-8 border border-slate-200 rounded-lg text-sm px-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">To</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="h-8 border border-slate-200 rounded-lg text-sm px-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="relative ml-4">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter results..."
                className="pl-8 pr-4 h-8 w-52 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="ml-auto flex items-center gap-4 text-sm">
              <span className="text-slate-400">{filtered.length} records</span>
              <span className="font-bold text-slate-800">Total: ₹{totals.amount.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Report Table */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-400">Loading...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-100 sticky top-0 z-10">
              {reportType === 'sale' && (
                <tr className="text-slate-500 text-xs uppercase tracking-wide">
                  <th className="pl-6 py-3 text-left w-28">Invoice No.</th>
                  <th className="px-2 py-3 text-left">Party / Customer</th>
                  <th className="px-2 py-3 text-left w-28">Date</th>
                  <th className="px-2 py-3 text-right w-28">Amount</th>
                </tr>
              )}
              {reportType === 'purchase' && (
                <tr className="text-slate-500 text-xs uppercase tracking-wide">
                  <th className="pl-6 py-3 text-left w-28">Bill No.</th>
                  <th className="px-2 py-3 text-left">Vendor / Supplier</th>
                  <th className="px-2 py-3 text-left w-28">Date</th>
                  <th className="px-2 py-3 text-right w-28">Amount</th>
                </tr>
              )}
              {reportType === 'stock' && (
                <tr className="text-slate-500 text-xs uppercase tracking-wide">
                  <th className="pl-6 py-3 text-left">Item Name</th>
                  <th className="px-2 py-3 text-left w-28">Category</th>
                  <th className="px-2 py-3 text-left w-16">Unit</th>
                  <th className="px-2 py-3 text-right w-24">Opening</th>
                  <th className="px-2 py-3 text-right w-20">Current</th>
                  <th className="px-2 py-3 text-right w-24">Purchase ₹</th>
                  <th className="px-2 py-3 text-right w-24">Sale ₹</th>
                  <th className="px-2 py-3 text-right w-28">Stock Value</th>
                </tr>
              )}
              {reportType === 'ledger' && (
                <tr className="text-slate-500 text-xs uppercase tracking-wide">
                  <th className="pl-6 py-3 text-left">Party Name</th>
                  <th className="px-2 py-3 text-left w-24">Type</th>
                  <th className="px-2 py-3 text-right w-28">Op. Balance</th>
                  <th className="px-2 py-3 text-right w-28">Total Sales</th>
                  <th className="px-2 py-3 text-right w-28">Total Purchase</th>
                  <th className="px-2 py-3 text-right w-28">Net Balance</th>
                </tr>
              )}
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-white transition-colors">
                  {(reportType === 'sale' || reportType === 'purchase') && (
                    <>
                      <td className="pl-6 py-2.5 font-mono text-xs text-slate-600">{row.invoice_no || `#${row.id}`}</td>
                      <td className="px-2 py-2.5 font-medium text-slate-800">{row.party_name || 'Walk-in Customer'}</td>
                      <td className="px-2 py-2.5 text-slate-500 text-xs">{row.date?.split('T')[0]}</td>
                      <td className="px-2 py-2.5 text-right font-semibold font-mono text-slate-800">₹{row.total_amount?.toFixed(2)}</td>
                    </>
                  )}
                  {reportType === 'stock' && (
                    <>
                      <td className="pl-6 py-2.5 font-medium text-slate-800">{row.name}</td>
                      <td className="px-2 py-2.5"><span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{row.category || '—'}</span></td>
                      <td className="px-2 py-2.5 text-slate-500 text-xs">{row.unit || '—'}</td>
                      <td className="px-2 py-2.5 text-right text-slate-500">{row.opening_stock}</td>
                      <td className="px-2 py-2.5 text-right">
                        <span className={`font-bold text-sm ${row.current_stock <= 0 ? 'text-red-600' : row.current_stock < 10 ? 'text-yellow-600' : 'text-green-600'}`}>{row.current_stock}</span>
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono text-slate-500">₹{row.purchase_price}</td>
                      <td className="px-2 py-2.5 text-right font-mono text-slate-700">₹{row.sale_price}</td>
                      <td className="px-2 py-2.5 text-right font-semibold font-mono text-slate-800">₹{(row.purchase_price * row.current_stock).toFixed(0)}</td>
                    </>
                  )}
                  {reportType === 'ledger' && (
                    <>
                      <td className="pl-6 py-2.5 font-medium text-slate-800">{row.name}</td>
                      <td className="px-2 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full ${row.type === 'customer' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{row.type}</span></td>
                      <td className="px-2 py-2.5 text-right font-mono text-slate-600">₹{row.opening_balance?.toFixed(2)}</td>
                      <td className="px-2 py-2.5 text-right font-mono text-green-600">₹{row.sales_total?.toFixed(2)}</td>
                      <td className="px-2 py-2.5 text-right font-mono text-orange-600">₹{row.purchase_total?.toFixed(2)}</td>
                      <td className="px-2 py-2.5 text-right font-bold font-mono">
                        <span className={row.sales_total - row.purchase_total >= 0 ? 'text-green-600' : 'text-red-600'}>
                          ₹{(row.sales_total - row.purchase_total + row.opening_balance).toFixed(2)}
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="py-16 text-center text-slate-400 text-sm">No data found for this period</td></tr>
              )}
            </tbody>
            {filtered.length > 0 && (reportType === 'sale' || reportType === 'purchase') && (
              <tfoot className="bg-slate-100 border-t-2 border-slate-200 sticky bottom-0">
                <tr className="font-bold text-slate-700">
                  <td colSpan={3} className="pl-6 py-2.5 text-sm">Total ({filtered.length} records)</td>
                  <td className="px-2 py-2.5 text-right font-mono text-base">₹{totals.amount.toFixed(2)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  );
}
