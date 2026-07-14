'use client';

import { useState, useRef, useEffect } from 'react';
import { getDB } from '@/lib/db';
import { Search, Trash2 } from 'lucide-react';

export default function FastBilling() {
  const [items, setItems] = useState<any[]>([]);
  const [cart, setCart] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [dbInfo, setDbInfo] = useState<string>('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
    checkDB();
  }, []);

  const checkDB = async () => {
    try {
      const db = await getDB();
      const result = await db.select<any[]>('SELECT COUNT(*) as cnt FROM items');
      setDbInfo(`DB: ${result?.[0]?.cnt ?? 'N/A'} items`);
    } catch (e: any) {
      setDbInfo(`DB error: ${e.message}`);
    }
  };

  const searchItems = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 1) { setItems([]); setIsSearchOpen(false); return; }
    try {
      const db = await getDB();
      const result = await db.select(`SELECT * FROM items WHERE name LIKE $1 LIMIT 15`, [`%${q}%`]);
      setItems(result as any[]);
      setSelectedIndex(-1);
      setIsSearchOpen(true);
    } catch (e: any) { console.error('Search error:', e); }
  };

  const handleSelect = (item: any) => {
    const existing = cart.find(c => c.id === item.id);
    if (existing) {
      setCart(cart.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c));
    } else {
      setCart([...cart, { ...item, qty: 1 }]);
    }
    setIsSearchOpen(false);
    setSearchQuery('');
    setTimeout(() => searchInputRef.current?.focus(), 10);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isSearchOpen && items.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev < items.length - 1 ? prev + 1 : prev));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const idx = selectedIndex >= 0 ? selectedIndex : 0;
        if (idx < items.length) handleSelect(items[idx]);
      } else if (e.key === 'Escape') {
        setIsSearchOpen(false);
      }
    }
  };

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchInputRef.current?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const total = cart.reduce((sum, item) => sum + (item.sale_price || 0) * item.qty, 0);

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden text-sm">
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100">
        <h2 className="text-xl font-bold text-slate-800">Fast Billing POS</h2>
        <div className="flex items-center gap-3">
          {dbInfo && (
            <span className={`text-xs px-2.5 py-1 rounded-full font-mono font-bold ${
              dbInfo.includes('error') ? 'bg-red-50 text-red-600' :
              dbInfo === 'DB: 0 items' ? 'bg-amber-50 text-amber-600' :
              'bg-green-50 text-green-600'
            }`}>{dbInfo}</span>
          )}
          <kbd className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono">F2 = Search</kbd>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 py-4">
            <div className="relative max-w-2xl">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={e => searchItems(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => searchQuery && items.length > 0 && setIsSearchOpen(true)}
                placeholder="Press F2 or start typing medicine name..."
                className="w-full pl-10 pr-4 h-12 border-2 border-slate-200 rounded-xl text-base bg-white focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-sm"
              />
              {isSearchOpen && searchQuery.trim() && (
                <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5">
                  <div className="flex bg-slate-50/80 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                    <span className="flex-1">Item Name</span>
                    <span className="w-20 text-right">Stock</span>
                    <span className="w-24 text-right">Price</span>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto p-1.5">
                    {items.length > 0 ? items.map((item, idx) => (
                      <button
                        key={item.id}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => handleSelect(item)}
                        className={`flex w-full items-center px-3 py-2.5 text-left rounded-lg transition-all ${
                          selectedIndex === idx ? 'bg-blue-100 ring-2 ring-brand ring-inset' : 'hover:bg-blue-50/80'
                        }`}
                      >
                        <span className="flex-1 truncate font-semibold text-slate-700">{item.name}</span>
                        <div className="w-20 text-right">
                          <span className={`text-xs font-bold ${(item.current_stock || 0) <= 0 ? 'text-red-500 bg-red-50 px-1.5 py-0.5 rounded' : 'text-slate-600'}`}>
                            {item.current_stock || 0}
                          </span>
                        </div>
                        <div className="w-24 text-right">
                          <span className="text-sm font-mono font-bold text-slate-800">₹{Number(item.sale_price || 0).toFixed(2)}</span>
                        </div>
                      </button>
                    )) : (
                      <div className="px-4 py-6 text-center text-sm text-slate-500">No results found.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-auto border-t border-slate-100">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                <tr className="text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                  <th className="pl-6 pr-2 py-2.5 text-left w-10">#</th>
                  <th className="px-2 py-2.5 text-left">Item Name</th>
                  <th className="px-2 py-2.5 text-right w-20">Stock</th>
                  <th className="px-2 py-2.5 text-right w-24">Qty</th>
                  <th className="px-2 py-2.5 text-right w-24">Price</th>
                  <th className="px-2 py-2.5 text-right w-28">Total</th>
                  <th className="pr-6 pl-2 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((item, index) => (
                  <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                    <td className="pl-6 pr-2 py-1.5 text-slate-400 font-mono text-xs">{index + 1}</td>
                    <td className="px-2 py-1.5 font-semibold text-slate-700">{item.name}</td>
                    <td className="px-2 py-1.5 text-right">
                      <span className="text-xs font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{item.current_stock || 0}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number" min="1" value={item.qty}
                        onChange={e => { const val = parseInt(e.target.value) || 1; setCart(cart.map(c => c.id === item.id ? { ...c, qty: val } : c)); }}
                        className="w-16 h-7 border border-slate-200 rounded-md px-2 text-right font-mono text-xs bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand ml-auto block"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-700">₹{Number(item.sale_price || 0).toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right font-bold font-mono text-slate-800">₹{(item.sale_price * item.qty).toFixed(2)}</td>
                    <td className="pr-6 pl-2 py-1.5">
                      <button onClick={() => setCart(cart.filter(c => c.id !== item.id))}
                        className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-red-500 transition-colors">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
                {cart.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-16 text-slate-400">No items in cart. Start typing to add items.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="w-72 border-l border-slate-200 bg-slate-50 flex flex-col p-5">
          <h3 className="font-bold text-lg text-slate-800 mb-6">Bill Summary</h3>
          <div className="space-y-3 flex-1">
            <div className="flex justify-between text-sm text-slate-600"><span>Items ({cart.length})</span><span className="font-mono">₹{total.toFixed(2)}</span></div>
            <div className="flex justify-between text-sm text-slate-600"><span>Discount</span><span className="font-mono">₹0.00</span></div>
            <div className="flex justify-between text-sm text-slate-600"><span>Tax</span><span className="font-mono">₹0.00</span></div>
          </div>
          <div className="border-t border-slate-200 pt-4 mt-4">
            <div className="flex justify-between items-center mb-6">
              <span className="text-lg font-bold text-slate-800">Payable</span>
              <span className="text-2xl font-bold text-green-600 font-mono">₹{total.toFixed(2)}</span>
            </div>
            <button className="w-full h-11 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors shadow-sm mb-2">Save &amp; Print (F10)</button>
            <button onClick={() => setCart([])} className="w-full h-9 border border-slate-200 hover:bg-white text-slate-600 rounded-lg transition-colors text-sm">Clear (Alt+C)</button>
          </div>
        </div>
      </div>
    </div>
  );
}
