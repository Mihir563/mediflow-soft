'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getDB } from '@/lib/db';
import { Search, Plus, Trash2, ChevronDown } from 'lucide-react';
import ItemModal from '@/components/ItemModal';

interface SaleItemOption {
  id: number;
  name: string;
  hsn?: string;
  unit?: string;
  sale_price?: number;
  purchase_price?: number;
  current_stock?: number;
  discount?: number;
  tax_rate?: number;
}

interface SaleRow {
  rowId: number;
  itemId: number | null;
  name: string;
  hsn: string;
  unit: string;
  sale_price: number;
  purchase_price: number;
  current_stock: number;
  qty: number;
  price: number;
  disc: number;
  tax_rate: number;
  batch: string;
  expiry: string;
}

interface Party {
  id: number;
  name: string;
  phone: string;
  opening_balance: number;
}

const DEFAULT_ROW_COUNT = 5;
const createFallbackInvoiceNo = () => `INV-${Date.now()}`;

const createEmptyRow = (rowId: number): SaleRow => ({
  rowId,
  itemId: null,
  name: '',
  hsn: '',
  unit: '',
  sale_price: 0,
  purchase_price: 0,
  current_stock: 0,
  qty: 1,
  price: 0,
  disc: 0,
  tax_rate: 0,
  batch: '',
  expiry: '',
});

