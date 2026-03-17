'use client';
import { useState, useEffect, useRef } from 'react';
import { getDB } from '@/lib/db';
import { Search, Plus, Trash2, Save, ChevronDown } from 'lucide-react';
import ItemModal from '@/components/ItemModal';

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
  const [paymentType, setPaymentType] = useState<'cash' | 'credit' | 'upi'>('cash');
  const [challanNo, setChallanNo] = useState('');
  const [description, setDescription] = useState('');
  const [paidAmount, setPaidAmount] = useState<number | ''>('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [itemResults, setItemResults] = useState<any[]>([]);
  const [showItemDrop, setShowItemDrop] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [status, setStatus] = useState('');
  const itemInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); savePurchase(); }
      if (e.key === 'F10') { e.preventDefault(); savePurchase(); } // keep F10 for backwards compatibility
      if (e.key === 'Escape') { setShowItemDrop(false); setShowVendorDrop(false); setShowItemModal(false); }
      if (e.key === 'F4') { e.preventDefault(); itemInputRef.current?.focus(); }
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
    
    const finalPaid = paidAmount === '' ? net : Number(paidAmount);
    const balanceDue = net - finalPaid;
    const paymentStatus = balanceDue <= 0 ? 'paid' : finalPaid > 0 ? 'partial' : 'unpaid';

    try {
      const db = await getDB();
      const res = await db.execute(
        `INSERT INTO transactions (invoice_no, date, party_id, total_amount, paid_amount, balance_due, type, payment_type, status, challan_no, description) VALUES ($1,$2,$3,$4,$5,$6,'purchase',$7,$8,$9,$10)`,
        [billNo, billDate, vendor?.id || null, net, finalPaid, balanceDue, paymentType, paymentStatus, challanNo, description]
      );
      const txnId = (res as any).lastInsertId;
      for (const item of cart) {
        await db.execute(`INSERT INTO transaction_items (txn_id, item_id, quantity, price, batch_no, expiry_date) VALUES ($1,$2,$3,$4,$5,$6)`,
          [txnId, item.id, item.qty, item.price, item.batch, item.expiry]);
        await db.execute(`UPDATE items SET current_stock = current_stock + $1 WHERE id=$2`, [item.qty, item.id]);
      }
      setStatus(`✅ Purchase ${billNo} saved!`);
      setCart([]); setVendor(null); setVendorSearch(''); setPaidAmount(''); setChallanNo(''); setDescription('');
      setBillNo(`PUR-${Date.now().toString().slice(-6)}`);
    } catch (e: any) { setStatus(`❌ ${e.message}`); }
  };

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden text-sm">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h2 className="text-xl font-bold text-slate-800">Purchase</h2>
        <div className="flex items-center gap-4">
          <kbd className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono">F4 = Add Item</kbd>
          <kbd className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono">Ctrl+S = Save</kbd>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {status && <div className="px-6 py-2 bg-blue-50 text-brand text-sm font-medium border-b border-blue-100">{status}</div>}
        
        {/* Invoice Info Row */}
        <div className="px-6 py-4 grid grid-cols-2 gap-8">
          {/* Left: Party */}
          <div className="flex flex-col gap-4">
            <div className="relative max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={vendorSearch}
                onChange={e => searchVendors(e.target.value)}
                onFocus={() => vendorSearch && setShowVendorDrop(true)}
                placeholder="Search Supplier by Name/Phone *"
                autoFocus
                className="w-full pl-8 pr-4 h-10 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm"
              />
              {vendor && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-brand bg-blue-50 px-2 py-0.5 rounded">{vendor.name}</span>}
              {showVendorDrop && vendorResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-52 overflow-y-auto">
                  {vendorResults.map(v => (
                    <button key={v.id} onClick={() => { setVendor(v); setVendorSearch(v.name); setShowVendorDrop(false); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                      <p className="text-sm font-medium text-slate-700">{v.name}</p>
                      <p className="text-xs text-slate-400">Balance: ₹{v.opening_balance}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <div className="relative max-w-sm">
              <input value={challanNo} onChange={e => setChallanNo(e.target.value)} placeholder="Challan / Order Number"
                className="w-full h-10 border border-slate-200 rounded-lg text-sm px-3 bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" />
            </div>
          </div>

          {/* Right: Dates & Invoice No */}
          <div className="flex flex-col items-end gap-3 text-sm">
            <div className="flex items-center gap-4 w-64">
              <label className="text-slate-500 w-24 text-right">Bill Number</label>
              <input value={billNo} onChange={e => setBillNo(e.target.value)}
                className="flex-1 h-8 border-b-2 border-slate-100 focus:border-brand hover:border-slate-200 rounded-none bg-transparent px-1 font-mono focus:outline-none text-slate-700" />
            </div>
            <div className="flex items-center gap-4 w-64">
              <label className="text-slate-500 w-24 text-right">Bill Date</label>
              <input type="date" value={billDate} onChange={e => setBillDate(e.target.value)}
                className="flex-1 h-8 border-b-2 border-slate-100 focus:border-brand hover:border-slate-200 rounded-none bg-transparent px-1 focus:outline-none text-slate-700" />
            </div>
            <div className="flex items-center gap-4 w-64">
              <label className="text-slate-500 w-24 text-right">Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="flex-1 h-8 border-b-2 border-slate-100 focus:border-brand hover:border-slate-200 rounded-none bg-transparent px-1 focus:outline-none text-slate-700" />
            </div>
          </div>
        </div>

        {/* Item Search Bar */}
        <div className="px-6 py-2 border-b border-slate-200 bg-slate-50 relative z-40">
           <div className="relative max-w-lg">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={itemInputRef}
              value={itemSearch}
              onChange={e => searchItems(e.target.value)}
              onFocus={() => itemSearch && setShowItemDrop(true)}
              placeholder="Search & add item to purchase... (F4)"
              className="w-full pl-8 pr-4 h-9 border border-slate-200 rounded text-sm bg-white focus:outline-none focus:border-brand shadow-sm"
            />
          </div>
          {showItemDrop && itemSearch && (
            <div className="absolute top-full left-6 w-[500px] mt-1 bg-white border border-slate-200 rounded shadow-xl z-50 flex flex-col overflow-hidden">
              <div className="max-h-56 overflow-y-auto w-full">
                {itemResults.length > 0 ? (
                  <>
                    <div className="grid grid-cols-3 text-xs text-slate-400 px-4 py-2 border-b bg-slate-50 font-medium uppercase tracking-wide sticky top-0">
                      <span>Item Name</span><span>Stock</span><span>Purchase Price</span>
                    </div>
                    {itemResults.map(item => (
                      <button key={item.id} onClick={() => addItem(item)}
                        className="w-full grid grid-cols-3 text-left px-4 py-2.5 hover:bg-blue-50 border-b border-slate-100 last:border-0 transition-colors">
                        <span className="text-sm font-medium text-slate-700">{item.name}</span>
                        <span className={`text-sm ${item.current_stock < 10 ? 'text-red-500 font-medium' : 'text-slate-500'}`}>{item.current_stock}</span>
                        <span className="text-sm text-slate-700 font-mono">₹{item.purchase_price}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="p-4 text-sm text-slate-500 text-center flex flex-col gap-2 items-center">
                    <p>No item found matching "{itemSearch}"</p>
                  </div>
                )}
              </div>
              <div className="p-2 bg-slate-50 border-t border-slate-200">
                <button onClick={() => { setShowItemDrop(false); setShowItemModal(true); }}
                  className="w-full py-2 bg-brand/10 hover:bg-brand/20 text-brand font-medium rounded text-sm flex items-center justify-center gap-2 transition-colors">
                  <Plus size={16} /> Create New Item: {itemSearch}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Entry */}
        {showItemModal && (
          <ItemModal
            onClose={() => { setShowItemModal(false); setTimeout(() => itemInputRef.current?.focus(), 10); }}
            onSave={(item) => { setShowItemModal(false); addItem(item); }}
            initialName={itemSearch}
          />
        )}

        {/* Items Table */}
        <div className="flex-1 overflow-x-auto min-h-[250px]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr className="text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                <th className="pl-6 pr-2 py-3 text-left w-8">#</th>
                <th className="px-2 py-3 text-left">Item / Description</th>
                <th className="px-2 py-3 text-left w-24">Batch No.</th>
                <th className="px-2 py-3 text-left w-24">Exp. Date</th>
                <th className="px-2 py-3 text-right w-20">MRP</th>
                <th className="px-2 py-3 text-right w-20">Qty</th>
                <th className="px-2 py-3 text-left w-16">Unit</th>
                <th className="px-2 py-3 text-right w-24">Purchase ₹</th>
                <th className="px-2 py-3 text-right w-24 font-bold">Amount</th>
                <th className="pr-6 pl-2 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((item, idx) => (
                <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="pl-6 pr-2 py-2 text-slate-400 font-mono text-xs">{idx + 1}</td>
                  <td className="px-2 py-2 font-medium text-slate-700">{item.name}</td>
                  <td className="px-2 py-2">
                    <input value={item.batch} onChange={e => update(item.id, 'batch', e.target.value)}
                      className="w-full border border-slate-200 rounded px-2 py-1.5 focus:border-brand focus:ring-1 focus:ring-brand outline-none bg-transparent" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="month" value={item.expiry} onChange={e => update(item.id, 'expiry', e.target.value)}
                      className="w-full border border-slate-200 rounded px-1 py-1.5 focus:border-brand focus:ring-1 focus:ring-brand outline-none bg-transparent text-xs" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" value={item.mrp} onChange={e => update(item.id, 'mrp', parseFloat(e.target.value) || 0)}
                      className="w-full text-right border border-slate-200 rounded px-2 py-1.5 focus:border-brand focus:ring-1 focus:ring-brand outline-none bg-transparent font-mono" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" min={1} value={item.qty} onChange={e => update(item.id, 'qty', parseInt(e.target.value) || 1)}
                      className="w-full text-right border border-slate-200 rounded px-2 py-1.5 font-medium focus:border-brand focus:ring-1 focus:ring-brand outline-none bg-transparent font-mono" />
                  </td>
                  <td className="px-2 py-2 text-slate-500 uppercase text-xs">{item.unit || 'NONE'}</td>
                  <td className="px-2 py-2">
                    <input type="number" value={item.price} onChange={e => update(item.id, 'price', parseFloat(e.target.value) || 0)}
                      className="w-full text-right border border-slate-200 rounded px-2 py-1.5 font-mono focus:border-brand focus:ring-1 focus:ring-brand outline-none bg-transparent" />
                  </td>
                  <td className="px-2 py-2 text-right font-medium font-mono text-slate-800">
                    {(item.price * item.qty).toFixed(2)}
                  </td>
                  <td className="pr-6 pl-2 py-2 text-right">
                    <button onClick={() => remove(item.id)} className="w-6 h-6 rounded hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors ml-auto">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Totals Row */}
            {cart.length > 0 && (
              <tfoot className="bg-slate-50 border-t border-b border-slate-200 sticky bottom-0 z-10">
                 <tr>
                   <td colSpan={5} className="px-6 py-3 font-medium text-slate-600">Total</td>
                   <td className="px-2 py-3 text-right font-bold text-slate-700 font-mono">{cart.reduce((s,c)=>s+c.qty, 0)}</td>
                   <td colSpan={2}></td>
                   <td className="px-2 py-3 text-right font-bold text-slate-800 font-mono">{net.toFixed(2)}</td>
                   <td></td>
                 </tr>
              </tfoot>
            )}
          </table>
          {cart.length === 0 && (
            <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
               No items added. Press <kbd className="mx-1 px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-xs">F4</kbd> to search and add an item.
            </div>
          )}
        </div>

        {/* Bottom Panel */}
        <div className="bg-slate-50 border-t border-slate-200 p-6 flex justify-between shrink-0">
          {/* Left: Payment Info */}
          <div className="flex gap-8 w-1/2">
             <div className="space-y-4">
                <div className="flex items-center gap-3">
                   <div className="relative">
                     <select value={paymentType} onChange={e => setPaymentType(e.target.value as any)}
                        className="appearance-none h-10 pl-4 pr-10 border border-slate-200 rounded-lg bg-white text-sm focus:border-brand focus:ring-1 focus:ring-brand outline-none shadow-sm cursor-pointer">
                        <option value="cash">Cash</option>
                        <option value="credit">Credit</option>
                        <option value="upi">UPI</option>
                     </select>
                     <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                   </div>
                   {paymentType !== 'credit' && (
                     <div className="flex items-center">
                       <span className="text-slate-500 mr-2 text-sm">Amount Paid</span>
                       <input type="number" placeholder={net.toFixed(2)} value={paidAmount} onChange={e => setPaidAmount(e.target.value ? parseFloat(e.target.value) : '')}
                         className="w-24 h-10 border border-slate-200 rounded-lg text-right px-3 font-mono text-sm bg-white focus:border-brand focus:ring-1 focus:ring-brand outline-none shadow-sm" />
                     </div>
                   )}
                </div>
                {paymentType !== 'credit' && (net - (paidAmount === '' ? net : Number(paidAmount))) > 0 && (
                  <div className="text-sm font-medium text-orange-600">
                    Balance Due: ₹{(net - (paidAmount === '' ? net : Number(paidAmount))).toFixed(2)}
                  </div>
                )}
                <div className="w-96">
                  <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Add Description / Notes"
                    className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm resize-none" />
                </div>
             </div>
          </div>

          {/* Right: Totals & Actions */}
          <div className="w-[300px] flex flex-col justify-end gap-6">
             <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm border-t-4 border-t-brand">
               <div className="flex justify-between items-center pb-1">
                 <span className="text-lg font-bold text-slate-800">Total Purchase</span>
                 <span className="text-2xl font-bold text-slate-800 font-mono">₹{net.toFixed(2)}</span>
               </div>
             </div>
             
             <div className="flex gap-2 justify-end">
               <button onClick={() => { setCart([]); setVendor(null); setVendorSearch(''); }}
                 className="px-6 h-10 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors shadow-sm bg-white">
                 Clear
               </button>
               <button onClick={savePurchase}
                 className="px-8 h-10 rounded-lg bg-brand hover:bg-brand-hover text-white font-medium transition-colors shadow-sm flex items-center gap-2">
                 Save (Ctrl+S)
               </button>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
