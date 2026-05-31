import { useState, useEffect } from 'react';
import { getDB } from '@/lib/db';
import { FileText, Search, Package2, Edit3, Calendar, CalendarCheck } from 'lucide-react';

interface PurchaseHistoryProps {
  onEditPurchase?: (txnId: number) => void;
}

export default function PurchaseHistory({ onEditPurchase }: PurchaseHistoryProps) {
  const [purchases, setPurchases] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedTxn, setSelectedTxn] = useState<any | null>(null);
  const [txnItems, setTxnItems] = useState<any[]>([]);
  const [filterDate, setFilterDate] = useState('');
  const [filterType, setFilterType] = useState<'bill_date' | 'added_date'>('bill_date');

  useEffect(() => {
    loadPurchases();
  }, []);

  const loadPurchases = async () => {
    try {
      const db = await getDB();
      const res = await db.select<any[]>(
        `SELECT t.id, t.invoice_no, t.challan_no, t.date, t.created_at, t.total_amount, t.paid_amount, t.balance_due, t.payment_type, t.status, p.name as party_name 
         FROM transactions t 
         LEFT JOIN parties p ON t.party_id = p.id 
         WHERE t.type = 'purchase' 
         ORDER BY COALESCE(t.created_at, t.date) DESC`
      );
      setPurchases(res);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const viewDetails = async (txn: any) => {
    setSelectedTxn(txn);
    try {
      const db = await getDB();
      const items = await db.select<any[]>(
        `SELECT * FROM transaction_items WHERE txn_id = $1`,
        [txn.id]
      );
      setTxnItems(items);
    } catch (e) {
      console.error(e);
    }
  };

  const filtered = purchases.filter(p => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      String(p.invoice_no).toLowerCase().includes(q) ||
      String(p.party_name || '').toLowerCase().includes(q) ||
      String(p.date).toLowerCase().includes(q);

    if (!matchesSearch) return false;

    if (filterDate) {
      const dateToFilter = filterType === 'bill_date'
        ? (p.date || '').split('T')[0]
        : (p.created_at || p.date || '').split('T')[0];
      return dateToFilter === filterDate;
    }
    return true;
  });

  const statusColor = (status: string) => {
    if (status === 'paid') return 'bg-green-100 text-green-700';
    if (status === 'partial') return 'bg-amber-100 text-amber-700';
    return 'bg-red-100 text-red-600';
  };

  const fmtDate = (d: string) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }); }
    catch { return d; }
  };

  return (
    <div className="flex h-full bg-slate-50 gap-4 p-4">
      {/* List */}
      <div className={`flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-300 ${selectedTxn ? 'w-1/2' : 'w-full'}`}>
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between sticky top-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Purchase History</h2>
            <p className="text-xs text-slate-500 mt-0.5">View all vendor purchase bills and receipts</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Date filter */}
            <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden shadow-sm">
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value as any)}
                className="h-9 pl-2 pr-1 text-xs border-0 bg-slate-50 text-slate-600 font-semibold focus:outline-none"
              >
                <option value="bill_date">Bill Date</option>
                <option value="added_date">Added Date</option>
              </select>
              <input
                type="date"
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
                className="h-9 px-2 border-0 border-l border-slate-200 text-xs text-slate-700 focus:outline-none bg-white"
              />
              {filterDate && (
                <button
                  onClick={() => setFilterDate('')}
                  className="h-9 px-2 text-slate-400 hover:text-slate-600 text-xs bg-white border-l border-slate-200"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search bills, vendors..."
                className="pl-9 pr-4 h-9 w-56 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm"
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-400">Loading records...</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              <FileText size={32} className="mx-auto mb-2 opacity-20" />
              No purchase records found{filterDate ? ` for ${filterDate}` : ''}.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filtered.map(row => (
                <button
                  key={row.id}
                  onClick={() => viewDetails(row)}
                  className={`flex flex-col w-full text-left p-3 rounded-lg transition-all border ${
                    selectedTxn?.id === row.id
                      ? 'bg-blue-50 border-blue-200 shadow-sm ring-1 ring-blue-500'
                      : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-700 font-mono text-sm">{row.invoice_no || 'N/A'}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${statusColor(row.status)}`}>
                        {row.status}
                      </span>
                      <span className="font-bold text-slate-800">₹{row.total_amount?.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 truncate">{row.party_name || 'Cash Purchase'}</span>
                    <div className="flex items-center gap-3 text-slate-400 font-mono shrink-0">
                      <span className="flex items-center gap-1" title="Bill Date">
                        <Calendar size={10} />
                        {fmtDate(row.date)}
                      </span>
                      {row.created_at && row.created_at.split('T')[0] !== (row.date || '').split('T')[0] && (
                        <span className="flex items-center gap-1 text-slate-300" title="Date Added to System">
                          <CalendarCheck size={10} />
                          {fmtDate(row.created_at)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail View */}
      {selectedTxn && (
        <div className="w-1/2 flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-right-8 duration-200">
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50 flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Purchase Details</p>
              <h3 className="text-xl font-bold text-slate-800 font-mono">{selectedTxn.invoice_no}</h3>
              <p className="text-sm text-slate-600 font-medium mt-1">{selectedTxn.party_name || 'Cash Purchase'}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex flex-col items-end gap-1">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 text-slate-600 text-xs font-bold font-mono" title="Bill Date">
                  <Calendar size={10} />
                  {fmtDate(selectedTxn.date)}
                </span>
                {selectedTxn.created_at && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 text-[10px] font-bold font-mono" title="Date Added to System">
                    <CalendarCheck size={9} />
                    Added: {fmtDate(selectedTxn.created_at)}
                  </span>
                )}
              </div>
              {onEditPurchase && (
                <button
                  onClick={() => onEditPurchase(selectedTxn.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-bold hover:bg-brand-hover transition-colors shadow-sm"
                  title="Edit this purchase bill"
                >
                  <Edit3 size={12} />
                  Edit Bill
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-700 border-b border-slate-200 pb-2 mb-4">
              <Package2 size={16} className="text-brand" />
              Items Purchased
            </div>

            <div className="space-y-3">
              {txnItems.length === 0 ? (
                <p className="text-sm text-slate-400">No item details available.</p>
              ) : (
                txnItems.map(item => (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                    <div>
                      <p className="font-bold text-slate-700 text-sm">{item.item_name}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 font-mono">
                        <span>Qty: {item.quantity}</span>
                        <span>Price: ₹{item.price?.toFixed(2)}</span>
                        {item.batch_no && <span className="text-slate-400">• Batch: {item.batch_no}</span>}
                        {item.expiry_date && <span className="text-slate-400">• Exp: {item.expiry_date}</span>}
                        {item.discount_pct > 0 && <span className="text-orange-500">• Disc: {item.discount_pct}%</span>}
                        {item.tax_pct > 0 && <span className="text-blue-500">• GST: {item.tax_pct}%</span>}
                      </div>
                    </div>
                    <div className="text-right font-bold text-slate-800 font-mono">
                      ₹{item.amount?.toFixed(2)}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-8 border-t border-slate-200 pt-4 space-y-2">
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>Total Amount</span>
                <span className="font-bold font-mono">₹{selectedTxn.total_amount?.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>Paid</span>
                <span className="font-mono text-green-600">₹{selectedTxn.paid_amount?.toFixed(2)}</span>
              </div>
              {selectedTxn.balance_due > 0 && (
                <div className="flex items-center justify-between text-sm font-bold text-red-500">
                  <span>Balance Pending</span>
                  <span className="font-mono">₹{selectedTxn.balance_due?.toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm text-slate-500 pt-2">
                <span>Payment Type</span>
                <span className="capitalize font-medium text-slate-700">{selectedTxn.payment_type}</span>
              </div>
              {selectedTxn.challan_no && (
                <div className="flex items-center justify-between text-sm text-slate-500">
                  <span>Challan No</span>
                  <span className="font-mono text-slate-700">{selectedTxn.challan_no}</span>
                </div>
              )}
            </div>

            {onEditPurchase && (
              <button
                onClick={() => onEditPurchase(selectedTxn.id)}
                className="mt-6 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white font-bold text-sm hover:bg-brand-hover transition-colors shadow-md"
              >
                <Edit3 size={15} />
                Edit This Purchase Bill
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
