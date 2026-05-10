'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getDB } from '@/lib/db';
import { Search, Plus, Trash2, ChevronDown, ScanLine, HelpCircle } from 'lucide-react';
import ItemModal from '@/components/ItemModal';
import ScannerPanel from '@/components/ScannerPanel';
import QtyCalculatorModal from '@/components/QtyCalculatorModal';
import BatchModal from '@/components/BatchModal';
import { AppSettings, defaultSettings } from '@/pages/Settings';

interface VendorOption {
  id: number;
  name: string;
  opening_balance?: number;
}

interface ItemOption {
  id: number;
  name: string;
  unit?: string;
  purchase_price?: number;
  sale_price?: number;
  discount?: number;
  tax_rate?: number;
  current_stock?: number;
}

interface PurchaseRow {
  rowId: number;
  itemId: number | null;
  name: string;
  unit: string;
  base_unit: string;
  tabsPerStrip: number | '';
  stripsPerBox: number | '';
  purchase_price: number | '';
  sale_price: number | '';
  qty: number | '';
  free: number | '';
  batch: string;
  expiry: string;
  mrp: number | '';
  price: number | '';
  disc: number | '';
  gst: number | '';
}

const DEFAULT_ROW_COUNT = 5;
const createPurchaseBillNo = () => `PUR-${Date.now().toString().slice(-6)}`;

