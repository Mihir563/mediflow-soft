'use client';
import { useState, useEffect, useCallback } from 'react';
import { getDB } from '@/lib/db';
import { Search, Plus, Edit2, Trash2, Save, X, AlertTriangle, Package } from 'lucide-react';

import ItemModal from '@/components/ItemModal';

interface Item {
  id: number; name: string; hsn: string; unit: string;
  sale_price: number; purchase_price: number; opening_stock: number;
  current_stock: number; min_stock: number; category: string; tax_rate: number; discount: number;
  inclusive_tax: number; last_supplier?: string;
}

const normalizeSql = (column: string) =>
  `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${column}, ''), ' ', ''), '.', ''), '-', ''), '/', ''), '(', ''), ')', ''))`;

export default function Items({ initialSearch = '' }: { initialSearch?: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState(initialSearch);
  const [category, setCategory] = useState('');
  const [partyId, setPartyId] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [categories, setCategories] = useState<string[]>([]);
  const [parties, setParties] = useState<{ id: number; name: string }[]>([]);
  const [editItem, setEditItem] = useState<any>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const load = useCallback(async () => {
    const db = await getDB();
    const q = `%${search}%`;
    let stockWhere = '';
    if (stockFilter === 'low') stockWhere = 'AND current_stock > 0 AND current_stock <= CASE WHEN min_stock > 0 THEN min_stock ELSE 10 END';
    if (stockFilter === 'out') stockWhere = 'AND current_stock <= 0';
    const partyWhere = partyId
      ? `AND EXISTS (
          SELECT 1
          FROM transaction_items ti
          JOIN transactions t ON t.id = ti.txn_id
          WHERE t.type='purchase'
            AND t.party_id=${Number(partyId)}
            AND (
              ti.item_id=i.id
              OR ${normalizeSql('ti.item_name')} = ${normalizeSql('i.name')}
            )
        )`
      : '';

    // Join with last supplier from purchase transactions
    const res = await db.select<Item[]>(
      `SELECT i.*, 
        (SELECT p.name FROM transaction_items ti 
          JOIN transactions t ON t.id=ti.txn_id 
          JOIN parties p ON p.id=t.party_id
          WHERE t.type='purchase'
            AND (
              ti.item_id=i.id
              OR ${normalizeSql('ti.item_name')} = ${normalizeSql('i.name')}
            )
          ORDER BY t.id DESC LIMIT 1
        ) as last_supplier
       FROM items i
       WHERE i.name LIKE $1 ${category ? `AND i.category='${category}'` : ''} ${stockWhere} ${partyWhere}
       ORDER BY i.name
       LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`,
      [q]
    );
    setItems(res);
    if (!category) {
      const cats = await db.select<any[]>(`SELECT DISTINCT category FROM items WHERE category != '' ORDER BY category`);
      setCategories(cats.map(c => c.category));
    }
    if (parties.length === 0) {
      const partyRows = await db.select<{ id: number; name: string }[]>(`SELECT id, name FROM parties ORDER BY name`);
      setParties(partyRows);
    }
  }, [search, category, page, stockFilter, partyId, parties.length]);

  useEffect(() => { load(); }, [load]);
  
  useEffect(() => {
    if (initialSearch) setSearch(initialSearch);
  }, [initialSearch]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'n') { e.preventDefault(); setShowAdd(true); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const handleItemSaved = () => {
    setStatus('✅ Saved!'); 
    setShowAdd(false); 
    setEditItem(null); 
    load();
    setTimeout(() => setStatus(''), 2000);
  };

  const deleteItem = async (id: number) => {
    if (!confirm('Delete this item?')) return;
    const db = await getDB();
    await db.execute(`DELETE FROM items WHERE id=$1`, [id]);
    load();
  };

  const startEdit = (item: Item) => {
    setEditItem(item);
    setShowAdd(true);
  };

  const stockCounts = {
    out: items.filter(i => i.current_stock <= 0).length,
    low: items.filter(i => i.current_stock > 0 && i.current_stock <= (i.min_stock || 10)).length,
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
          <select value={partyId} onChange={e => { setPartyId(e.target.value); setPage(0); }}
            className="h-9 border border-slate-200 rounded-lg text-sm px-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-56">
            <option value="">All Suppliers / Parties</option>
            {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
        <button onClick={() => { setShowAdd(true); setEditItem(null); }}
          className="flex items-center gap-2 h-9 px-4 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-medium shadow-sm transition-colors">
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
                <td className="px-2 py-2.5 text-right font-mono font-semibold text-slate-800">
                  ₹{item.sale_price}
                  {item.inclusive_tax ? <span className="ml-1 text-[10px] text-green-600 font-sans leading-none block">Incl. Tax</span> : null}
                </td>
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
                  <span className={`text-sm font-bold ${item.current_stock <= 0 ? 'text-red-600' : item.current_stock <= (item.min_stock || 10) ? 'text-yellow-600' : 'text-green-600'}`}>
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
        <ItemModal
          onClose={() => { setShowAdd(false); setEditItem(null); }}
          onSave={handleItemSaved}
          itemToEdit={editItem}
        />
      )}
    </div>
  );
}
