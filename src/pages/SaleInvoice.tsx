'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { getDB } from '@/lib/db';
import { Search, Plus, Minus, Trash2, Save, Printer, X, ChevronDown } from 'lucide-react';

interface CartItem {
  id: number; name: string; hsn: string; unit: string;
  sale_price: number; purchase_price: number; current_stock: number;
  qty: number; price: number; disc: number; tax_rate: number; batch: string; expiry: string;
}

interface Party { id: number; name: string; phone: string; opening_balance: number; }

export default function SaleInvoice() {
  const [party, setParty] = useState<Party | null>(null);
  const [partySearch, setPartySearch] = useState('');
  const [partyResults, setPartyResults] = useState<Party[]>([]);
  const [showPartyDrop, setShowPartyDrop] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentType, setPaymentType] = useState<'cash' | 'credit'>('cash');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [itemResults, setItemResults] = useState<any[]>([]);
  const [showItemDrop, setShowItemDrop] = useState(false);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const itemInputRef = useRef<HTMLInputElement>(null);
  const partyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    generateInvoiceNo();
    partyInputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F10') { e.preventDefault(); saveSale(); }
      if (e.key === 'Escape') { setShowItemDrop(false); setShowPartyDrop(false); }
      if (e.key === 'F4') { e.preventDefault(); itemInputRef.current?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cart, party, invoiceNo, invoiceDate, paymentType]);

  const generateInvoiceNo = async () => {
    try {
      const db = await getDB();
      const res = await db.select<any[]>(`SELECT COUNT(*) as cnt FROM transactions WHERE type='sale'`);
      const cnt = (res[0]?.cnt || 0) + 1;
      setInvoiceNo(`INV-${String(cnt).padStart(4, '0')}`);
    } catch { setInvoiceNo(`INV-${Date.now()}`); }
  };

  const searchParties = async (q: string) => {
    setPartySearch(q);
    if (!q.trim()) { setPartyResults([]); setShowPartyDrop(false); return; }
    try {
      const db = await getDB();
      const res = await db.select<Party[]>(`SELECT * FROM parties WHERE name LIKE $1 LIMIT 10`, [`%${q}%`]);
      setPartyResults(res);
      setShowPartyDrop(true);
    } catch { }
  };

  const searchItems = async (q: string) => {
    setItemSearch(q);
    if (!q) { setItemResults([]); setShowItemDrop(false); return; }
    try {
      const db = await getDB();
      const res = await db.select<any[]>(`SELECT * FROM items WHERE name LIKE $1 LIMIT 15`, [`%${q}%`]);
      setItemResults(res);
      setShowItemDrop(res.length > 0);
    } catch { }
  };

  const addItem = (item: any) => {
    setCart(prev => {
      const exists = prev.find(c => c.id === item.id);
      if (exists) return prev.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, {
        ...item,
        qty: 1,
        price: item.sale_price || 0,
        disc: item.discount || 0,
        tax_rate: item.tax_rate || 0,
        batch: '',
        expiry: ''
      }];
    });
    setItemSearch('');
    setItemResults([]);
    setShowItemDrop(false);
    setTimeout(() => itemInputRef.current?.focus(), 10);
  };

  const updateRow = (id: number, field: string, value: any) => {
    setCart(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const removeRow = (id: number) => setCart(prev => prev.filter(c => c.id !== id));

  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const totalDiscount = cart.reduce((s, c) => s + (c.price * c.qty * (c.disc / 100)), 0);
  const afterDiscount = subtotal - totalDiscount;
  const totalTax = cart.reduce((s, c) => {
    const base = c.price * c.qty * (1 - c.disc / 100);
    return s + base * (c.tax_rate / 100);
  }, 0);
  const net = Math.round(afterDiscount + totalTax);

  const saveSale = async () => {
    if (cart.length === 0) { setStatus('❌ Add at least one item'); return; }
    try {
      const db = await getDB();
      const res = await db.execute(
        `INSERT INTO transactions (invoice_no, date, party_id, total_amount, type, payment_type) VALUES ($1, $2, $3, $4, 'sale', $5)`,
        [invoiceNo, invoiceDate, party?.id || null, net, paymentType]
      );
      const txnId = (res as any).lastInsertId;
      for (const item of cart) {
        const base = item.price * item.qty;
        const discAmt = base * (item.disc / 100);
        const taxAmt = (base - discAmt) * (item.tax_rate / 100);
        const amount = base - discAmt + taxAmt;
        await db.execute(
          `INSERT INTO transaction_items (txn_id, item_id, item_name, quantity, unit, price, discount_pct, discount_amt, tax_pct, tax_amt, amount, batch_no, expiry_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [txnId, item.id, item.name, item.qty, item.unit, item.price, item.disc, discAmt, item.tax_rate, taxAmt, amount, item.batch || '', item.expiry || '']
        );
        await db.execute(`UPDATE items SET current_stock = current_stock - $1 WHERE id = $2`, [item.qty, item.id]);
      }
      setStatus(`✅ Invoice ${invoiceNo} saved!`);
      setCart([]);
      setParty(null); setPartySearch('');
      generateInvoiceNo();
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message}`);
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-slate-800">Sale Invoice</h2>
          {status && <span className="text-sm font-medium text-green-600">{status}</span>}
        </div>
        <div className="flex items-center gap-2">
          <kbd className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono">F4 = Add Item</kbd>
          <kbd className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono">F10 = Save</kbd>
          <button onClick={saveSale} className="flex items-center gap-2 h-9 px-4 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium">
            <Save size={14} /> Save (F10)
          </button>
        </div>
      </div>

      {/* Top form row: Party + Invoice No + Date */}
      <div className="px-6 py-3 bg-white border-b border-slate-200 flex gap-4">
        {/* Party search */}
        <div className="relative flex-1">
          <label className="text-xs text-slate-500 font-medium block mb-1">Customer / Party</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={partyInputRef}
              value={partySearch}
              onChange={e => searchParties(e.target.value)}
              onFocus={() => partySearch && setShowPartyDrop(true)}
              placeholder="Search customer... (leave blank for walk-in)"
              className="w-full pl-8 pr-4 h-9 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {party && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-green-600">{party.name}</span>}
          </div>
          {showPartyDrop && partyResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-52 overflow-y-auto">
              {partyResults.map(p => (
                <button key={p.id} onClick={() => { setParty(p); setPartySearch(p.name); setShowPartyDrop(false); }}
                  className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-slate-100 last:border-0">
                  <p className="text-sm font-medium text-slate-700">{p.name}</p>
                  <p className="text-xs text-slate-400">Balance: ₹{p.opening_balance}</p>
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium block mb-1">Invoice No.</label>
          <input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)}
            className="w-36 h-9 border border-slate-200 rounded-lg text-sm px-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium block mb-1">Invoice Date</label>
          <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}
            className="h-9 border border-slate-200 rounded-lg text-sm px-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium block mb-1">Payment</label>
          <select value={paymentType} onChange={e => setPaymentType(e.target.value as any)}
            className="h-9 border border-slate-200 rounded-lg text-sm px-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="cash">💵 Cash</option>
            <option value="credit">📋 Credit</option>
            <option value="upi">📱 UPI</option>
          </select>
        </div>
      </div>

      {/* Item search */}
      <div className="px-6 py-2.5 bg-slate-100 border-b border-slate-200 relative">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={itemInputRef}
            value={itemSearch}
            onChange={e => searchItems(e.target.value)}
            onFocus={() => itemSearch && setShowItemDrop(true)}
            placeholder="Search & add medicine/item... (F4)"
            className="w-full max-w-lg pl-8 pr-4 h-9 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {showItemDrop && itemResults.length > 0 && (
          <div className="absolute top-full left-6 w-[600px] mt-0 bg-white border border-slate-200 rounded-lg shadow-xl z-50 max-h-72 overflow-y-auto">
            <div className="grid grid-cols-4 text-xs text-slate-400 px-4 py-2 border-b bg-slate-50 font-medium uppercase tracking-wide">
              <span>Item Name</span><span>Stock</span><span>MRP</span><span>HSN</span>
            </div>
            {itemResults.map(item => (
              <button key={item.id} onClick={() => addItem(item)}
                className="w-full grid grid-cols-4 text-left px-4 py-2.5 hover:bg-blue-50 border-b border-slate-100 last:border-0 transition-colors">
                <span className="text-sm font-medium text-slate-700">{item.name}</span>
                <span className={`text-sm ${item.current_stock < 10 ? 'text-red-500 font-medium' : 'text-slate-500'}`}>{item.current_stock}</span>
                <span className="text-sm text-slate-700 font-mono">₹{item.sale_price}</span>
                <span className="text-xs text-slate-400">{item.hsn}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table + Summary */}
      <div className="flex-1 flex overflow-hidden">
        {/* Items Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 sticky top-0 z-10">
              <tr className="text-slate-500 text-xs uppercase tracking-wide">
                <th className="pl-4 pr-2 py-2.5 text-left w-8">#</th>
                <th className="px-2 py-2.5 text-left">Item Name</th>
                <th className="px-2 py-2.5 text-left w-28">Batch No.</th>
                <th className="px-2 py-2.5 text-left w-28">Expiry</th>
                <th className="px-2 py-2.5 text-right w-16">MRP</th>
                <th className="px-2 py-2.5 text-right w-20">Qty</th>
                <th className="px-2 py-2.5 text-right w-20">Price</th>
                <th className="px-2 py-2.5 text-right w-16">Disc%</th>
                <th className="px-2 py-2.5 text-right w-16">GST%</th>
                <th className="px-2 py-2.5 text-right w-24">Amount</th>
                <th className="px-2 py-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((item, idx) => {
                const base = item.price * item.qty;
                const discAmt = base * (item.disc / 100);
                const taxAmt = (base - discAmt) * (item.tax_rate / 100);
                const rowTotal = base - discAmt + taxAmt;
                return (
                  <tr key={item.id} className={`border-b border-slate-100 ${activeRow === item.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                    onClick={() => setActiveRow(item.id)}>
                    <td className="pl-4 pr-2 py-2 text-slate-400 font-mono text-xs">{idx + 1}</td>
                    <td className="px-2 py-2">
                      <p className="font-medium text-slate-800">{item.name}</p>
                      <p className="text-xs text-slate-400">{item.unit} • HSN: {item.hsn || '—'}</p>
                    </td>
                    <td className="px-2 py-2">
                      <input value={item.batch} onChange={e => updateRow(item.id, 'batch', e.target.value)}
                        placeholder="Batch#" className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="px-2 py-2">
                      <input type="month" value={item.expiry} onChange={e => updateRow(item.id, 'expiry', e.target.value)}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="px-2 py-2 text-right text-slate-400 font-mono text-xs">₹{item.sale_price}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => updateRow(item.id, 'qty', Math.max(1, item.qty - 1))} className="w-6 h-6 rounded bg-slate-200 hover:bg-slate-300 flex items-center justify-center"><Minus size={10} /></button>
                        <input type="number" min={1} value={item.qty} onChange={e => updateRow(item.id, 'qty', parseInt(e.target.value) || 1)}
                          className="w-12 text-center border border-slate-200 rounded py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        <button onClick={() => updateRow(item.id, 'qty', item.qty + 1)} className="w-6 h-6 rounded bg-slate-200 hover:bg-slate-300 flex items-center justify-center"><Plus size={10} /></button>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" value={item.price} onChange={e => updateRow(item.id, 'price', parseFloat(e.target.value) || 0)}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" min={0} max={100} value={item.disc} onChange={e => updateRow(item.id, 'disc', parseFloat(e.target.value) || 0)}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" min={0} value={item.tax_rate} onChange={e => updateRow(item.id, 'tax_rate', parseFloat(e.target.value) || 0)}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <p className="font-semibold font-mono text-slate-800">₹{rowTotal.toFixed(2)}</p>
                      {taxAmt > 0 && <p className="text-xs text-slate-400 font-mono">+₹{taxAmt.toFixed(2)} GST</p>}
                    </td>
                    <td className="px-2 py-2">
                      <button onClick={() => removeRow(item.id)} className="w-6 h-6 rounded hover:bg-red-100 flex items-center justify-center text-slate-400 hover:text-red-500">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {cart.length === 0 && (
                <tr><td colSpan={10} className="py-16 text-center text-slate-400 text-sm">
                  No items yet. Search above to add items.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Summary Panel */}
        <div className="w-64 bg-white border-l border-slate-200 flex flex-col p-4 gap-3">
          <h3 className="font-semibold text-slate-700">Bill Summary</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-slate-500"><span>Subtotal ({cart.length} items)</span><span className="font-mono">₹{subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between text-red-500"><span>Discount</span><span className="font-mono">-₹{totalDiscount.toFixed(2)}</span></div>
            <div className="flex justify-between text-blue-600"><span>GST / Tax</span><span className="font-mono">+₹{totalTax.toFixed(2)}</span></div>
            <div className="flex justify-between text-slate-400 text-xs"><span>Round-off</span><span className="font-mono">{(net - (afterDiscount + totalTax)).toFixed(2)}</span></div>
          </div>
          <div className="border-t border-slate-200 pt-3 mt-auto">
            <div className="flex justify-between text-xl font-bold text-slate-800">
              <span>Net Total</span>
              <span className="text-green-600">₹{net.toFixed(2)}</span>
            </div>
          </div>
          <button onClick={saveSale}
            className="w-full h-12 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold text-base flex items-center justify-center gap-2 mt-2 transition-colors">
            <Save size={16} /> Save & Print
          </button>
          <button onClick={() => { setCart([]); setParty(null); setPartySearch(''); }}
            className="w-full h-9 border border-slate-200 hover:bg-slate-50 text-slate-500 rounded-xl text-sm transition-colors">
            Clear (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