const createEmptyRow = (rowId: number): PurchaseRow => ({
  rowId,
  itemId: null,
  name: '',
  unit: 'TAB',
  base_unit: 'TAB',
  tabsPerStrip: 10,
  stripsPerBox: 10,
  purchase_price: 0,
  sale_price: 0,
  qty: 1,
  free: 0,
  batch: '',
  expiry: '',
  mrp: 0,
  price: 0,
  disc: 0,
  gst: 0,
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

export default function PurchaseBill() {
  const [vendor, setVendor] = useState<VendorOption | null>(null);
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorResults, setVendorResults] = useState<VendorOption[]>([]);
  const [showVendorDrop, setShowVendorDrop] = useState(false);
  const [selectedVendorIndex, setSelectedVendorIndex] = useState(-1);
  const vendorInputRef = useRef<HTMLInputElement>(null);
  const [billNo, setBillNo] = useState(createPurchaseBillNo);
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [paymentType, setPaymentType] = useState<'cash' | 'credit' | 'upi'>('cash');
  const [challanNo, setChallanNo] = useState('');
  const [description, setDescription] = useState('');
  const [paidAmount, setPaidAmount] = useState<number | ''>('');
  const [cart, setCart] = useState<PurchaseRow[]>(() =>
    Array.from({ length: DEFAULT_ROW_COUNT }, (_, index) => createEmptyRow(index + 1))
  );
  const [itemResults, setItemResults] = useState<ItemOption[]>([]);
  const [showItemDrop, setShowItemDrop] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [itemModalName, setItemModalName] = useState('');
  const [activeRowId, setActiveRowId] = useState<number | null>(1);
  const [status, setStatus] = useState('');
  
  const [selectedItemIndex, setSelectedItemIndex] = useState(-1);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [batchModalRowId, setBatchModalRowId] = useState<number | null>(null);

  const rowSeedRef = useRef(DEFAULT_ROW_COUNT + 1);
  const itemInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const validRows = useMemo(() => cart.filter(row => (row.itemId || row.name.trim()) && (Number(row.qty) || 0) > 0 && (Number(row.price) || 0) > 0), [cart]);
  
  const { subtotal, totalDiscount, totalTax, net, afterDiscount } = useMemo(() => {
    let sub = 0, disc = 0, tax = 0, total = 0;
    validRows.forEach(row => {
      const qtyVal = Number(row.qty) || 0;
      const priceVal = Number(row.price) || 0;
      const discVal = Number(row.disc) || 0;
      const taxVal = Number(row.gst) || 0;
      
      const base = priceVal * qtyVal;
      const discAmt = base * (discVal / 100);
      const taxAmt = (base - discAmt) * (taxVal / 100);
      
      sub += base; disc += discAmt; tax += taxAmt; total += (base - discAmt + taxAmt);
    });
    return { subtotal: sub, totalDiscount: disc, totalTax: tax, net: Math.round(total * 100) / 100, afterDiscount: sub - disc };
  }, [validRows]);

  const focusRowInput = (rowId?: number | null) => {
    const targetId = rowId ?? cart.find(row => !row.itemId)?.rowId ?? cart[0]?.rowId ?? null;
    if (!targetId) return;
    setActiveRowId(targetId);
    setTimeout(() => itemInputRefs.current[targetId]?.focus(), 10);
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const db = await getDB();
        const res = await db.select<{key: string, value: string}[]>('SELECT * FROM app_settings');
        const loaded = { ...defaultSettings };
        res.forEach(r => {
          if (Object.keys(defaultSettings).includes(r.key)) {
            loaded[r.key as keyof AppSettings] = r.value === 'true';
          }
        });
        setSettings(loaded);
      } catch (e) {}
    };
    loadSettings();
  }, []);

  const searchVendors = async (q: string) => {
    setVendorSearch(q);
    if (!q.trim()) {
      setVendorResults([]);
      setShowVendorDrop(false);
      return;
    }
    const db = await getDB();
    const res = await db.select<VendorOption[]>(`SELECT * FROM parties WHERE name LIKE $1 LIMIT 10`, [`%${q}%`]);
    setVendorResults(res);
    setShowVendorDrop(res.length > 0);
  };

  const searchItems = async (rowId: number, q: string) => {
    setActiveRowId(rowId);
    setCart(prev => prev.map(row => row.rowId === rowId ? { ...row, name: q } : row));
    if (!q.trim()) {
      setItemResults([]);
      setShowItemDrop(false);
      return;
    }
    const db = await getDB();
    const res = await db.select<ItemOption[]>(`SELECT * FROM items WHERE name LIKE $1 ORDER BY name LIMIT 15`, [`%${q}%`]);
    setItemResults(res);
    setSelectedItemIndex(-1);
    setShowItemDrop(true);
  };

  const updateRow = (rowId: number, field: keyof PurchaseRow, value: string | number | null) => {
    setCart(prev => prev.map(row => row.rowId === rowId ? { ...row, [field]: value } : row));
  };

  const getMultiplier = (unit: string, baseUnit: string, tabsPerStrip: number, stripsPerBox: number) => {
    if (unit === baseUnit) return 1;
    if (baseUnit === 'TAB') {
      if (unit === 'STRIP') return tabsPerStrip;
      if (unit === 'BOX') return tabsPerStrip * stripsPerBox;
    }
    if (baseUnit === 'STRIP') {
      if (unit === 'TAB') return 1 / (tabsPerStrip || 1);
      if (unit === 'BOX') return stripsPerBox;
    }
    if (baseUnit === 'BOX') {
      if (unit === 'STRIP') return 1 / (stripsPerBox || 1);
      if (unit === 'TAB') return 1 / ((tabsPerStrip || 1) * (stripsPerBox || 1));
    }
    return 1;
  };

  const handleUnitChange = (rowId: number, newUnit: string) => {
    setCart(prev => prev.map(row => {
      if (row.rowId !== rowId) return row;
      const oldMulti = getMultiplier(row.unit, row.base_unit, Number(row.tabsPerStrip) || 1, Number(row.stripsPerBox) || 1);
      const newMulti = getMultiplier(newUnit, row.base_unit, Number(row.tabsPerStrip) || 1, Number(row.stripsPerBox) || 1);
      const scale = newMulti / oldMulti;
      return {
        ...row,
        unit: newUnit,
        price: Number(((Number(row.price) || 0) * scale).toFixed(2)),
        mrp: Number(((Number(row.mrp) || 0) * scale).toFixed(2)),
        purchase_price: Number(((Number(row.purchase_price) || 0) * scale).toFixed(2)),
        sale_price: Number(((Number(row.sale_price) || 0) * scale).toFixed(2)),
      };
    }));
  };

  const addEmptyRow = () => {
    const rowId = rowSeedRef.current++;
    setCart(prev => [...prev, createEmptyRow(rowId)]);
    focusRowInput(rowId);
  };

  const applyItemToRow = (rowId: number, item: ItemOption) => {
    setCart(prev => prev.map(row => row.rowId === rowId ? {
      ...row,
      itemId: item.id,
      name: item.name,
      unit: item.unit || 'TAB',
      base_unit: item.unit || 'TAB',
      purchase_price: Number(item.purchase_price) || 0,
      sale_price: Number(item.sale_price) || 0,
      qty: 1,
      free: 0,
      mrp: Number(item.sale_price) || 0,
      price: Number(item.purchase_price) || 0,
      disc: Number(item.discount) || 0,
      gst: Number(item.tax_rate) || 0,
    } : row));
    setItemResults([]);
    setShowItemDrop(false);
    
    setTimeout(() => {
        setCart(currentCart => {
            const idx = currentCart.findIndex(r => r.rowId === rowId);
            if (idx === currentCart.length - 1 && currentCart[idx].itemId) {
                const newRowId = rowSeedRef.current++;
                focusRowInput(newRowId);
                return [...currentCart, createEmptyRow(newRowId)];
            } else if (idx < currentCart.length - 1) {
                focusRowInput(currentCart[idx + 1].rowId);
            }
            return currentCart;
        });
    }, 50);
  };

  const clearRow = (rowId: number) => {
    setCart(prev => prev.map(row => row.rowId === rowId ? createEmptyRow(row.rowId) : row));
    if (activeRowId === rowId) {
      setItemResults([]);
      setShowItemDrop(false);
    }
  };

  async function savePurchase() {
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
        `INSERT INTO transactions (invoice_no, date, party_id, total_amount, paid_amount, balance_due, type, payment_type, status, challan_no, description) VALUES ($1,$2,$3,$4,$5,$6,'purchase',$7,$8,$9,$10)`,
        [billNo, billDate, vendor?.id || null, net, finalPaid, balanceDue, paymentType, paymentStatus, challanNo, description]
      );
      const txnId = Number((res as { lastInsertId?: number }).lastInsertId);
      for (const row of validRows) {
        const qtyVal = Number(row.qty) || 0;
        const stripsPerBoxVal = Number(row.stripsPerBox) || 1;
        const tabsPerStripVal = Number(row.tabsPerStrip) || 1;
        const priceVal = Number(row.price) || 0;
        const mrpVal = Number(row.mrp) || 0;
        const discVal = Number(row.disc) || 0;
        const gstVal = Number(row.gst) || 0;

        let inventoryQty = qtyVal;
        let scaleDown = 1;
        if (row.unit === 'BOX') {
           scaleDown = stripsPerBoxVal * tabsPerStripVal;
        } else if (row.unit === 'STRIP') {
           scaleDown = tabsPerStripVal;
        }
        inventoryQty = qtyVal * scaleDown;

        const basePurchasePrice = priceVal / scaleDown;
        const baseSalePrice = mrpVal / scaleDown;

        await db.execute(
          `INSERT INTO transaction_items (txn_id, item_id, item_name, quantity, price, discount_pct, tax_pct, amount, batch_no, expiry_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [txnId, row.itemId, row.name, qtyVal, priceVal, discVal, gstVal, priceVal * qtyVal, row.batch, row.expiry]
        );
        await db.execute(
          `UPDATE items SET current_stock = current_stock + $1, purchase_price = $2, sale_price = $3, tabs_per_strip = $4, strips_per_box = $5, unit = 'TAB' WHERE id = $6`,
          [inventoryQty, basePurchasePrice, baseSalePrice, tabsPerStripVal, stripsPerBoxVal, row.itemId]
        );
      }
      setStatus(`✅ Purchase ${billNo} saved!`);
      setCart(Array.from({ length: DEFAULT_ROW_COUNT }, (_, index) => createEmptyRow(index + 1)));
      rowSeedRef.current = DEFAULT_ROW_COUNT + 1;
      setVendor(null);
      setVendorSearch('');
      setPaidAmount('');
      setChallanNo('');
      setDescription('');
      setItemResults([]);
      setShowItemDrop(false);
      setBillNo(createPurchaseBillNo());
      focusRowInput(1);
    } catch (e: unknown) {
      setStatus(`❌ ${e instanceof Error ? e.message : 'Unable to save purchase'}`);
    }
  }

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        savePurchase();
      }
      if (e.key === 'F10') {
        e.preventDefault();
        savePurchase();
      }
      if (e.key === 'Escape') {
        setShowItemDrop(false);
        setShowVendorDrop(false);
        setShowItemModal(false);
      }
      if (e.key === 'F4') {
        e.preventDefault();
        focusRowInput(activeRowId);
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [activeRowId, cart]);

  const handleFieldArrow = (e: React.KeyboardEvent, rowId: number, field: string) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = cart.findIndex(r => r.rowId === rowId);
      const targetIdx = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
      if (targetIdx >= 0 && targetIdx < cart.length) {
        const targetRowId = cart[targetIdx].rowId;
        const el = document.querySelector(`[data-row="${targetRowId}"][data-field="${field}"]`) as HTMLElement;
        el?.focus();
      }
    }
  };

  const HeaderTip = ({ label, tip }: { label: string; tip: React.ReactNode }) => (
    <span className="inline-flex items-center gap-0.5">
      {label}
      <span className="relative group cursor-help">
        <HelpCircle size={10} className="text-slate-400 hover:text-brand transition-colors" />
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 invisible opacity-0 group-hover:visible group-hover:opacity-100 bg-slate-800 text-white text-[11px] px-3 py-2 rounded-lg shadow-xl z-50 font-normal normal-case tracking-normal transition-all duration-200 pointer-events-none min-w-[160px] text-left leading-relaxed">
          {tip}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-[5px] border-transparent border-t-slate-800"></span>
        </span>
      </span>
    </span>
  );

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden text-sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h2 className="text-xl font-bold text-slate-800">Purchase</h2>
        <div className="flex items-center gap-4">
          <button onClick={() => setShowScanner(true)} className="flex items-center gap-2 text-xs bg-brand/10 text-brand px-3 py-1.5 rounded-lg font-bold hover:bg-brand hover:text-white transition-colors">
            <ScanLine size={14} /> Mobile Scanner
          </button>
          <kbd className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono">F4 = Item Row</kbd>
          <kbd className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono">Ctrl+S = Save</kbd>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col">
        {status && <div className="px-6 py-2 bg-blue-50 text-brand text-sm font-medium border-b border-blue-100">{status}</div>}

        <div className="px-6 py-4 grid grid-cols-2 gap-8">
          <div className="flex flex-col gap-4">
            <div className="relative max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="vendorSearch"
                ref={vendorInputRef}
                value={vendorSearch}
                onChange={e => { searchVendors(e.target.value); setSelectedVendorIndex(-1); }}
                onFocus={() => vendorSearch && setShowVendorDrop(true)}
                onKeyDown={(e) => {
                  if (showVendorDrop && vendorResults.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSelectedVendorIndex(prev => (prev < vendorResults.length - 1 ? prev + 1 : prev));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSelectedVendorIndex(prev => (prev > 0 ? prev - 1 : 0));
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (selectedVendorIndex >= 0 && selectedVendorIndex < vendorResults.length) {
                        const v = vendorResults[selectedVendorIndex];
                        setVendor(v); setVendorSearch(v.name); setShowVendorDrop(false);
                        setTimeout(() => document.getElementById('billNo')?.focus(), 0);
                      } else if (vendorResults.length > 0) {
                        const v = vendorResults[0];
                        setVendor(v); setVendorSearch(v.name); setShowVendorDrop(false);
                        setTimeout(() => document.getElementById('billNo')?.focus(), 0);
                      }
                    } else if (e.key === 'Escape') {
                      setShowVendorDrop(false);
                    }
                  } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    document.getElementById('billNo')?.focus();
                  }
                }}
                placeholder="Search Supplier by Name/Phone *"
                autoFocus
                className="w-full pl-8 pr-4 h-10 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm"
              />
              {vendor && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-brand bg-blue-50 px-2 py-0.5 rounded">{vendor.name}</span>}
              {showVendorDrop && vendorResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-52 overflow-y-auto">
                  {vendorResults.map((v, idx) => (
                    <button
                      key={v.id}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { 
                        setVendor(v); setVendorSearch(v.name); setShowVendorDrop(false); 
                        setTimeout(() => document.getElementById('billNo')?.focus(), 0);
                      }}
                      className={`w-full text-left px-4 py-2.5 border-b border-slate-100 last:border-0 ${idx === selectedVendorIndex ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                    >
                      <p className="text-sm font-medium text-slate-700">{v.name}</p>
                      <p className="text-xs text-slate-400">Balance: ₹{v.opening_balance}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-3 text-sm">
            <div className="flex items-center gap-4 w-64">
              <label className="text-slate-500 w-24 text-right">Bill Number</label>
              <input
                id="billNo"
                value={billNo}
                onChange={e => setBillNo(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown' || e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('billDate')?.focus();
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    document.getElementById('vendorSearch')?.focus();
                  }
                }}
                className="flex-1 h-8 border-b-2 border-slate-100 focus:border-brand hover:border-slate-200 rounded-none bg-transparent px-1 font-mono focus:outline-none text-slate-700"
              />
            </div>
            <div className="flex items-center gap-4 w-64">
              <label className="text-slate-500 w-24 text-right">Bill Date</label>
              <input
                id="billDate"
                type="date"
                value={billDate}
                onChange={e => setBillDate(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown' || e.key === 'Enter') {
                    e.preventDefault();
                    const el = document.querySelector('[data-row="1"][data-field="name"]') as HTMLElement;
                    if (el) el.focus();
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    document.getElementById('billNo')?.focus();
                  }
                }}
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
          <table className="w-full min-w-[1100px] text-sm table-fixed">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr className="text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                <th className="pl-4 pr-1 py-2 text-left w-8">#</th>
                <th className="px-1 py-2 text-left w-[220px]"><HeaderTip label="Item" tip={<><b>Item / Description</b><br/>દવાનું નામ અથવા વર્ણન.<br/><span className="text-slate-300">Search and select the medicine.</span></>} /></th>
                {settings.show_batch && <th className="px-1 py-2 text-left w-24"><HeaderTip label="Batch" tip={<><b>Batch Number</b><br/>બેચ નંબર.<br/><span className="text-slate-300">Must match the physical stock.</span></>} /></th>}
                {settings.show_expiry && <th className="px-1 py-2 text-left w-24"><HeaderTip label="Exp." tip={<><b>Expiry Date</b><br/>એક્સપાયરી તારીખ.<br/><span className="text-slate-300">Format: DD-MM-YYYY</span></>} /></th>}
                {settings.show_mrp && <th className="px-1 py-2 text-right w-16"><HeaderTip label="MRP" tip={<><b>Max Retail Price</b><br/>મહત્તમ છૂટક કિંમત.<br/><span className="text-slate-300">Printed price on the package.</span></>} /></th>}
                <th className="px-1 py-2 text-right w-14"><HeaderTip label="Qty" tip={<><b>Quantity</b><br/>જથ્થો / નંગ.<br/><span className="text-slate-300">Units being purchased.</span></>} /></th>
                <th className="px-1 py-2 text-right w-12"><HeaderTip label="Free" tip={<><b>Free Quantity</b><br/>મફત જથ્થો.<br/><span className="text-slate-300">Items received for free.</span></>} /></th>
                <th className="px-1 py-2 text-left w-18"><HeaderTip label="Unit" tip={<><b>Unit Type</b><br/>એકમ.<br/><span className="text-slate-300">Buying unit (TAB/STRIP/BOX).</span></>} /></th>
                <th className="px-1 py-2 text-right w-12"><HeaderTip label="T/S" tip={<><b>Tabs per Strip</b><br/>એક સ્ટ્રિપમાં કેટલી ટેબલેટ.<br/><span className="text-slate-300">Conversion rate.</span></>} /></th>
                <th className="px-1 py-2 text-right w-12"><HeaderTip label="S/B" tip={<><b>Strips per Box</b><br/>એક બોક્સમાં કેટલી સ્ટ્રિપ.<br/><span className="text-slate-300">Conversion rate.</span></>} /></th>
                {settings.show_tax && <th className="px-1 py-2 text-right w-14"><HeaderTip label="GST%" tip={<><b>GST Percentage</b><br/>જીએસટી ટકાવારી.<br/><span className="text-slate-300">Tax applied to this item.</span></>} /></th>}
                <th className="px-1 py-2 text-right w-14"><HeaderTip label="Disc%" tip={<><b>Discount Percentage</b><br/>ડિસ્કાઉન્ટ ટકાવારી.<br/><span className="text-slate-300">Discount from supplier.</span></>} /></th>
                <th className="px-1 py-2 text-right w-20"><HeaderTip label="Price ₹" tip={<><b>Purchase Price</b><br/>ખરીદી કિંમત.<br/><span className="text-slate-300">Base price before tax/disc.</span></>} /></th>
                <th className="px-1 py-2 text-right w-20"><HeaderTip label="Amount" tip={<><b>Total Amount</b><br/>કુલ રકમ.<br/><span className="font-mono text-[10px] text-green-300 mt-1 block tracking-tight">Qty × Price - Disc + GST</span></>} /></th>
                <th className="pr-4 pl-1 py-2 w-8"></th>
              </tr>
            </thead>

            <tbody>
              {cart.map((row, idx) => {
                const qtyVal = Number(row.qty) || 0;
                const priceVal = Number(row.price) || 0;
                const discVal = Number(row.disc) || 0;
                const taxVal = Number(row.gst) || 0;
                
                const rowBase = priceVal * qtyVal;
                const rowDisc = rowBase * (discVal / 100);
                const rowTax = (rowBase - rowDisc) * (taxVal / 100);
                const rowAmount = rowBase - rowDisc + rowTax;

                return (
                  <React.Fragment key={row.rowId}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50/70">
                    <td className="pl-4 pr-1 py-1 text-slate-400 font-mono text-xs align-top">{idx + 1}</td>
                    <td className="px-1 py-1 align-top">
                      <div className="relative">
                          <input
                            data-row={row.rowId} data-field="name"
                            ref={node => { itemInputRefs.current[row.rowId] = node; }}
                            value={row.name}
                            onFocus={() => {
                              setActiveRowId(row.rowId);
                              if (row.name.trim() && !row.itemId) setShowItemDrop(true);
                            }}
                            onBlur={() => setShowItemDrop(false)}
                            onKeyDown={(e) => {
                              if (activeRowId === row.rowId && showItemDrop && itemResults.length > 0) {
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  setSelectedItemIndex(prev => (prev < itemResults.length - 1 ? prev + 1 : prev));
                                } else if (e.key === 'ArrowUp') {
                                  e.preventDefault();
                                  setSelectedItemIndex(prev => (prev > 0 ? prev - 1 : 0));
                                } else if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (selectedItemIndex >= 0 && selectedItemIndex < itemResults.length) {
                                    applyItemToRow(row.rowId, itemResults[selectedItemIndex]);
                                  } else if (itemResults.length > 0) {
                                    applyItemToRow(row.rowId, itemResults[0]);
                                  }
                                } else if (e.key === 'Escape') {
                                  setShowItemDrop(false);
                                }
                              } else if (e.key === 'Enter' && !showItemDrop) {
                                  const nextIdx = cart.findIndex(r => r.rowId === row.rowId) + 1;
                                  if (nextIdx < cart.length) focusRowInput(cart[nextIdx].rowId);
                                  else addEmptyRow();
                              } else {
                                handleFieldArrow(e, row.rowId, 'name');
                              }
                            }}
                            onChange={e => searchItems(row.rowId, e.target.value)}
                            placeholder="Type item name"
                            className="w-full h-8 border border-slate-200 rounded-md px-2 text-sm bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                          />
                          {activeRowId === row.rowId && showItemDrop && row.name.trim() && (
                            <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-[420px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5">
                              <div className="flex bg-slate-50/80 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 backdrop-blur-sm">
                                <span className="flex-1">Item Name</span>
                                <span className="w-16 text-right">Stock</span>
                                <span className="w-24 text-right">Purchase Price</span>
                              </div>
                              <div className="max-h-[280px] overflow-y-auto p-1.5 scrollbar-thin">
                                {itemResults.length > 0 ? itemResults.map((item, iIndex) => (
                                  <button
                                    key={item.id}
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => {
                                      applyItemToRow(row.rowId, item);
                                    }}
                                    className={`flex w-full items-center px-3 py-3 text-left rounded-lg group transition-all ${
                                        selectedItemIndex === iIndex ? 'bg-blue-100 ring-2 ring-brand ring-inset' : 'hover:bg-blue-50/80'
                                    }`}
                                  >
                                    <span className="flex-1 truncate font-semibold text-slate-700 group-hover:text-blue-700">{item.name}</span>
                                    <div className="w-16 text-right">
                                      <span className={`text-xs font-bold ${item.current_stock && item.current_stock <= 0 ? 'text-red-500 bg-red-50 px-1.5 py-0.5 rounded' : 'text-slate-600'}`}>
                                        {item.current_stock || 0}
                                      </span>
                                    </div>
                                    <div className="w-24 text-right">
                                      <span className="text-sm font-mono font-bold text-slate-800">
                                        ₹{Number(item.purchase_price || 0).toFixed(2)}
                                      </span>
                                    </div>
                                  </button>
                              )) : (
                                <div className="px-4 py-8 text-center text-sm text-slate-500">
                                  No items found matching "{row.name}".
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
                    {settings.show_batch && (
                      <td className="px-1 py-1 align-top">
                        <button
                          onClick={() => { if (row.itemId) { setActiveRowId(row.rowId); setBatchModalRowId(row.rowId); } }}
                          className={`w-full h-8 border rounded-md px-2 text-xs text-left truncate transition-colors ${
                            row.batch ? 'border-slate-200 bg-white font-mono font-semibold text-slate-700' : 'border-dashed border-slate-300 bg-slate-50 text-slate-400'
                          } hover:border-brand hover:bg-brand/5 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand`}
                          title={row.itemId ? 'Click to manage batches' : 'Select an item first'}
                        >
                          {row.batch || (row.itemId ? '+ Batch' : '—')}
                        </button>
                      </td>
                    )}
                    {settings.show_expiry && (
                      <td className="px-1 py-1 align-top">
                        <input
                          value={row.expiry}
                          onFocus={() => setActiveRowId(row.rowId)}
                          onChange={e => updateRow(row.rowId, 'expiry', e.target.value)}
                          onBlur={e => updateRow(row.rowId, 'expiry', formatExpiryInput(e.target.value))}
                          placeholder="DD-MM-YYYY"
                          className="w-full h-8 border border-slate-200 rounded-md px-2 text-xs bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                        />
                      </td>
                    )}
                    {settings.show_mrp && (
                      <td className="px-1 py-1 align-top">
                        <input
                          type="text"
                          value={row.mrp}
                          onChange={e => {
                            const val = e.target.value;
                            updateRow(row.rowId, 'mrp', val === '' ? '' : Number(val));
                          }}
                          className="w-full h-8 border border-slate-200 rounded-md px-2 text-right font-mono text-xs bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                        />
                      </td>
                    )}
                    <td className="px-1 py-1 align-top">
                      <input
                        type="text"
                        data-row={row.rowId} data-field="qty"
                        value={row.qty}
                        onChange={e => {
                          const val = e.target.value;
                          updateRow(row.rowId, 'qty', val === '' ? '' : Number(val));
                        }}
                        onKeyDown={e => handleFieldArrow(e, row.rowId, 'qty')}
                        className="w-full h-8 border border-slate-200 rounded-md px-2 text-right font-mono text-xs bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    <td className="px-1 py-1 align-top">
                      <input
                        type="text"
                        data-row={row.rowId} data-field="free"
                        value={row.free}
                        onChange={e => {
                          const val = e.target.value;
                          updateRow(row.rowId, 'free', val === '' ? '' : Number(val));
                        }}
                        onKeyDown={e => handleFieldArrow(e, row.rowId, 'free')}
                        className="w-full h-8 border border-slate-200 rounded-md px-2 text-right font-mono text-xs bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    <td className="px-1 py-1 align-top">
                      <select
                        value={row.unit || 'TAB'}
                        onChange={e => handleUnitChange(row.rowId, e.target.value)}
                        className="w-full h-8 border border-slate-200 rounded-md px-1 bg-slate-50 text-xs font-bold text-slate-600 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      >
                        <option value="BOX">BOX</option>
                        <option value="STRIP">STRIP</option>
                        <option value="TAB">TAB</option>
                        <option value="PCS">PCS</option>
                        <option value="BTL">BTL</option>
                      </select>
                    </td>
                    <td className="px-1 py-1 align-top">
                      <input
                        type="text"
                        value={row.tabsPerStrip}
                        onChange={e => {
                          const val = e.target.value;
                          updateRow(row.rowId, 'tabsPerStrip', val === '' ? '' : Number(val));
                        }}
                        className="w-full h-8 border border-slate-200 rounded-md px-1 text-center font-mono text-xs bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    <td className="px-1 py-1 align-top">
                      <input
                        type="text"
                        value={row.stripsPerBox}
                        onChange={e => {
                          const val = e.target.value;
                          updateRow(row.rowId, 'stripsPerBox', val === '' ? '' : Number(val));
                        }}
                        className="w-full h-8 border border-slate-200 rounded-md px-1 text-center font-mono text-xs bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    {settings.show_tax && (
                      <td className="px-1 py-1 align-top">
                        <input
                          type="text"
                          value={row.gst}
                          onChange={e => {
                            const val = e.target.value;
                            updateRow(row.rowId, 'gst', val === '' ? '' : Number(val));
                          }}
                          className="w-full h-8 border border-slate-200 rounded-md px-2 text-right font-mono text-xs bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                        />
                      </td>
                    )}
                    <td className="px-1 py-1 align-top">
                      <input
                        type="text"
                        data-row={row.rowId} data-field="disc"
                        value={row.disc}
                        onChange={e => {
                          const val = e.target.value;
                          updateRow(row.rowId, 'disc', val === '' ? '' : Number(val));
                        }}
                        onKeyDown={e => handleFieldArrow(e, row.rowId, 'disc')}
                        className="w-full h-8 border border-slate-200 rounded-md px-2 text-right font-mono text-xs bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    <td className="px-1 py-1 align-top">
                      <input
                        type="text"
                        data-row={row.rowId} data-field="price"
                        value={row.price}
                        onChange={e => {
                          const val = e.target.value;
                          updateRow(row.rowId, 'price', val === '' ? '' : Number(val));
                        }}
                        onKeyDown={e => handleFieldArrow(e, row.rowId, 'price')}
                        className="w-full h-8 border border-slate-200 rounded-md px-2 text-right font-mono text-xs bg-white focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                      />
                    </td>
                    <td className="px-1 py-1 align-top text-right font-medium font-mono text-slate-800">
                      <div className="h-8 flex items-center justify-end text-xs">{rowAmount.toFixed(2)}</div>
                    </td>
                    <td className="pr-4 pl-1 py-1 align-top text-right">
                      <button
                        onClick={() => clearRow(row.rowId)}
                        className="mt-1 ml-auto flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-200 hover:text-red-500"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
            <tfoot className="bg-slate-50 border-t border-b border-slate-200 sticky bottom-0 z-10">
              <tr>
                <td colSpan={2} className="px-4 py-2">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={addEmptyRow}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      <Plus size={14} /> Add Row
                    </button>
                    <span className="font-medium text-slate-600">Total</span>
                  </div>
                </td>
                <td colSpan={(settings.show_batch ? 1 : 0) + (settings.show_expiry ? 1 : 0) + (settings.show_mrp ? 1 : 0)}></td>
                <td className="px-1 py-2 text-right font-bold text-slate-700 font-mono text-xs">{validRows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0)}</td>
                <td colSpan={4 + (settings.show_tax ? 1 : 0)}></td>
                <td className="px-1 py-2 text-right font-bold text-slate-800 font-mono text-xs">{net.toFixed(2)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
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
                    <span className="text-slate-500 mr-2 text-sm">Amount Paid</span>
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
                <span className="text-lg font-bold text-slate-800">Total Purchase</span>
                <span className="text-2xl font-bold text-slate-800 font-mono">₹{net.toFixed(2)}</span>
              </div>
              {totalTax > 0 && <div className="text-right text-[10px] text-slate-400">Includes Tax: ₹{totalTax.toFixed(2)}</div>}
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setCart(Array.from({ length: DEFAULT_ROW_COUNT }, (_, index) => createEmptyRow(index + 1)));
                  rowSeedRef.current = DEFAULT_ROW_COUNT + 1;
                  setVendor(null);
                  setVendorSearch('');
                  setItemResults([]);
                  setShowItemDrop(false);
                  setBillNo(createPurchaseBillNo());
                }}
                className="px-6 h-10 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors shadow-sm bg-white"
              >
                Clear
              </button>
              <button
                onClick={savePurchase}
                className="px-8 h-10 rounded-lg bg-brand hover:bg-brand-hover text-white font-medium transition-colors shadow-sm flex items-center gap-2"
              >
                Save (Ctrl+S)
              </button>
            </div>
          </div>
        </div>
      </div>
      {showScanner && (
        <ScannerPanel 
          onClose={() => setShowScanner(false)} 
          onAutoFill={(items) => {
            const newCart = [...cart];
            let targetIdx = newCart.findIndex(r => !r.itemId);
            if (targetIdx === -1) targetIdx = newCart.length;
            
            items.forEach((it, i) => {
              const rowId = rowSeedRef.current++;
              const insertIdx = targetIdx + i;
              const row: PurchaseRow = {
                rowId,
                itemId: it.id,
                name: it.name,
                unit: it.unit || 'TAB',
                base_unit: it.unit || 'TAB',
                tabsPerStrip: 10,
                stripsPerBox: 10,
                purchase_price: Number(it.purchase_price) || 0,
                sale_price: Number(it.sale_price) || 0,
                qty: it.qty_extracted || 1,
                free: 0,
                batch: '',
                expiry: '',
                mrp: Number(it.sale_price) || 0,
                price: Number(it.purchase_price) || 0,
                disc: Number(it.discount) || 0,
                gst: Number(it.tax_rate) || 0,
              };
              if (insertIdx < newCart.length && !newCart[insertIdx].itemId) {
                 newCart[insertIdx] = row;
                 newCart[insertIdx].rowId = cart[insertIdx].rowId;
                 rowSeedRef.current--;
              } else {
                 newCart.splice(insertIdx, 0, row);
              }
            });
            setCart(newCart);
            setShowScanner(false);
          }}
        />
      )}
      {batchModalRowId !== null && (() => {
        const batchRow = cart.find(r => r.rowId === batchModalRowId);
        if (!batchRow?.itemId) return null;
        return (
          <BatchModal
            itemId={batchRow.itemId}
            itemName={batchRow.name}
            onClose={() => setBatchModalRowId(null)}
            onSelect={(batch, expiry, qty) => {
              setCart(prev => prev.map(r => r.rowId === batchModalRowId ? { ...r, batch, expiry, ...(qty > 0 ? { qty } : {}) } : r));
              setBatchModalRowId(null);
            }}
          />
        );
      })()}
    </div>
  );
}
