'use client';
import { useState, useEffect } from 'react';
import { getDB } from '@/lib/db';
import { Search, Plus, Phone, MapPin, CreditCard, ArrowUpRight, ArrowDownRight, ChevronDown, ChevronRight } from 'lucide-react';

export default function Parties() {
  const [parties, setParties] = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'customer' | 'vendor'>('all');
  const [selected, setSelected] = useState<any>(null);
  const [txns, setTxns] = useState<any[]>([]);
  const [expandedTxn, setExpandedTxn] = useState<number | null>(null);
  const [txnItems, setTxnItems] = useState<Record<number, any[]>>({});
  const [stats, setStats] = useState({ totalSale: 0, totalPurchase: 0, lastDate: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', gstin: '', address: '', type: 'customer', opening_balance: 0 });
  const [status, setStatus] = useState('');

  useEffect(() => { loadParties(); }, []);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(parties.filter(p =>
      (filter === 'all' || p.type === filter) &&
      (p.name?.toLowerCase().includes(q) || p.phone?.includes(q))
    ));
  }, [parties, search, filter]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'n') { e.preventDefault(); setShowAdd(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const loadParties = async () => {
    const db = await getDB();
    const res = await db.select<any[]>(`
      SELECT p.*,
        (SELECT COUNT(*) FROM transactions t WHERE t.party_id=p.id) as txn_count,
        (SELECT MAX(date) FROM transactions t WHERE t.party_id=p.id) as last_txn
      FROM parties p ORDER BY p.name
    `);
    setParties(res);
  };

  const selectParty = async (p: any) => {
    setSelected(p);
    setExpandedTxn(null);
    setTxnItems({});
    const db = await getDB();
    const res = await db.select<any[]>(`
      SELECT t.*,
        (SELECT COUNT(*) FROM transaction_items ti WHERE ti.txn_id=t.id) as item_count
      FROM transactions t WHERE t.party_id=$1 ORDER BY t.date DESC, t.id DESC LIMIT 50
    `, [p.id]);
    setTxns(res);
    const statsRes = await db.select<any[]>(`
      SELECT
        COALESCE(SUM(CASE WHEN type='sale' THEN total_amount ELSE 0 END),0) as total_sale,
        COALESCE(SUM(CASE WHEN type='purchase' THEN total_amount ELSE 0 END),0) as total_purchase,
        MAX(date) as last_date
      FROM transactions WHERE party_id=$1
    `, [p.id]);
    if (statsRes[0]) {
      setStats({ totalSale: statsRes[0].total_sale, totalPurchase: statsRes[0].total_purchase, lastDate: statsRes[0].last_date || '' });
    }
  };

  const toggleTxn = async (txnId: number) => {
    if (expandedTxn === txnId) { setExpandedTxn(null); return; }
    setExpandedTxn(txnId);
    if (!txnItems[txnId]) {
      const db = await getDB();
      const items = await db.select<any[]>(`
        SELECT ti.*, COALESCE(ti.item_name, i.name, 'Unknown') as display_name
        FROM transaction_items ti
        LEFT JOIN items i ON i.id=ti.item_id
        WHERE ti.txn_id=$1
      `, [txnId]);
      setTxnItems(prev => ({ ...prev, [txnId]: items }));
    }
  };

  const saveParty = async () => {
    if (!form.name.trim()) return;
    try {
      const db = await getDB();
      await db.execute(`INSERT INTO parties (name, phone, gstin, address, type, opening_balance) VALUES ($1,$2,$3,$4,$5,$6)`,
        [form.name, form.phone, form.gstin, form.address, form.type, form.opening_balance]);
      setStatus('✅ Party added!'); setShowAdd(false);
      setForm({ name: '', phone: '', gstin: '', address: '', type: 'customer', opening_balance: 0 });
      loadParties();
      setTimeout(() => setStatus(''), 2000);
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
  };

  const netBalance = stats.totalSale - stats.totalPurchase + (selected?.opening_balance || 0);

  return (
    <div className="h-full flex bg-slate-50">
      {/* Left: Party list */}
      <div className="w-80 flex-shrink-0 flex flex-col bg-white border-r border-slate-200">
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-slate-800">Parties</h2>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium">
              <Plus size={12} /> Add <kbd className="ml-1 opacity-70">Ctrl+N</kbd>
            </button>
          </div>
          <div className="relative mb-2">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search party..."
              className="w-full pl-8 pr-3 h-8 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" autoFocus />
          </div>
          <div className="flex gap-1">
            {(['all', 'customer', 'vendor'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`flex-1 py-1 text-xs rounded-lg font-medium capitalize transition-colors ${filter === f ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map(p => (
            <button key={p.id} onClick={() => selectParty(p)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-blue-50 transition-colors ${selected?.id === p.id ? 'bg-blue-50 border-l-2 border-l-blue-600' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-slate-800 truncate">{p.name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {p.phone && <span className="text-xs text-slate-400">📞 {p.phone}</span>}
                    {p.txn_count > 0 && <span className="text-xs text-slate-400">{p.txn_count} txns</span>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${p.type === 'customer' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                    {p.type}
                  </span>
                  {p.opening_balance !== 0 && (
                    <p className={`text-xs font-mono mt-1 ${p.opening_balance > 0 ? 'text-green-600' : 'text-red-500'}`}>
                      ₹{Math.abs(p.opening_balance).toFixed(0)}
                    </p>
                  )}
                </div>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="py-12 text-center text-slate-400 text-sm">No parties found</div>
          )}
        </div>
      </div>

      {/* Right: Party detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <div className="max-w-3xl space-y-5">
            {/* Party Header */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">{selected.name}</h2>
                  <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-500">
                    {selected.phone && <span className="flex items-center gap-1"><Phone size={13} /> {selected.phone}</span>}
                    {selected.address && <span className="flex items-center gap-1"><MapPin size={13} /> {selected.address}</span>}
                    {selected.gstin && <span className="flex items-center gap-1"><CreditCard size={13} /> GSTIN: {selected.gstin}</span>}
                  </div>
                  <div className="flex gap-6 mt-3 text-sm">
                    <div><p className="text-xs text-slate-400">Total Sales</p><p className="font-bold text-green-600 font-mono">₹{stats.totalSale.toFixed(0)}</p></div>
                    <div><p className="text-xs text-slate-400">Total Purchases</p><p className="font-bold text-orange-600 font-mono">₹{stats.totalPurchase.toFixed(0)}</p></div>
                    <div><p className="text-xs text-slate-400">Opening Bal.</p><p className="font-bold text-slate-600 font-mono">₹{(selected.opening_balance||0).toFixed(0)}</p></div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">Net Balance</p>
                  <p className={`text-2xl font-bold ${netBalance >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    ₹{Math.abs(netBalance).toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-400">{netBalance >= 0 ? 'they owe you' : 'you owe them'}</p>
                  {stats.lastDate && <p className="text-xs text-slate-400 mt-1">Last: {stats.lastDate.split('T')[0]}</p>}
                </div>
              </div>
            </div>

            {/* Transactions */}
            <div className="bg-white rounded-xl border border-slate-200">
              <div className="px-5 py-3 border-b border-slate-200">
                <h3 className="font-semibold text-slate-700">Transaction History</h3>
              </div>
              {txns.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-sm">No transactions with this party yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-400 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="px-5 py-2.5 text-left w-8"></th>
                      <th className="px-2 py-2.5 text-left">Invoice</th>
                      <th className="px-2 py-2.5 text-left">Type</th>
                      <th className="px-2 py-2.5 text-left">Date</th>
                      <th className="px-2 py-2.5 text-left">Items</th>
                      <th className="px-2 py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txns.map((t, i) => (
                      <>
                        <tr key={t.id} onClick={() => toggleTxn(t.id)}
                          className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${expandedTxn === t.id ? 'bg-blue-50' : ''}`}>
                          <td className="px-5 py-2.5 text-slate-400">
                            {expandedTxn === t.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </td>
                          <td className="px-2 py-2.5 font-mono text-xs text-slate-600">{t.invoice_no || `#${t.id}`}</td>
                          <td className="px-2 py-2.5">
                            <span className={`flex items-center gap-1 w-fit text-xs px-2 py-0.5 rounded-full ${t.type === 'sale' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                              {t.type === 'sale' ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}{t.type}
                            </span>
                          </td>
                          <td className="px-2 py-2.5 text-slate-500 text-xs">{t.date?.split('T')[0]}</td>
                          <td className="px-2 py-2.5 text-xs text-slate-400">{t.item_count} items</td>
                          <td className="px-2 py-2.5 text-right font-semibold font-mono">₹{t.total_amount?.toFixed(2)}</td>
                        </tr>
                        {expandedTxn === t.id && txnItems[t.id] && (
                          <tr key={`exp-${t.id}`}>
                            <td colSpan={6} className="px-0 py-0">
                              <div className="bg-slate-50 border-b border-slate-200">
                                <table className="w-full text-xs">
                                  <thead className="bg-slate-100">
                                    <tr className="text-slate-500">
                                      <th className="pl-12 pr-2 py-1.5 text-left">Item Name</th>
                                      <th className="px-2 py-1.5 text-left">Batch</th>
                                      <th className="px-2 py-1.5 text-left">Expiry</th>
                                      <th className="px-2 py-1.5 text-right">Qty</th>
                                      <th className="px-2 py-1.5 text-right">Unit Price</th>
                                      <th className="px-2 py-1.5 text-right">Disc%</th>
                                      <th className="px-2 py-1.5 text-right">GST%</th>
                                      <th className="px-2 py-1.5 text-right">Amount</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {txnItems[t.id].map((ti, j) => (
                                      <tr key={j} className="border-t border-slate-200">
                                        <td className="pl-12 pr-2 py-1.5 font-medium text-slate-700">{ti.display_name}</td>
                                        <td className="px-2 py-1.5 text-slate-500">{ti.batch_no || '—'}</td>
                                        <td className="px-2 py-1.5 text-slate-500">{ti.expiry_date || '—'}</td>
                                        <td className="px-2 py-1.5 text-right font-mono">{ti.quantity} {ti.unit}</td>
                                        <td className="px-2 py-1.5 text-right font-mono">₹{ti.price}</td>
                                        <td className="px-2 py-1.5 text-right text-orange-600">{ti.discount_pct > 0 ? `${ti.discount_pct}%` : '—'}</td>
                                        <td className="px-2 py-1.5 text-right text-blue-600">{ti.tax_pct > 0 ? `${ti.tax_pct}%` : '—'}</td>
                                        <td className="px-2 py-1.5 text-right font-bold font-mono">₹{(ti.amount || ti.price * ti.quantity).toFixed(2)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                <Search size={24} className="opacity-40" />
              </div>
              <p className="text-base font-medium">Select a party</p>
              <p className="text-sm mt-1">Click a party on the left to view details</p>
            </div>
          </div>
        )}
      </div>

      {/* Add Party Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setShowAdd(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="font-bold text-lg text-slate-800 mb-4">Add New Party</h3>
            <div className="space-y-3">
              <div><label className="text-xs text-slate-500 font-medium block mb-1">Name *</label>
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} autoFocus
                  className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-slate-500 font-medium block mb-1">Phone</label>
                  <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})}
                    className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="text-xs text-slate-500 font-medium block mb-1">Type</label>
                  <select value={form.type} onChange={e => setForm({...form, type: e.target.value})}
                    className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="customer">Customer</option>
                    <option value="vendor">Vendor</option>
                  </select></div>
              </div>
              <div><label className="text-xs text-slate-500 font-medium block mb-1">GSTIN</label>
                <input value={form.gstin} onChange={e => setForm({...form, gstin: e.target.value})}
                  className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="text-xs text-slate-500 font-medium block mb-1">Address</label>
                <textarea value={form.address} onChange={e => setForm({...form, address: e.target.value})} rows={2}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="text-xs text-slate-500 font-medium block mb-1">Opening Balance</label>
                <input type="number" value={form.opening_balance} onChange={e => setForm({...form, opening_balance: parseFloat(e.target.value) || 0})}
                  className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              {status && <p className="text-sm text-center">{status}</p>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowAdd(false)} className="flex-1 h-10 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={saveParty} className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">Save Party</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