const formatExpiryInput = (value: string) => {
  const parts = value.trim().split(/[^0-9]+/).filter(Boolean);
  if (parts.length < 3) return value;
  const [dayRaw, monthRaw, yearRaw] = parts;
  const day = dayRaw.padStart(2, '0');
  const month = monthRaw.padStart(2, '0');
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw.padStart(4, '0');
  return `${day}-${month}-${year}`;
};

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
  const [cart, setCart] = useState<SaleRow[]>(() =>
    Array.from({ length: DEFAULT_ROW_COUNT }, (_, index) => createEmptyRow(index + 1))
  );
  const [itemResults, setItemResults] = useState<SaleItemOption[]>([]);
  const [showItemDrop, setShowItemDrop] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [itemModalName, setItemModalName] = useState('');
  const [activeRowId, setActiveRowId] = useState<number | null>(1);
  const [status, setStatus] = useState('');
  const rowSeedRef = useRef(DEFAULT_ROW_COUNT + 1);
  const partyInputRef = useRef<HTMLInputElement>(null);
  const itemInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  async function generateInvoiceNo() {
    try {
      const db = await getDB();
      const res = await db.select<Array<{ cnt: number }>>(`SELECT COUNT(*) as cnt FROM transactions WHERE type='sale'`);
      const cnt = (res[0]?.cnt || 0) + 1;
      setInvoiceNo(`INV-${String(cnt).padStart(4, '0')}`);
    } catch {
      setInvoiceNo(createFallbackInvoiceNo());
    }
  }

  function focusRowInput(rowId?: number | null) {
    const targetId = rowId ?? cart.find(row => !row.itemId)?.rowId ?? cart[0]?.rowId ?? null;
    if (!targetId) return;
    setActiveRowId(targetId);
    setTimeout(() => itemInputRefs.current[targetId]?.focus(), 10);
  }

  const searchParties = async (q: string) => {
    setPartySearch(q);
    if (!q.trim()) {
      setPartyResults([]);
      setShowPartyDrop(false);
      return;
    }
    try {
      const db = await getDB();
      const res = await db.select<Party[]>(`SELECT * FROM parties WHERE name LIKE $1 LIMIT 10`, [`%${q}%`]);
      setPartyResults(res);
      setShowPartyDrop(true);
    } catch {}
  };

  const searchItems = async (rowId: number, q: string) => {
    setActiveRowId(rowId);
    setCart(prev => prev.map(row => row.rowId === rowId ? { ...row, name: q } : row));
    if (!q.trim()) {
      setItemResults([]);
      setShowItemDrop(false);
      return;
    }
    try {
      const db = await getDB();
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
      const res = await db.select<SaleItemOption[]>(query, params);
      setItemResults(res);
      setShowItemDrop(true);
    } catch {}
  };

  const updateRow = (rowId: number, field: keyof SaleRow, value: string | number | null) => {
    setCart(prev => prev.map(row => row.rowId === rowId ? { ...row, [field]: value } : row));
  };

  const addEmptyRow = () => {
    const rowId = rowSeedRef.current++;
    setCart(prev => [...prev, createEmptyRow(rowId)]);
    focusRowInput(rowId);
  };

  const applyItemToRow = (rowId: number, item: SaleItemOption) => {
    setCart(prev => prev.map(row => row.rowId === rowId ? {
      ...row,
      itemId: item.id,
      name: item.name,
      hsn: item.hsn || '',
      unit: item.unit || '',
      sale_price: Number(item.sale_price) || 0,
      purchase_price: Number(item.purchase_price) || 0,
      current_stock: Number(item.current_stock) || 0,
      qty: row.itemId === item.id ? row.qty : 1,
      price: Number(item.sale_price) || 0,
      disc: Number(item.discount) || 0,
      tax_rate: Number(item.tax_rate) || 0,
    } : row));
    setItemResults([]);
    setShowItemDrop(false);
  };

  const clearRow = (rowId: number) => {
    setCart(prev => prev.map(row => row.rowId === rowId ? createEmptyRow(row.rowId) : row));
    if (activeRowId === rowId) {
      setItemResults([]);
      setShowItemDrop(false);
    }
  };

  const validRows = useMemo(() => cart.filter(row => row.itemId && row.name.trim()), [cart]);
  const subtotal = validRows.reduce((sum, row) => sum + row.price * row.qty, 0);
  const totalDiscount = validRows.reduce((sum, row) => sum + (row.price * row.qty * (row.disc / 100)), 0);
  const afterDiscount = subtotal - totalDiscount;
  const totalTax = validRows.reduce((sum, row) => {
    const base = row.price * row.qty * (1 - row.disc / 100);
    return sum + base * (row.tax_rate / 100);
  }, 0);
  const net = Math.round(afterDiscount + totalTax);

  async function saveSale() {
    if (validRows.length === 0) {
      setStatus('❌ Add at least one item');
      return;
    }

    const finalPaid = paidAmount === '' ? net : Number(paidAmount);
    const balanceDue = net - finalPaid;
    const paymentStatus = balanceDue <= 0 ? 'paid' : finalPaid > 0 ? 'partial' : 'unpaid';

    try {
      const db = await getDB();
      const res = await db.execute(
        `INSERT INTO transactions (invoice_no, date, party_id, total_amount, paid_amount, balance_due, type, payment_type, status, challan_no, description) VALUES ($1, $2, $3, $4, $5, $6, 'sale', $7, $8, $9, $10)`,
        [invoiceNo, invoiceDate, party?.id || null, net, finalPaid, balanceDue, paymentType, paymentStatus, challanNo, description]
      );
      const txnId = Number((res as { lastInsertId?: number }).lastInsertId);
      for (const row of validRows) {
        const base = row.price * row.qty;
        const discAmt = base * (row.disc / 100);
        const taxAmt = (base - discAmt) * (row.tax_rate / 100);
        const amount = base - discAmt + taxAmt;
        await db.execute(
          `INSERT INTO transaction_items (txn_id, item_id, item_name, quantity, unit, price, discount_pct, discount_amt, tax_pct, tax_amt, amount, batch_no, expiry_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [txnId, row.itemId, row.name, row.qty, row.unit, row.price, row.disc, discAmt, row.tax_rate, taxAmt, amount, row.batch || '', row.expiry || '']
        );
        await db.execute(`UPDATE items SET current_stock = current_stock - $1 WHERE id = $2`, [row.qty, row.itemId]);
      }
      setStatus(`✅ Invoice ${invoiceNo} saved!`);
      setCart(Array.from({ length: DEFAULT_ROW_COUNT }, (_, index) => createEmptyRow(index + 1)));
      rowSeedRef.current = DEFAULT_ROW_COUNT + 1;
      setParty(null);
      setPartySearch('');
      setPaidAmount('');
      setChallanNo('');
      setDescription('');
      setItemResults([]);
      setShowItemDrop(false);
      generateInvoiceNo();
      focusRowInput(1);
    } catch (e: unknown) {
      setStatus(`❌ Error: ${e instanceof Error ? e.message : 'Unable to save sale'}`);
    }
  }

  useEffect(() => {
    partyInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void generateInvoiceNo();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveSale();
      }
      if (e.key === 'F10') {
        e.preventDefault();
        saveSale();
      }
      if (e.key === 'Escape') {
        setShowItemDrop(false);
        setShowPartyDrop(false);
        setShowItemModal(false);
      }
      if (e.key === 'F4') {
        e.preventDefault();
        focusRowInput(activeRowId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeRowId, cart]);

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden text-sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h2 className="text-xl font-bold text-slate-800">Sale</h2>
        <div className="flex items-center gap-4">
          <kbd className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono">F4 = Item Row</kbd>
          <kbd className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono">Ctrl+S = Save</kbd>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col">
        {status && <div className="px-6 py-2 bg-green-50 text-green-700 text-sm font-medium border-b border-green-100">{status}</div>}

        <div className="px-6 py-4 grid grid-cols-2 gap-8">
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
                    <button
                      key={p.id}
                      onClick={() => { setParty(p); setPartySearch(p.name); setShowPartyDrop(false); partyInputRef.current?.blur(); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                    >
                      <p className="text-sm font-medium text-slate-700">{p.name}</p>
                      <p className="text-xs text-slate-400">Balance: ₹{p.opening_balance}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative max-w-sm">
              <input
                value={challanNo}
                onChange={e => setChallanNo(e.target.value)}
                placeholder="Challan / Order Number"
                className="w-full h-10 border border-slate-200 rounded-lg text-sm px-3 bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm"
              />
            </div>
          </div>

          <div className="flex flex-col items-end gap-3 text-sm">
            <div className="flex items-center gap-4 w-64">
              <label className="text-slate-500 w-24 text-right">Bill Number</label>
              <input
                value={invoiceNo}
                onChange={e => setInvoiceNo(e.target.value)}
                className="flex-1 h-8 border-b-2 border-slate-100 focus:border-brand hover:border-slate-200 rounded-none bg-transparent px-1 font-mono focus:outline-none text-slate-700"
              />
            </div>
            <div className="flex items-center gap-4 w-64">
              <label className="text-slate-500 w-24 text-right">Bill Date</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={e => setInvoiceDate(e.target.value)}
                className="flex-1 h-8 border-b-2 border-slate-100 focus:border-brand hover:border-slate-200 rounded-none bg-transparent px-1 focus:outline-none text-slate-700"
              />
            </div>
          </div>
        </div>

        {showItemModal && (
          <ItemModal
            onClose={() => {
              setShowItemModal(false);
              focusRowInput(activeRowId);
            }}
            onSave={(item) => {
              if (activeRowId) applyItemToRow(activeRowId, item);
              setShowItemModal(false);
              focusRowInput(activeRowId);
            }}
            initialName={itemModalName}
          />
        )}

        <div className="flex-1 overflow-x-auto min-h-[250px] border-t border-slate-100">
          <table className="w-full min-w-[1300px] text-sm table-fixed">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr className="text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                <th className="pl-6 pr-2 py-3 text-left w-10">#</th>
                <th className="px-2 py-3 text-left w-[300px]">Item / Description</th>
                <th className="px-2 py-3 text-left w-28">Batch No.</th>
                <th className="px-2 py-3 text-left w-28">Exp. Date</th>
                <th className="px-2 py-3 text-right w-20">MRP</th>
                <th className="px-2 py-3 text-right w-16">Stock</th>
                <th className="px-2 py-3 text-right w-20">Qty</th>
                <th className="px-2 py-3 text-left w-16">Unit</th>
                <th className="px-2 py-3 text-right w-24">Price/Unit</th>
                <th className="px-2 py-3 text-right w-20">Disc%</th>
                <th className="px-2 py-3 text-right w-20">Tax%</th>
                <th className="px-2 py-3 text-right w-24">Amount</th>
                <th className="pr-6 pl-2 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((row, idx) => {
                const base = row.price * row.qty;
                const discAmt = base * (row.disc / 100);
                const taxAmt = (base - discAmt) * (row.tax_rate / 100);
                const amount = row.itemId ? base - discAmt + taxAmt : 0;

                return (
                  <tr key={row.rowId} className="border-b border-slate-100 hover:bg-slate-50/70">
                    <td className="pl-6 pr-2 py-2 text-slate-400 font-mono text-xs align-top">{idx + 1}</td>
                    <td className="px-2 py-2 align-top">
                      <div className="relative">
                        <input
                          ref={node => { itemInputRefs.current[row.rowId] = node; }}
                          value={row.name}
                          onFocus={() => {
                            setActiveRowId(row.rowId);
                            if (row.name.trim()) setShowItemDrop(true);
                          }}
                          onChange={e => searchItems(row.rowId, e.target.value)}
                          placeholder="Type item name"
                          className="w-full h-10 border border-slate-200 rounded-lg px-3 bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                        />
                        <div className="mt-1 text-[10px] text-slate-400">HSN: {row.hsn || '—'}</div>
                        {activeRowId === row.rowId && showItemDrop && row.name.trim() && (
                          <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-[460px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5">
                            <div className="flex bg-slate-50/80 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 backdrop-blur-sm">
                              <span className="flex-1">Item Name</span>
                              <span className="w-16 text-right">Stock</span>
                              <span className="w-20 text-right">MRP</span>
                              <span className="w-16 text-right">Tax</span>
                            </div>
                            <div className="max-h-[280px] overflow-y-auto p-1.5 scrollbar-thin">
                              {itemResults.length > 0 ? itemResults.map(item => (
                                <button
                                  key={item.id}
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={() => applyItemToRow(row.rowId, item)}
                                  className="flex w-full items-center px-3 py-3 text-left rounded-lg hover:bg-blue-50/80 group transition-all"
                                >
                                  <span className="flex-1 truncate font-semibold text-slate-700 group-hover:text-blue-700">{item.name}</span>
                                  <div className="w-16 text-right">
                                    <span className={`text-xs font-bold ${(item.current_stock || 0) <= 0 ? 'text-red-500 bg-red-50 px-1.5 py-0.5 rounded' : 'text-slate-600'}`}>
                                      {item.current_stock || 0}
                                    </span>
                                  </div>
                                  <div className="w-20 text-right">
                                    <span className="text-sm font-mono font-bold text-slate-800">
                                      ₹{Number(item.sale_price || 0).toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="w-16 text-right">
                                    <span className="text-xs text-slate-500">{item.tax_rate || 0}%</span>
                                  </div>
                                </button>
                              )) : (
                                <div className="px-4 py-8 text-center text-sm text-slate-500">
                                  No items found matching &quot;{row.name}&quot;.
                                </div>
                              )}
                            </div>
                            <div className="border-t border-slate-100 bg-slate-50 p-2">
                              <button
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => {
                                  setItemModalName(row.name);
                                  setActiveRowId(row.rowId);
                                  setShowItemDrop(false);
                                  setShowItemModal(true);
                                }}
                                className="flex w-full items-center justify-center gap-2 rounded-lg bg-white border border-slate-200 py-2.5 text-xs font-bold text-brand hover:bg-brand hover:text-white hover:border-brand shadow-sm transition-all"
                              >
                                <Plus size={14} /> Create New Item
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        value={row.batch}
                        onChange={e => updateRow(row.rowId, 'batch', e.target.value)}
                        className="w-full h-10 border border-slate-200 rounded-lg px-3 bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        value={row.expiry}
                        onFocus={() => setActiveRowId(row.rowId)}
                        onChange={e => updateRow(row.rowId, 'expiry', e.target.value)}
                        onBlur={e => updateRow(row.rowId, 'expiry', formatExpiryInput(e.target.value))}
                        placeholder="DD-MM-YYYY"
                        className="w-full h-10 border border-slate-200 rounded-lg px-3 bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    <td className="px-2 py-2 align-top text-right font-mono text-slate-600">
                      <div className="h-10 flex items-center justify-end">₹{row.sale_price || 0}</div>
                    </td>
                    <td className="px-2 py-2 align-top text-right text-slate-500">
                      <div className="h-10 flex items-center justify-end">{row.current_stock || 0}</div>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        type="number"
                        min={1}
                        value={row.qty || ''}
                        onChange={e => updateRow(row.rowId, 'qty', Math.max(1, Number(e.target.value) || 1))}
                        className="w-full h-10 border border-slate-200 rounded-lg px-3 text-right font-mono bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        value={row.unit || ''}
                        onChange={e => updateRow(row.rowId, 'unit', e.target.value)}
                        className="w-full h-10 border border-slate-200 rounded-lg px-3 uppercase bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        type="number"
                        value={row.price || ''}
                        onChange={e => updateRow(row.rowId, 'price', Number(e.target.value) || 0)}
                        className="w-full h-10 border border-slate-200 rounded-lg px-3 text-right font-mono bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={row.disc || ''}
                        onChange={e => updateRow(row.rowId, 'disc', Number(e.target.value) || 0)}
                        className="w-full h-10 border border-slate-200 rounded-lg px-3 text-right font-mono bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        type="number"
                        min={0}
                        value={row.tax_rate || ''}
                        onChange={e => updateRow(row.rowId, 'tax_rate', Number(e.target.value) || 0)}
                        className="w-full h-10 border border-slate-200 rounded-lg px-3 text-right font-mono bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    <td className="px-2 py-2 align-top text-right font-medium font-mono text-slate-800">
                      <div className="h-10 flex items-center justify-end">{amount.toFixed(2)}</div>
                    </td>
                    <td className="pr-6 pl-2 py-2 align-top text-right">
                      <button
                        onClick={() => clearRow(row.rowId)}
                        className="mt-2 ml-auto flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-200 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50 border-t border-b border-slate-200 sticky bottom-0 z-10">
              <tr>
                <td colSpan={6} className="px-6 py-3 font-medium text-slate-600">Total</td>
                <td className="px-2 py-3 text-right font-bold text-slate-700 font-mono">{validRows.reduce((sum, row) => sum + row.qty, 0)}</td>
                <td colSpan={4}></td>
                <td className="px-2 py-3 text-right font-bold text-slate-800 font-mono">{net.toFixed(2)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3">
          <p className="text-sm text-slate-500">Five rows are ready by default. Add more only when needed.</p>
          <button
            onClick={addEmptyRow}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Plus size={16} /> Add Row
          </button>
        </div>

        <div className="bg-slate-50 border-t border-slate-200 p-6 flex justify-between shrink-0">
          <div className="flex gap-8 w-1/2">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <select
                    value={paymentType}
                    onChange={e => setPaymentType(e.target.value as 'cash' | 'credit' | 'upi')}
                    className="appearance-none h-10 pl-4 pr-10 border border-slate-200 rounded-lg bg-white text-sm focus:border-brand focus:ring-1 focus:ring-brand outline-none shadow-sm cursor-pointer"
                  >
                    <option value="cash">Cash</option>
                    <option value="credit">Credit</option>
                    <option value="upi">UPI</option>
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
                {paymentType !== 'credit' && (
                  <div className="flex items-center">
                    <span className="text-slate-500 mr-2 text-sm">Amount Received</span>
                    <input
                      type="number"
                      placeholder={net.toFixed(2)}
                      value={paidAmount}
                      onChange={e => setPaidAmount(e.target.value ? parseFloat(e.target.value) : '')}
                      className="w-24 h-10 border border-slate-200 rounded-lg text-right px-3 font-mono text-sm bg-white focus:border-brand focus:ring-1 focus:ring-brand outline-none shadow-sm"
                    />
                  </div>
                )}
              </div>
              {paymentType !== 'credit' && (net - (paidAmount === '' ? net : Number(paidAmount))) > 0 && (
                <div className="text-sm font-medium text-orange-600">
                  Balance Due: ₹{(net - (paidAmount === '' ? net : Number(paidAmount))).toFixed(2)}
                </div>
              )}
              <div className="w-96">
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Add Description / Notes"
                  className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm resize-none"
                />
              </div>
            </div>
          </div>

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
              <button
                onClick={() => {
                  setCart(Array.from({ length: DEFAULT_ROW_COUNT }, (_, index) => createEmptyRow(index + 1)));
                  rowSeedRef.current = DEFAULT_ROW_COUNT + 1;
                  setParty(null);
                  setPartySearch('');
                  setItemResults([]);
                  setShowItemDrop(false);
                }}
                className="px-6 h-10 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors shadow-sm bg-white"
              >
                Clear
              </button>
              <button
                onClick={saveSale}
                className="px-8 h-10 rounded-lg bg-brand hover:bg-brand-hover text-white font-medium transition-colors shadow-sm flex items-center gap-2"
              >
                Save (Ctrl+S)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
