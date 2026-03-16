'use client';
import { useState, useEffect, useCallback } from 'react';
import { getDB } from '@/lib/db';
import { Search, Plus, Edit2, Trash2, Save, X, AlertTriangle, Package } from 'lucide-react';

interface Item {
  id: number; name: string; hsn: string; unit: string;
  sale_price: number; purchase_price: number; opening_stock: number;
  current_stock: number; category: string; tax_rate: number; discount: number;
  last_supplier?: string;
}

const emptyForm = {
  name: '', hsn: '', unit: '', sale_price: 0, purchase_price: 0,
  opening_stock: 0, current_stock: 0, category: '', tax_rate: 0, discount: 0
};

export default function Items() {
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [categories, setCategories] = useState<string[]>([]);
  const [editItem, setEditItem] = useState<any>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const load = useCallback(async () => {
    const db = await getDB();
    const q = `%${search}%`;
    let stockWhere = '';
    if (stockFilter === 'low') stockWhere = 'AND current_stock > 0 AND current_stock < 10';
    if (stockFilter === 'out') stockWhere = 'AND current_stock <= 0';

    // Join with last supplier from purchase transactions
    const res = await db.select<Item[]>(
      `SELECT i.*, 
        (SELECT p.name FROM transaction_items ti 
          JOIN transactions t ON t.id=ti.txn_id 
          JOIN parties p ON p.id=t.party_id
          WHERE ti.item_id=i.id AND t.type='purchase'
          ORDER BY t.id DESC LIMIT 1
        ) as last_supplier
       FROM items i
       WHERE i.name LIKE $1 ${category ? `AND i.category='${category}'` : ''} ${stockWhere}
       ORDER BY i.name
       LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`,
      [q]
    );
    setItems(res);
    if (!category) {
      const cats = await db.select<any[]>(`SELECT DISTINCT category FROM items WHERE category != '' ORDER BY category`);
      setCategories(cats.map(c => c.category));
    }
  }, [search, category, page, stockFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'n') { e.preventDefault(); setShowAdd(true); setForm({ ...emptyForm }); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const saveItem = async () => {
    const db = await getDB();
    try {
      if (editItem) {
        await db.execute(
          `UPDATE items SET name=$1,hsn=$2,unit=$3,sale_price=$4,purchase_price=$5,opening_stock=$6,current_stock=$7,category=$8,tax_rate=$9,discount=$10 WHERE id=$11`,
          [form.name, form.hsn, form.unit, form.sale_price, form.purchase_price, form.opening_stock, form.current_stock, form.category, form.tax_rate, form.discount, editItem.id]
        );
      } else {
        await db.execute(
          `INSERT INTO items (name,hsn,unit,sale_price,purchase_price,opening_stock,current_stock,category,tax_rate,discount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [form.name, form.hsn, form.unit, form.sale_price, form.purchase_price, form.opening_stock, form.current_stock, form.category, form.tax_rate, form.discount]
        );
      }
      setStatus('✅ Saved!'); setShowAdd(false); setEditItem(null); load();
      setTimeout(() => setStatus(''), 2000);
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
  };

  const deleteItem = async (id: number) => {
    if (!confirm('Delete this item?')) return;
    const db = await getDB();
    await db.execute(`DELETE FROM items WHERE id=$1`, [id]);
    load();
  };

  const startEdit = (item: Item) => {
    setEditItem(item);
    setForm({
      name: item.name, hsn: item.hsn || '', unit: item.unit || '',
      sale_price: item.sale_price, purchase_price: item.purchase_price,
      opening_stock: item.opening_stock, current_stock: item.current_stock,
      category: item.category || '', tax_rate: item.tax_rate || 0, discount: item.discount || 0
    });
    setShowAdd(true);
  };

  const stockCounts = {
    out: items.filter(i => i.current_stock <= 0).length,
    low: items.filter(i => i.current_stock > 0 && i.current_stock < 10).length,
  };

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-slate-200 gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} autoFocus
              placeholder="Search items..." className="pl-8 pr-4 h-9 w-64 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}
            className="h-9 border border-slate-200 rounded-lg text-sm px-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {([['all', 'All'], ['low', `Low (${stockCounts.low})`], ['out', `Out (${stockCounts.out})`]] as const).map(([f, label]) => (
              <button key={f} onClick={() => { setStockFilter(f); setPage(0); }}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${stockFilter === f ? 'bg-white shadow text-slate-700' : 'text-slate-500 hover:text-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>
          {status && <span className="text-sm">{status}</span>}
        </div>
        <button onClick={() => { setShowAdd(true); setEditItem(null); setForm({ ...emptyForm }); }}
          className="flex items-center gap-2 h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
          <Plus size={14} /> Add Item <kbd className="text-xs opacity-70 ml-1 font-mono">Ctrl+N</kbd>
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 sticky top-0 z-10">
            <tr className="text-slate-500 text-xs uppercase tracking-wide">
              <th className="pl-6 pr-2 py-3 text-left">Item Name</th>
              <th className="px-2 py-3 text-left w-28">Category</th>
              <th className="px-2 py-3 text-left w-24">Supplier (Last)</th>
              <th className="px-2 py-3 text-left w-16">HSN</th>
              <th className="px-2 py-3 text-left w-14">Unit</th>
              <th className="px-2 py-3 text-right w-20">MRP</th>
              <th className="px-2 py-3 text-right w-20">Purchase</th>
              <th className="px-2 py-3 text-right w-16">GST%</th>
              <th className="px-2 py-3 text-right w-16">Disc%</th>
              <th className="px-2 py-3 text-right w-20">Stock</th>
              <th className="px-2 py-3 text-center w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} className="border-b border-slate-100 hover:bg-white transition-colors group">
                <td className="pl-6 pr-2 py-2.5">
                  <p className="font-medium text-slate-800">{item.name}</p>
                </td>
                <td className="px-2 py-2.5">
                  {item.category
                    ? <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{item.category}</span>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-2 py-2.5">
                  {item.last_supplier
                    ? <span className="text-xs text-blue-600 font-medium truncate max-w-[96px] block" title={item.last_supplier}>{item.last_supplier}</span>
                    : <span className="text-slate-300 text-xs">—</span>}
                </td>
                <td className="px-2 py-2.5 text-slate-500 text-xs font-mono">{item.hsn || '—'}</td>
                <td className="px-2 py-2.5 text-slate-500 text-xs">{item.unit || '—'}</td>
                <td className="px-2 py-2.5 text-right font-mono font-semibold text-slate-800">₹{item.sale_price}</td>
                <td className="px-2 py-2.5 text-right font-mono text-slate-500">₹{item.purchase_price}</td>
                <td className="px-2 py-2.5 text-right">
                  {item.tax_rate > 0
                    ? <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">{item.tax_rate}%</span>
                    : <span className="text-slate-300 text-xs">0%</span>}
                </td>
                <td className="px-2 py-2.5 text-right">
                  {item.discount > 0
                    ? <span className="text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded font-medium">{item.discount}%</span>
                    : <span className="text-slate-300 text-xs">0%</span>}
                </td>
                <td className="px-2 py-2.5 text-right">
                  <span className={`text-sm font-bold ${item.current_stock <= 0 ? 'text-red-600' : item.current_stock < 10 ? 'text-yellow-600' : 'text-green-600'}`}>
                    {item.current_stock <= 0 && <AlertTriangle size={11} className="inline mr-1" />}
                    {item.current_stock}
                  </span>
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(item)} className="w-7 h-7 rounded hover:bg-blue-100 flex items-center justify-center text-blue-600"><Edit2 size={13} /></button>
                    <button onClick={() => deleteItem(item.id)} className="w-7 h-7 rounded hover:bg-red-100 flex items-center justify-center text-red-500"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={11} className="py-16 text-center text-slate-400 text-sm">
                <Package size={32} className="mx-auto mb-2 opacity-20" />
                No items found
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-6 py-2 bg-white border-t border-slate-200">
        <p className="text-xs text-slate-400">Showing {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + items.length}</p>
        <div className="flex gap-2">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40">← Prev</button>
          <button disabled={items.length < PAGE_SIZE} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40">Next →</button>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setShowAdd(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg text-slate-800">{editItem ? 'Edit Item' : 'Add New Item'}</h3>
              <button onClick={() => { setShowAdd(false); setEditItem(null); }} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 font-medium block mb-1">Item Name *</label>
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} autoFocus
                  className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Category</label>
                  <input value={form.category} onChange={e => setForm({...form, category: e.target.value})}
                    list="cat-list" className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <datalist id="cat-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">HSN Code</label>
                  <input value={form.hsn} onChange={e => setForm({...form, hsn: e.target.value})}
                    className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Unit</label>
                  <input value={form.unit} onChange={e => setForm({...form, unit: e.target.value})}
                    list="unit-list" className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <datalist id="unit-list">
                    <option value="PCS" /><option value="BOX" /><option value="STRIP" />
                    <option value="ML" /><option value="GM" /><option value="LTR" /><option value="NOS" />
                  </datalist>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Sale Price (MRP) ₹</label>
                  <input type="number" value={form.sale_price} onChange={e => setForm({...form, sale_price: parseFloat(e.target.value) || 0})}
                    className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Purchase Price ₹</label>
                  <input type="number" value={form.purchase_price} onChange={e => setForm({...form, purchase_price: parseFloat(e.target.value) || 0})}
                    className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">GST Rate %</label>
                  <input type="number" min={0} value={form.tax_rate} onChange={e => setForm({...form, tax_rate: parseFloat(e.target.value) || 0})}
                    className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Default Discount %</label>
                  <input type="number" min={0} max={100} value={form.discount} onChange={e => setForm({...form, discount: parseFloat(e.target.value) || 0})}
                    className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Opening Stock</label>
                  <input type="number" value={form.opening_stock} onChange={e => { const v = parseFloat(e.target.value) || 0; setForm({...form, opening_stock: v, current_stock: v}); }}
                    className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Current Stock</label>
                  <input type="number" value={form.current_stock} onChange={e => setForm({...form, current_stock: parseFloat(e.target.value) || 0})}
                    className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              {status && <p className="text-sm text-center font-medium">{status}</p>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowAdd(false); setEditItem(null); }} className="flex-1 h-10 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={saveItem} className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2">
                <Save size={14} /> {editItem ? 'Update' : 'Add'} Item
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
