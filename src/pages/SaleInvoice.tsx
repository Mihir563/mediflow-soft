'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { getDB } from '@/lib/db';
import { Search, Plus, Trash2, Save, X, ChevronDown } from 'lucide-react';
import ItemModal from '@/components/ItemModal';

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
  const [paymentType, setPaymentType] = useState<'cash' | 'credit' | 'upi'>('cash');
  const [challanNo, setChallanNo] = useState('');
  const [description, setDescription] = useState('');
  const [paidAmount, setPaidAmount] = useState<number | ''>('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [itemResults, setItemResults] = useState<any[]>([]);
  const [showItemDrop, setShowItemDrop] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const itemInputRef = useRef<HTMLInputElement>(null);
  const partyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    generateInvoiceNo();
    partyInputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveSale(); }
      if (e.key === 'F10') { e.preventDefault(); saveSale(); } // keep F10 for backwards compatibility
      if (e.key === 'Escape') { setShowItemDrop(false); setShowPartyDrop(false); setShowItemModal(false); }
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
      // Most sold items at the top and limit length
      // Apply party-specific rates if a party is selected
      const query = party 
        ? `SELECT i.*, 
            COALESCE((SELECT SUM(quantity) FROM transaction_items WHERE item_id = i.id), 0) as sold_qty,
            COALESCE(psr.price, i.sale_price) as sale_price,
            COALESCE(psr.discount, i.discount) as discount
           FROM items i 
           LEFT JOIN party_special_rates psr ON psr.item_id = i.id AND psr.party_id = $2
           WHERE i.name LIKE $1 
           ORDER BY sold_qty DESC, i.name 
           LIMIT 15`
        : `SELECT i.*, 
            COALESCE((SELECT SUM(quantity) FROM transaction_items WHERE item_id = i.id), 0) as sold_qty 
           FROM items i 
           WHERE i.name LIKE $1 
           ORDER BY sold_qty DESC, i.name 
           LIMIT 15`;
           
      const params = party ? [`%${q}%`, party.id] : [`%${q}%`];
      const res = await db.select<any[]>(query, params);
      setItemResults(res);
      setShowItemDrop(true);
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
    
    const finalPaid = paidAmount === '' ? net : Number(paidAmount);
    const balanceDue = net - finalPaid;
    const paymentStatus = balanceDue <= 0 ? 'paid' : finalPaid > 0 ? 'partial' : 'unpaid';

    try {
      const db = await getDB();
      const res = await db.execute(
        `INSERT INTO transactions (invoice_no, date, party_id, total_amount, paid_amount, balance_due, type, payment_type, status, challan_no, description) VALUES ($1, $2, $3, $4, $5, $6, 'sale', $7, $8, $9, $10)`,
        [invoiceNo, invoiceDate, party?.id || null, net, finalPaid, balanceDue, paymentType, paymentStatus, challanNo, description]
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
      setParty(null); setPartySearch(''); setPaidAmount(''); setChallanNo(''); setDescription('');
      generateInvoiceNo();
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message}`);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden text-sm">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h2 className="text-xl font-bold text-slate-800">Sale</h2>
        <div className="flex items-center gap-4">
          <kbd className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono">F4 = Add Item</kbd>
          <kbd className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono">Ctrl+S = Save</kbd>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {status && <div className="px-6 py-2 bg-green-50 text-green-700 text-sm font-medium border-b border-green-100">{status}</div>}
        
        {/* Invoice Info Row */}
        <div className="px-6 py-4 grid grid-cols-2 gap-8">
          {/* Left: Party */}
          <div className="flex flex-col gap-4">
            <div className="relative max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={partyInputRef}
                value={partySearch}
                onChange={e => searchParties(e.target.value)}
                onFocus={() => partySearch && setShowPartyDrop(true)}
                placeholder="Search by Name/Phone * (Walk-in)"
                className="w-full pl-8 pr-4 h-10 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm"
              />
              {party && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-brand bg-blue-50 px-2 py-0.5 rounded">{party.name}</span>}
              {showPartyDrop && partyResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-52 overflow-y-auto">
                  {partyResults.map(p => (
                    <button key={p.id} onClick={() => { setParty(p); setPartySearch(p.name); setShowPartyDrop(false); partyInputRef.current?.blur(); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                      <p className="text-sm font-medium text-slate-700">{p.name}</p>
                      <p className="text-xs text-slate-400">Balance: ₹{p.opening_balance}</p>
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
              <input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)}
                className="flex-1 h-8 border-b-2 border-slate-100 focus:border-brand hover:border-slate-200 rounded-none bg-transparent px-1 font-mono focus:outline-none text-slate-700" />
            </div>
            <div className="flex items-center gap-4 w-64">
              <label className="text-slate-500 w-24 text-right">Bill Date</label>
              <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}
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
              placeholder="Search & add item... (F4)"
              className="w-full pl-8 pr-4 h-9 border border-slate-200 rounded text-sm bg-white focus:outline-none focus:border-brand shadow-sm"
            />
          </div>
          {showItemDrop && itemSearch && (
            <div className="absolute top-full left-6 w-[600px] mt-1 bg-white border border-slate-200 rounded shadow-xl z-50 flex flex-col overflow-hidden">
              <div className="max-h-56 overflow-y-auto w-full">
                {itemResults.length > 0 ? (
                  <>
                    <div className="grid grid-cols-4 text-xs text-slate-400 px-4 py-2 border-b bg-slate-50 font-medium uppercase tracking-wide sticky top-0">
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
                <th className="px-2 py-3 text-right w-16">Size</th>
                <th className="px-2 py-3 text-right w-20">Qty</th>
                <th className="px-2 py-3 text-left w-16">Unit</th>
                <th className="px-2 py-3 text-right w-24">Price/Unit</th>
                <th className="px-2 py-3 text-right w-20">Discount%</th>
                <th className="px-2 py-3 text-right w-20">Tax%</th>
                <th className="px-2 py-3 text-right w-24 font-bold">Amount</th>
                <th className="pr-6 pl-2 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((item, idx) => {
                const base = item.price * item.qty;
                const discAmt = base * (item.disc / 100);
                const taxAmt = (base - discAmt) * (item.tax_rate / 100);
                const rowTotal = base - discAmt + taxAmt;
                return (
                  <tr key={item.id} className={`border-b border-slate-100 hover:bg-slate-50 ${activeRow === item.id ? 'bg-blue-50/50' : ''}`}
                    onClick={() => setActiveRow(item.id)}>
                    <td className="pl-6 pr-2 py-2 text-slate-400 font-mono text-xs">{idx + 1}</td>
                    <td className="px-2 py-2">
                       <p className="font-medium text-slate-700">{item.name}</p>
                       <p className="text-[10px] text-slate-400">HSN: {item.hsn || '—'}</p>
                    </td>
                    <td className="px-2 py-2">
                      <input value={item.batch} onChange={e => updateRow(item.id, 'batch', e.target.value)}
                        className="w-full border border-slate-200 rounded px-2 py-1.5 focus:border-brand focus:ring-1 focus:ring-brand outline-none bg-transparent" />
                    </td>
                    <td className="px-2 py-2">
                      <input type="month" value={item.expiry} onChange={e => updateRow(item.id, 'expiry', e.target.value)}
                        className="w-full border border-slate-200 rounded px-1 py-1.5 focus:border-brand focus:ring-1 focus:ring-brand outline-none bg-transparent text-xs" />
                    </td>
                    <td className="px-2 py-2 text-right">
                       <span className="font-mono text-slate-600">₹{item.sale_price}</span>
                    </td>
                    <td className="px-2 py-2 text-right text-slate-400">—</td>
                    <td className="px-2 py-2">
                      <input type="number" min={1} value={item.qty} onChange={e => updateRow(item.id, 'qty', parseInt(e.target.value) || 1)}
                        className="w-full text-right border border-slate-200 rounded px-2 py-1.5 font-medium focus:border-brand focus:ring-1 focus:ring-brand outline-none bg-transparent font-mono" />
                    </td>
                    <td className="px-2 py-2 text-slate-500 uppercase text-xs">{item.unit || 'NONE'}</td>
                    <td className="px-2 py-2">
                      <input type="number" value={item.price} onChange={e => updateRow(item.id, 'price', parseFloat(e.target.value) || 0)}
                        className="w-full text-right border border-slate-200 rounded px-2 py-1.5 font-mono focus:border-brand focus:ring-1 focus:ring-brand outline-none bg-transparent" />
                    </td>
                    <td className="px-2 py-2">
                       <input type="number" min={0} max={100} value={item.disc} onChange={e => updateRow(item.id, 'disc', parseFloat(e.target.value) || 0)}
                        className="w-full text-right border border-slate-200 rounded px-2 py-1.5 focus:border-brand focus:ring-1 focus:ring-brand outline-none bg-transparent" />
                    </td>
                    <td className="px-2 py-2">
                       <input type="number" min={0} value={item.tax_rate} onChange={e => updateRow(item.id, 'tax_rate', parseFloat(e.target.value) || 0)}
                        className="w-full text-right border border-slate-200 rounded px-2 py-1.5 focus:border-brand focus:ring-1 focus:ring-brand outline-none bg-transparent" />
                    </td>
                    <td className="px-2 py-2 text-right font-medium font-mono text-slate-800">
                      {rowTotal.toFixed(2)}
                    </td>
                    <td className="pr-6 pl-2 py-2 text-right">
                      <button onClick={() => removeRow(item.id)} className="w-6 h-6 rounded hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors ml-auto">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Totals Row */}
            {cart.length > 0 && (
              <tfoot className="bg-slate-50 border-t border-b border-slate-200 sticky bottom-0 z-10">
                 <tr>
                   <td colSpan={6} className="px-6 py-3 font-medium text-slate-600">Total</td>
                   <td className="px-2 py-3 text-right font-bold text-slate-700 font-mono">{cart.reduce((s,c)=>s+c.qty, 0)}</td>
                   <td colSpan={4}></td>
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
                       <span className="text-slate-500 mr-2 text-sm">Amount Received</span>
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
               <div className="flex justify-between items-center mb-2">
                 <span className="text-slate-500 font-medium">Rounding off</span>
                 <span className="font-mono text-slate-400">{(net - (afterDiscount + totalTax)).toFixed(2)}</span>
               </div>
               <div className="flex justify-between items-center border-t border-slate-100 pt-2 pb-1">
                 <span className="text-lg font-bold text-slate-800">Total</span>
                 <span className="text-2xl font-bold text-slate-800 font-mono">₹{net.toFixed(2)}</span>
               </div>
               {totalTax > 0 && <div className="text-right text-[10px] text-slate-400">Includes Tax: ₹{totalTax.toFixed(2)}</div>}
             </div>
             
             <div className="flex gap-2 justify-end">
               <button onClick={() => { setCart([]); setParty(null); setPartySearch(''); }}
                 className="px-6 h-10 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors shadow-sm bg-white">
                 Clear
               </button>
               <button onClick={saveSale}
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
