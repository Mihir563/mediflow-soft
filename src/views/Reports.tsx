'use client';
import { useState, useEffect } from 'react';
import { getDB } from '@/lib/db';
import { Download, Search } from 'lucide-react';
import SmartDateInput from '@/components/SmartDateInput';
import BillDetailModal from '@/components/BillDetailModal';

type ReportType = 'sale' | 'purchase' | 'stock' | 'ledger';

interface ReportsProps {
  initialSearch?: string;
  onEditPurchase?: (txnId: number) => void;
  onEditSale?: (txnId: number) => void;
}

export default function Reports({ initialSearch = '', onEditPurchase, onEditSale }: ReportsProps) {
  const [reportType, setReportType] = useState<ReportType>('sale');
  const [filterType, setFilterType] = useState<'bill_date' | 'added_date'>('bill_date');
  const [from, setFrom] = useState('2019-01-01'); // Defaulting earlier so migrated data is visible
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState<any[]>([]);
  const [search, setSearch] = useState(initialSearch);
  const [loading, setLoading] = useState(false);
  const [selectedTxnId, setSelectedTxnId] = useState<number | null>(null);

  useEffect(() => {
    if (initialSearch) setSearch(initialSearch);
  }, [initialSearch]);

  useEffect(() => { loadReport(); }, [reportType, from, to, filterType]);

  const loadReport = async () => {
    setLoading(true);
    try {
      const db = await getDB();
      let res: any[] = [];
      const dateCol = filterType === 'bill_date' ? 't.date' : 'COALESCE(t.created_at, t.date)';
      if (reportType === 'sale') {
        res = await db.select<any[]>(`SELECT t.id, t.invoice_no, t.challan_no, t.date, t.created_at, t.total_amount, t.paid_amount, t.balance_due, t.payment_type, t.status, p.name as party_name, p.phone, p.gstin FROM transactions t LEFT JOIN parties p ON t.party_id=p.id WHERE t.type='sale' AND ${dateCol}>=$1 AND ${dateCol}<=$2 ORDER BY ${dateCol} DESC`, [from, to + 'T23:59:59']);
      } else if (reportType === 'purchase') {
        res = await db.select<any[]>(`SELECT t.id, t.invoice_no, t.challan_no, t.date, t.created_at, t.total_amount, t.paid_amount, t.balance_due, t.payment_type, t.status, p.name as party_name, p.phone, p.gstin FROM transactions t LEFT JOIN parties p ON t.party_id=p.id WHERE t.type='purchase' AND ${dateCol}>=$1 AND ${dateCol}<=$2 ORDER BY ${dateCol} DESC`, [from, to + 'T23:59:59']);
      } else if (reportType === 'stock') {
        res = await db.select<any[]>(`SELECT id, name, hsn as item_code, category, unit, hsn, purchase_price, sale_price, opening_stock, current_stock, COALESCE((SELECT SUM(quantity) FROM transaction_items ti JOIN transactions t ON t.id=ti.txn_id WHERE ti.item_id=items.id AND t.type='sale'), 0) as sold_qty FROM items ORDER BY sold_qty DESC, name`);
      } else if (reportType === 'ledger') {
        res = await db.select<any[]>(`SELECT p.name, p.phone, p.gstin, p.type, p.opening_balance, COALESCE(SUM(CASE WHEN t.type='sale' THEN t.total_amount ELSE 0 END),0) as sales_total, COALESCE(SUM(CASE WHEN t.type='purchase' THEN t.total_amount ELSE 0 END),0) as purchase_total FROM parties p LEFT JOIN transactions t ON t.party_id=p.id GROUP BY p.id ORDER BY p.name`);
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

  const isBillReport = reportType === 'sale' || reportType === 'purchase';

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-slate-200 shadow-sm z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2 bg-slate-100 p-1 rounded-lg">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setReportType(t.key)}
                className={`px-5 py-2 rounded-md text-sm font-semibold transition-colors ${reportType === t.key ? 'bg-white text-brand shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
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
            <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden shadow-sm h-8 bg-slate-50">
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value as any)}
                className="h-full pl-2 pr-1 text-xs border-0 bg-transparent text-slate-600 font-semibold focus:outline-none"
              >
                <option value="bill_date">Bill Date</option>
                <option value="added_date">Added Date</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">From</label>
              <div className="w-36">
                <SmartDateInput
                  value={from}
                  onChange={setFrom}
                  className="!h-8 !px-3"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">To</label>
              <div className="w-36">
                <SmartDateInput
                  value={to}
                  onChange={setTo}
                  className="!h-8 !px-3"
                />
              </div>
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
        {(reportType === 'stock' || reportType === 'ledger') && (
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter results..."
                className="pl-8 pr-4 h-8 w-52 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <span className="text-xs text-slate-400 ml-2">{filtered.length} records</span>
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
                <tr className="text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                  <th className="pl-6 py-3 text-left w-24">Date</th>
                  <th className="px-2 py-3 text-left w-28">Invoice No.</th>
                  <th className="px-2 py-3 text-left">Party Name</th>
                  <th className="px-2 py-3 text-left w-24">Type</th>
                  <th className="px-2 py-3 text-left w-24">Status</th>
                  <th className="px-2 py-3 text-right w-24">Total Amount</th>
                  <th className="px-2 py-3 text-right w-24">Received</th>
                  <th className="px-2 py-3 text-right w-24">Balance Due</th>
                  <th className="px-2 py-3 text-center w-20">Action</th>
                </tr>
              )}
              {reportType === 'purchase' && (
                <tr className="text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                  <th className="pl-6 py-3 text-left w-24">Date</th>
                  <th className="px-2 py-3 text-left w-28">Bill No.</th>
                  <th className="px-2 py-3 text-left">Vendor Name</th>
                  <th className="px-2 py-3 text-left w-24">Type</th>
                  <th className="px-2 py-3 text-left w-24">Status</th>
                  <th className="px-2 py-3 text-right w-24">Total Amount</th>
                  <th className="px-2 py-3 text-right w-24">Paid</th>
                  <th className="px-2 py-3 text-right w-24">Balance Due</th>
                  <th className="px-2 py-3 text-center w-20">Action</th>
                </tr>
              )}
              {reportType === 'stock' && (
                <tr className="text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                  <th className="pl-6 py-3 text-left">Item Name</th>
                  <th className="px-2 py-3 text-left w-24">Item Code</th>
                  <th className="px-2 py-3 text-left w-24">Category</th>
                  <th className="px-2 py-3 text-left w-16">Unit</th>
                  <th className="px-2 py-3 text-right w-20">Opening</th>
                  <th className="px-2 py-3 text-right w-20 font-bold text-brand">Sold Qty</th>
                  <th className="px-2 py-3 text-right w-20">Current</th>
                  <th className="px-2 py-3 text-right w-24">Purchase ₹</th>
                  <th className="px-2 py-3 text-right w-24">Sale ₹</th>
                  <th className="px-2 py-3 text-right w-28">Stock Value</th>
                </tr>
              )}
              {reportType === 'ledger' && (
                <tr className="text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                  <th className="pl-6 py-3 text-left">Party Name</th>
                  <th className="px-2 py-3 text-left w-24">Type</th>
                  <th className="px-2 py-3 text-right w-28">Op. Balance</th>
                  <th className="px-2 py-3 text-right w-28">Total Sales</th>
                  <th className="px-2 py-3 text-right w-28">Total Purchase</th>
                  <th className="px-2 py-3 text-right w-28 font-bold">Net Balance</th>
                </tr>
              )}
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr
                  key={i}
                  className={`border-b border-slate-100 transition-colors ${isBillReport ? 'hover:bg-blue-50/60 cursor-pointer group' : 'hover:bg-white'}`}
                  onClick={isBillReport ? () => setSelectedTxnId(row.id) : undefined}
                >
                  {(reportType === 'sale' || reportType === 'purchase') && (
                    <>
                      <td className="pl-6 py-3 whitespace-nowrap">
                        <p className="text-slate-700 text-sm font-medium">{row.date ? new Date(row.date).toLocaleDateString('en-GB') : '—'}</p>
                        {row.created_at && new Date(row.created_at).toLocaleDateString('en-GB') !== (row.date ? new Date(row.date).toLocaleDateString('en-GB') : '') && (
                          <p className="text-[10px] text-slate-400 font-mono" title="Date Added to System">
                            Added: {new Date(row.created_at).toLocaleDateString('en-GB')}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-3 font-mono text-xs text-brand group-hover:underline font-semibold">{row.invoice_no || `#${row.id}`}</td>
                      <td className="px-2 py-3">
                        <p className="font-semibold text-slate-800">{row.party_name || 'Walk-in'}</p>
                        {row.phone && <p className="text-[10px] text-slate-400 font-mono">{row.phone}</p>}
                      </td>
                      <td className="px-2 py-3"><span className="uppercase text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded">{row.payment_type || 'CASH'}</span></td>
                      <td className="px-2 py-3">
                        {row.status === 'paid' && <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-full">PAID</span>}
                        {row.status === 'partial' && <span className="text-xs font-semibold text-orange-600 bg-orange-50 px-2 py-1 rounded-full">PARTIAL</span>}
                        {row.status === 'unpaid' && <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-1 rounded-full">UNPAID</span>}
                        {!row.status && <span className="text-xs font-semibold text-slate-500">PAID</span>}
                      </td>
                      <td className="px-2 py-3 text-right font-semibold font-mono text-slate-800">₹{row.total_amount?.toFixed(2)}</td>
                      <td className="px-2 py-3 text-right font-mono text-green-600">₹{(row.paid_amount ?? row.total_amount)?.toFixed(2)}</td>
                      <td className="px-2 py-3 text-right font-mono text-orange-600 font-medium">₹{(row.balance_due ?? 0).toFixed(2)}</td>
                      <td className="px-2 py-3 text-center" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setSelectedTxnId(row.id)}
                          className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-brand/10 text-brand hover:bg-brand hover:text-white transition-colors"
                        >
                          View
                        </button>
                      </td>
                    </>
                  )}
                  {reportType === 'stock' && (
                    <>
                      <td className="pl-6 py-3 font-medium text-slate-800">{row.name}</td>
                      <td className="px-2 py-3 text-xs font-mono text-slate-500">{row.item_code || '—'}</td>
                      <td className="px-2 py-3"><span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{row.category || '—'}</span></td>
                      <td className="px-2 py-3 text-slate-500 text-xs">{row.unit || '—'}</td>
                      <td className="px-2 py-3 text-right text-slate-500 font-mono">{row.opening_stock}</td>
                      <td className="px-2 py-3 text-right font-bold font-mono text-brand">{row.sold_qty}</td>
                      <td className="px-2 py-3 text-right">
                        <span className={`font-bold font-mono text-sm ${row.current_stock <= 0 ? 'text-red-600' : row.current_stock < 10 ? 'text-orange-500' : 'text-green-600'}`}>{row.current_stock}</span>
                      </td>
                      <td className="px-2 py-3 text-right font-mono text-slate-500">₹{row.purchase_price}</td>
                      <td className="px-2 py-3 text-right font-mono text-slate-700">₹{row.sale_price}</td>
                      <td className="px-2 py-3 text-right font-semibold font-mono text-slate-800">₹{(row.purchase_price * row.current_stock).toFixed(0)}</td>
                    </>
                  )}
                  {reportType === 'ledger' && (
                    <>
                      <td className="pl-6 py-3 font-medium text-slate-800">{row.name}</td>
                      <td className="px-2 py-3"><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${row.type === 'customer' ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}`}>{row.type}</span></td>
                      <td className="px-2 py-3 text-right font-mono text-slate-600">₹{row.opening_balance?.toFixed(2)}</td>
                      <td className="px-2 py-3 text-right font-mono text-green-600">₹{row.sales_total?.toFixed(2)}</td>
                      <td className="px-2 py-3 text-right font-mono text-orange-600">₹{row.purchase_total?.toFixed(2)}</td>
                      <td className="px-2 py-3 text-right font-bold font-mono">
                        <span className={(row.type === 'customer' ? (row.sales_total - row.purchase_total + row.opening_balance) : (row.opening_balance + row.purchase_total - row.sales_total)) >= 0 ? 'text-green-600' : 'text-red-600'}>
                          ₹{Math.abs(row.type === 'customer' ? (row.sales_total - row.purchase_total + row.opening_balance) : (row.opening_balance + row.purchase_total - row.sales_total)).toFixed(2)}
                          <span className="text-[10px] ml-1 text-slate-400 font-normal">
                             {(row.type === 'customer' ? (row.sales_total - row.purchase_total + row.opening_balance) : (row.opening_balance + row.purchase_total - row.sales_total)) >= 0 ? 'DR' : 'CR'}
                          </span>
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="py-16 text-center text-slate-400 text-sm">No data found for this period</td></tr>
              )}
            </tbody>
            {filtered.length > 0 && isBillReport && (
              <tfoot className="bg-slate-100 border-t-2 border-slate-200 sticky bottom-0">
                <tr className="font-bold text-slate-700">
                  <td colSpan={5} className="pl-6 py-2.5 text-sm">Total ({filtered.length} records)</td>
                  <td className="px-2 py-2.5 text-right font-mono text-base">₹{totals.amount.toFixed(2)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {/* Bill Detail Modal */}
      {selectedTxnId !== null && (
        <BillDetailModal
          txnId={selectedTxnId}
          onClose={() => setSelectedTxnId(null)}
          onEditPurchase={onEditPurchase ? (id) => { setSelectedTxnId(null); onEditPurchase(id); } : undefined}
          onEditSale={onEditSale ? (id) => { setSelectedTxnId(null); onEditSale(id); } : undefined}
        />
      )}
    </div>
  );
}
