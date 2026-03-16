'use client';
import { useState, useEffect, useRef } from 'react';
import { getDB } from '@/lib/db';
import { Search, Plus, Minus, Trash2, Save } from 'lucide-react';

interface CartItem {
  id: number; name: string; unit: string; purchase_price: number; sale_price: number;
  qty: number; batch: string; expiry: string; mrp: number; price: number; disc: number;
}

export default function PurchaseBill() {
  const [vendor, setVendor] = useState<any>(null);
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorResults, setVendorResults] = useState<any[]>([]);
  const [showVendorDrop, setShowVendorDrop] = useState(false);
  const [billNo, setBillNo] = useState(`PUR-${Date.now().toString().slice(-6)}`);
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [itemResults, setItemResults] = useState<any[]>([]);
  const [showItemDrop, setShowItemDrop] = useState(false);
  const [status, setStatus] = useState('');
  const itemInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F10') { e.preventDefault(); savePurchase(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [cart, vendor, billNo, billDate]);

  const searchVendors = async (q: string) => {
    setVendorSearch(q);
    if (!q) { setVendorResults([]); setShowVendorDrop(false); return; }
    const db = await getDB();
    const res = await db.select<any[]>(`SELECT * FROM parties WHERE name LIKE $1 LIMIT 10`, [`%${q}%`]);
    setVendorResults(res); setShowVendorDrop(res.length > 0);
  };

  const searchItems = async (q: string) => {
    setItemSearch(q);
    if (!q) { setItemResults([]); setShowItemDrop(false); return; }
    const db = await getDB();
    const res = await db.select<any[]>(`SELECT * FROM items WHERE name LIKE $1 LIMIT 15`, [`%${q}%`]);
    setItemResults(res); setShowItemDrop(res.length > 0);
  };

  const addItem = (item: any) => {
    setCart(prev => [...prev, { ...item, qty: 1, batch: '', expiry: '', mrp: item.sale_price, price: item.purchase_price || 0, disc: 0 }]);
    setItemSearch(''); setItemResults([]); setShowItemDrop(false);
    setTimeout(() => itemInputRef.current?.focus(), 10);
  };

  const update = (id: number, field: string, val: any) => setCart(prev => prev.map(c => c.id === id ? { ...c, [field]: val } : c));
  const remove = (id: number) => setCart(prev => prev.filter(c => c.id !== id));

  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const net = Math.round(subtotal);

  const savePurchase = async () => {
    if (cart.length === 0) { setStatus('❌ Add at least one item'); return; }
    try {
      const db = await getDB();
      const res = await db.execute(
        `INSERT INTO transactions (invoice_no, date, party_id, total_amount, type) VALUES ($1,$2,$3,$4,'purchase')`,
        [billNo, billDate, vendor?.id || null, net]
      );
      const txnId = (res as any).lastInsertId;
      for (const item of cart) {
        await db.execute(`INSERT INTO transaction_items (txn_id, item_id, quantity, price, batch_no, expiry_date) VALUES ($1,$2,$3,$4,$5,$6)`,
          [txnId, item.id, item.qty, item.price, item.batch, item.expiry]);
        await db.execute(`UPDATE items SET current_stock = current_stock + $1 WHERE id=$2`, [item.qty, item.id]);
      }
      setStatus(`✅ Purchase ${billNo} saved!`);
      setCart([]);
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-slate-800">Purchase Bill</h2>
          {status && <span className="text-sm font-medium">{status}</span>}
        </div>
        <div className="flex gap-2">
          <kbd className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono">F10 = Save</kbd>
          <button onClick={savePurchase} className="flex items-center gap-2 h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
            <Save size={14} /> Save (F10)
          </button>
        </div>
      </div>

      {/* Meta fields */}
      <div className="px-6 py-3 bg-white border-b border-slate-200 flex gap-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <label className="text-xs text-slate-500 font-medium block mb-1">Supplier / Vendor</label>
          <input value={vendorSearch} onChange={e => searchVendors(e.target.value)}
            placeholder="Search supplier..." autoFocus
            className="w-full h-9 border border-slate-200 rounded-lg text-sm px-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {showVendorDrop && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-52 overflow-y-auto">
              {vendorResults.map(v => (
                <button key={v.id} onClick={() => { setVendor(v); setVendorSearch(v.name); setShowVendorDrop(false); }}
                  className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-slate-100 last:border-0">
                  <p className="text-sm font-medium">{v.name}</p>
                  <p className="text-xs text-slate-400">Balance: ₹{v.opening_balance}</p>
                </button>
              ))}
            </div>
          )}
        </div>
        <div><label className="text-xs text-slate-500 font-medium block mb-1">Bill No.</label>
          <input value={billNo} onChange={e => setBillNo(e.target.value)} className="w-36 h-9 border border-slate-200 rounded-lg text-sm px-3 focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
        <div><label className="text-xs text-slate-500 font-medium block mb-1">Bill Date</label>
          <input type="date" value={billDate} onChange={e => setBillDate(e.target.value)} className="h-9 border border-slate-200 rounded-lg text-sm px-3 focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
        <div><label className="text-xs text-slate-500 font-medium block mb-1">Due Date</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-9 border border-slate-200 rounded-lg text-sm px-3 focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
      </div>

      {/* Item search */}
      <div className="px-6 py-2.5 bg-slate-100 border-b border-slate-200 relative">
        <div className="relative max-w-lg">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input ref={itemInputRef} value={itemSearch} onChange={e => searchItems(e.target.value)}
            placeholder="Search item to purchase..."
            className="w-full pl-8 pr-4 h-9 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {showItemDrop && itemResults.length > 0 && (
          <div className="absolute top-full left-6 w-[500px] mt-0 bg-white border border-slate-200 rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto">
            <div className="grid grid-cols-3 text-xs text-slate-400 px-4 py-2 border-b bg-slate-50 font-medium uppercase tracking-wide">
              <span>Item Name</span><span>Stock</span><span>Purchase Price</span>
            </div>
            {itemResults.map(item => (
              <button key={item.id} onClick={() => addItem(item)}
                className="w-full grid grid-cols-3 text-left px-4 py-2.5 hover:bg-blue-50 border-b border-slate-100 last:border-0">
                <span className="text-sm font-medium">{item.name}</span>
                <span className="text-sm text-slate-500">{item.current_stock}</span>
                <span className="text-sm text-slate-700 font-mono">₹{item.purchase_price}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 sticky top-0 z-10">
              <tr className="text-slate-500 text-xs uppercase tracking-wide">
                <th className="pl-4 py-2.5 text-left w-8">#</th>
                <th className="px-2 py-2.5 text-left">Item</th>
                <th className="px-2 py-2.5 text-left w-28">Batch No.</th>
                <th className="px-2 py-2.5 text-left w-28">Expiry</th>
                <th className="px-2 py-2.5 text-right w-20">MRP</th>
                <th className="px-2 py-2.5 text-right w-20">Qty</th>
                <th className="px-2 py-2.5 text-right w-24">Purchase ₹</th>
                <th className="px-2 py-2.5 text-right w-24">Amount</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((item, idx) => (
                <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="pl-4 py-2 text-slate-400 text-xs">{idx + 1}</td>
                  <td className="px-2 py-2 font-medium text-slate-800">{item.name}</td>
                  <td className="px-2 py-2">
                    <input value={item.batch} onChange={e => update(item.id, 'batch', e.target.value)}
                      placeholder="Batch#" className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="month" value={item.expiry} onChange={e => update(item.id, 'expiry', e.target.value)}
                      className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" value={item.mrp} onChange={e => update(item.id, 'mrp', parseFloat(e.target.value) || 0)}
                      className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => update(item.id, 'qty', Math.max(1, item.qty - 1))} className="w-5 h-5 rounded bg-slate-200 hover:bg-slate-300 flex items-center justify-center"><Minus size={9} /></button>
                      <input type="number" min={1} value={item.qty} onChange={e => update(item.id, 'qty', parseInt(e.target.value) || 1)}
                        className="w-12 text-center border border-slate-200 rounded py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      <button onClick={() => update(item.id, 'qty', item.qty + 1)} className="w-5 h-5 rounded bg-slate-200 hover:bg-slate-300 flex items-center justify-center"><Plus size={9} /></button>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" value={item.price} onChange={e => update(item.id, 'price', parseFloat(e.target.value) || 0)}
                      className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="px-2 py-2 text-right font-semibold font-mono">₹{(item.price * item.qty).toFixed(2)}</td>
                  <td className="px-2 py-2">
                    <button onClick={() => remove(item.id)} className="w-6 h-6 rounded hover:bg-red-100 flex items-center justify-center text-slate-400 hover:text-red-500"><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
              {cart.length === 0 && <tr><td colSpan={9} className="py-16 text-center text-slate-400 text-sm">Search and add items above</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="w-56 bg-white border-l border-slate-200 flex flex-col p-4 gap-3">
          <h3 className="font-semibold text-slate-700">Summary</h3>
          <div className="space-y-2 text-sm text-slate-500">
            <div className="flex justify-between"><span>Items ({cart.length})</span><span className="font-mono">₹{subtotal.toFixed(2)}</span></div>
          </div>
          <div className="border-t pt-3 mt-auto">
            <div className="flex justify-between text-xl font-bold text-slate-800">
              <span>Total</span><span className="text-blue-600">₹{net.toFixed(2)}</span>
            </div>
          </div>
          <button onClick={savePurchase} className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-base flex items-center justify-center gap-2 mt-2">
            <Save size={16} /> Save
          </button>
          <button onClick={() => setCart([])} className="w-full h-9 border border-slate-200 hover:bg-slate-50 text-slate-500 rounded-xl text-sm">Clear</button>
        </div>
      </div>
    </div>
  );
}
