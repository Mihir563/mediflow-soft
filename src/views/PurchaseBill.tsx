'use client';
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getDB } from '@/lib/db';
import { Search, Plus, Trash2, ChevronDown, ScanLine, HelpCircle, Edit3 } from 'lucide-react';
import ItemModal from '@/components/ItemModal';
import ScannerPanel, { GeminiBillData } from '@/components/ScannerPanel';
import QtyCalculatorModal from '@/components/QtyCalculatorModal';
import BatchModal from '@/components/BatchModal';
import { AppSettings, defaultSettings, getFyStartMonth, getFyBounds } from '@/views/Settings';
import SmartDateInput from '@/components/SmartDateInput';
import SmartExpiryInput from '@/components/SmartExpiryInput';
import { useAuth } from '@/lib/AuthContext';
import { syncTransactionToCloud } from '@/lib/supabaseSyncHelper';

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
  tabsPerStrip: string | number | '';
  stripsPerBox: string | number | '';
  purchase_price: string | number | '';
  sale_price: string | number | '';
  qty: string | number | '';
  free: string | number | '';
  batch: string;
  expiry: string;
  mrp: string | number | '';
  price: string | number | '';
  disc: string | number | '';
  gst: string | number | '';
  scheme_amount: string | number | '';
}

const DEFAULT_ROW_COUNT = 10;
const createPurchaseBillNo = () => `PUR-${Date.now().toString().slice(-6)}`;

// Draft persistence key — unique per tab so multiple tabs don't interfere
const getDraftKey = (tabId?: string) => `purchase_draft_${tabId || 'default'}`;

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
  scheme_amount: '',
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

export default function PurchaseBill({ editTxnId, onSaved, tabId, onLabelChange }: { editTxnId?: number | null; onSaved?: () => void; tabId?: string; onLabelChange?: (label: string, isDirty: boolean) => void } = {}) {
  const DRAFT_KEY = getDraftKey(tabId);
  const { activeStore, isOnline } = useAuth();
  const [vendor, setVendor] = useState<VendorOption | null>(null);
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorResults, setVendorResults] = useState<VendorOption[]>([]);
  const [showVendorDrop, setShowVendorDrop] = useState(false);
  const [selectedVendorIndex, setSelectedVendorIndex] = useState(-1);
  const vendorInputRef = useRef<HTMLInputElement>(null);
  const [billNo, setBillNo] = useState(createPurchaseBillNo);
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [paymentType, setPaymentType] = useState<'cash' | 'credit' | 'upi'>('credit');
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
  const [fyStartMonth, setFyStartMonth] = useState(4); // default April, loaded from settings
  const [draftRestored, setDraftRestored] = useState(false);

  const rowSeedRef = useRef(DEFAULT_ROW_COUNT + 1);
  const itemInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const [isEditMode, setIsEditMode] = useState(false);
  const [editTxnDbId, setEditTxnDbId] = useState<number | null>(null);
  // Ref to always have the latest savePurchase without stale closures in event listeners
  const savePurchaseRef = useRef<() => void>(() => {});

  const validRows = useMemo(() => cart.filter(row => (row.itemId || row.name.trim()) && (Number(row.qty) || 0) > 0 && (Number(row.price) || 0) > 0), [cart]);
  
  const { subtotal, totalDiscount, totalTax, net, afterDiscount } = useMemo(() => {
    let sub = 0, disc = 0, tax = 0, total = 0;
    validRows.forEach(row => {
      const qtyVal = Number(row.qty) || 0;
      const priceVal = Number(row.price) || 0;
      const discVal = Number(row.disc) || 0;
      const taxVal = Number(row.gst) || 0;
      const schemeVal = Number(row.scheme_amount) || 0;
      
      const base = priceVal * qtyVal;
      const discAmt = base * (discVal / 100);
      const taxable = Math.max(0, base - discAmt - schemeVal);
      const taxAmt = taxable * (taxVal / 100);
      
      sub += base;
      disc += (discAmt + schemeVal);
      tax += taxAmt;
      total += (taxable + taxAmt);
    });
    return { subtotal: sub, totalDiscount: disc, totalTax: tax, net: Math.round(total), afterDiscount: sub - disc };
  }, [validRows]);

  const focusRowInput = (rowId?: number | null) => {
    const targetId = rowId ?? cart.find(row => !row.itemId)?.rowId ?? cart[0]?.rowId ?? null;
    if (!targetId) return;
    setActiveRowId(targetId);
    setTimeout(() => itemInputRefs.current[targetId]?.focus(), 10);
  };

  // Load existing transaction for editing
  useEffect(() => {
    if (!editTxnId) return;
    const loadExistingTransaction = async () => {
      try {
        const db = await getDB();
        const [txn] = await db.select<any[]>(
          `SELECT t.*, p.name as party_name FROM transactions t LEFT JOIN parties p ON t.party_id = p.id WHERE t.id = $1`,
          [editTxnId]
        );
        if (!txn) return;

        // Restore header fields
        setIsEditMode(true);
        setEditTxnDbId(txn.id);
        setBillNo(txn.invoice_no || '');
        setBillDate(txn.date ? txn.date.split('T')[0] : new Date().toISOString().split('T')[0]);
        setPaymentType(txn.payment_type || 'cash');
        setChallanNo(txn.challan_no || '');
        setDescription(txn.description || '');
        setPaidAmount(txn.paid_amount || '');
        if (txn.party_id && txn.party_name) {
          setVendor({ id: txn.party_id, name: txn.party_name });
          setVendorSearch(txn.party_name);
        }

        // Load line items
        const items = await db.select<any[]>(
          `SELECT ti.*, i.unit, i.tabs_per_strip, i.strips_per_box FROM transaction_items ti LEFT JOIN items i ON ti.item_id = i.id WHERE ti.txn_id = $1`,
          [editTxnId]
        );

        let seed = 1;
        const loadedRows: PurchaseRow[] = items.map(item => ({
          rowId: seed++,
          itemId: item.item_id,
          name: item.item_name || '',
          unit: item.unit || 'TAB',
          base_unit: item.unit || 'TAB',
          tabsPerStrip: item.tabs_per_strip || 10,
          stripsPerBox: item.strips_per_box || 10,
          purchase_price: item.price || 0,
          sale_price: item.price || 0,
          qty: item.quantity || 1,
          free: 0 as number | '',
          batch: item.batch_no || '',
          expiry: item.expiry_date || '',
          mrp: item.price || 0,
          price: item.price || 0,
          disc: item.discount_pct || 0,
          gst: item.tax_pct || 0,
          scheme_amount: item.scheme_amount || '',
        }));

        rowSeedRef.current = seed + 1;
        // Add empty rows at end
        while (loadedRows.length < DEFAULT_ROW_COUNT) {
          loadedRows.push(createEmptyRow(seed++));
          rowSeedRef.current = seed + 1;
        }
        setCart(loadedRows);
        setStatus('✏️ Editing existing purchase bill. Make changes and save.');
      } catch (e) {
        console.error('Failed to load purchase for editing:', e);
      }
    };
    loadExistingTransaction();
  }, [editTxnId]);

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
        // Load FY start month
        const fyM = await getFyStartMonth();
        setFyStartMonth(fyM);
      } catch (e) {}
    };
    loadSettings();
  }, []);

  // ── Draft persistence: restore on mount (only for new bills, not edits) ──
  useEffect(() => {
    if (editTxnId) { setDraftRestored(true); return; } // skip for edit mode
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft.billNo) setBillNo(draft.billNo);
        if (draft.billDate) setBillDate(draft.billDate);
        if (draft.paymentType) setPaymentType(draft.paymentType);
        if (draft.challanNo) setChallanNo(draft.challanNo);
        if (draft.description) setDescription(draft.description);
        if (draft.paidAmount !== undefined) setPaidAmount(draft.paidAmount);
        if (draft.vendor) { setVendor(draft.vendor); setVendorSearch(draft.vendor.name); }
        if (draft.cart && Array.isArray(draft.cart) && draft.cart.length > 0) {
          const rows: PurchaseRow[] = draft.cart;
          // ensure we have at least DEFAULT_ROW_COUNT rows
          let seed = Math.max(...rows.map(r => r.rowId), DEFAULT_ROW_COUNT) + 1;
          rowSeedRef.current = seed;
          while (rows.length < DEFAULT_ROW_COUNT) rows.push(createEmptyRow(seed++));
          setCart(rows);
        }
        setStatus('📋 Draft restored — unsaved changes loaded.');
        setTimeout(() => setStatus(prev => prev.startsWith('📋') ? '' : prev), 4000);
      }
    } catch {}
    setDraftRestored(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [DRAFT_KEY]);

  // ── Draft persistence: auto-save on every relevant state change ──
  useEffect(() => {
    if (!draftRestored) return; // don't save before we've loaded
    if (isEditMode) return;     // don't overwrite draft while in edit mode
    try {
      const draft = { billNo, billDate, paymentType, challanNo, description, paidAmount, vendor, cart };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  }, [billNo, billDate, paymentType, challanNo, description, paidAmount, vendor, cart, isEditMode, draftRestored, DRAFT_KEY]);

  // ── Notify parent tab of label changes ──
  useEffect(() => {
    if (!onLabelChange) return;
    const hasItems = validRows.length > 0;
    const label = billNo.trim() || (isEditMode ? 'Edit Bill' : 'New Purchase');
    onLabelChange(label, hasItems);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billNo, validRows.length, isEditMode]);

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

    // Validate bill number
    if (!billNo.trim()) {
      setStatus('❌ Bill number cannot be empty');
      return;
    }

    // Validate expiry dates on all rows
    for (const row of validRows) {
      if (row.expiry && row.expiry.trim() !== '') {
        const parts = row.expiry.split('/');
        const m = parts.length > 0 ? parseInt(parts[0], 10) : 0;
        const yStr = parts.length > 1 ? parts[1] : '';
        const y = parseInt(yStr, 10);
        if (parts.length !== 2 || isNaN(m) || m < 1 || m > 12 || isNaN(y) || (yStr.length !== 2 && yStr.length !== 4)) {
          setStatus(`❌ Invalid expiry date "${row.expiry}" for item "${row.name}". Use MM/YY or MM/YYYY`);
          return;
        }
      }
    }

    // For credit purchases with no paid amount entered, default to 0 (fully on credit)
    // For cash/UPI with no paid amount entered, default to full net (fully paid)
    const finalPaid = paidAmount === '' 
      ? (paymentType === 'credit' ? 0 : net)
      : Number(paidAmount);
    const balanceDue = net - finalPaid;
    const paymentStatus = balanceDue <= 0 ? 'paid' : finalPaid > 0 ? 'partial' : 'unpaid';

    try {
      const db = await getDB();

      // Check for duplicate bill number (skip check if editing same bill)
      // Scoped to the same financial year based on admin-configured FY start month.
      const { fyStart, fyEnd } = getFyBounds(billDate, fyStartMonth);
      // Capture editTxnDbId synchronously before any await
      const currentEditId = editTxnDbId;

      const existing = await db.select<any[]>(
        `SELECT id FROM transactions WHERE invoice_no = $1 AND type = 'purchase' AND date >= $2 AND date <= $3${currentEditId ? ` AND id != ${currentEditId}` : ''}`,
        [billNo.trim(), fyStart, fyEnd]
      );
      if (existing.length > 0) {
        const fyLabel = `${new Date(fyStart).getFullYear()}-${String(new Date(fyEnd).getFullYear()).slice(2)}`;
        setStatus(`❌ A purchase bill "${billNo.trim()}" already exists in FY ${fyLabel}! Use a different bill number.`);
        return;
      }


      if (isEditMode && editTxnDbId) {
        // === EDIT MODE: Update existing transaction ===
        // First, reverse the stock changes from the old items
        const oldItems = await db.select<any[]>(
          `SELECT * FROM transaction_items WHERE txn_id = $1`,
          [editTxnDbId]
        );
        for (const oldItem of oldItems) {
          if (oldItem.item_id) {
            await db.execute(
              `UPDATE items SET current_stock = current_stock - $1 WHERE id = $2`,
              [oldItem.quantity, oldItem.item_id]
            );
          }
        }

        // Delete old items
        await db.execute(`DELETE FROM transaction_items WHERE txn_id = $1`, [editTxnDbId]);

        // Update transaction header
        await db.execute(
          `UPDATE transactions SET invoice_no=$1, date=$2, party_id=$3, total_amount=$4, paid_amount=$5, balance_due=$6, payment_type=$7, status=$8, challan_no=$9, description=$10 WHERE id=$11`,
          [billNo, billDate, vendor?.id || null, net, finalPaid, balanceDue, paymentType, paymentStatus, challanNo, description, editTxnDbId]
        );

        // Re-insert updated items
        for (const row of validRows) {
          const qtyVal = Number(row.qty) || 0;
          const stripsPerBoxVal = Number(row.stripsPerBox) || 1;
          const tabsPerStripVal = Number(row.tabsPerStrip) || 1;
          const priceVal = Number(row.price) || 0;
          const mrpVal = Number(row.mrp) || 0;
          const discVal = Number(row.disc) || 0;
          const gstVal = Number(row.gst) || 0;
          const schemeVal = Number(row.scheme_amount) || 0;

          let inventoryQty = qtyVal;
          let scaleDown = 1;
          if (row.unit === 'BOX') scaleDown = stripsPerBoxVal * tabsPerStripVal;
          else if (row.unit === 'STRIP') scaleDown = tabsPerStripVal;
          inventoryQty = qtyVal * scaleDown;

          const basePurchasePrice = priceVal / scaleDown;
          const baseSalePrice = mrpVal / scaleDown;

          const base = priceVal * qtyVal;
          const discAmt = base * (discVal / 100);
          const taxable = Math.max(0, base - discAmt - schemeVal);
          const taxAmt = taxable * (gstVal / 100);
          const rowAmount = taxable + taxAmt;

          let resolvedItemId = row.itemId;

          // Auto-create or find existing item if typed manually (no itemId)
          if (!resolvedItemId && row.name.trim()) {
            const existing = await db.select<any[]>(
              `SELECT id FROM items WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
              [row.name.trim()]
            );
            if (existing.length > 0) {
              resolvedItemId = existing[0].id;
            } else {
              const newItem = await db.execute(
                `INSERT INTO items (name, unit, purchase_price, sale_price, current_stock, tabs_per_strip, strips_per_box, tax_rate, discount)
                 VALUES ($1, 'TAB', $2, $3, $4, $5, $6, $7, $8)`,
                [row.name.trim(), basePurchasePrice, baseSalePrice, inventoryQty, tabsPerStripVal, stripsPerBoxVal, gstVal, discVal]
              );
              resolvedItemId = Number((newItem as { lastInsertId?: number }).lastInsertId);
            }
          }

          await db.execute(
            `INSERT INTO transaction_items (txn_id, item_id, item_name, quantity, unit, price, discount_pct, tax_pct, amount, batch_no, expiry_date, scheme_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [editTxnDbId, resolvedItemId, row.name, qtyVal, row.unit || 'TAB', priceVal, discVal, gstVal, rowAmount, row.batch, row.expiry, schemeVal]
          );
          if (resolvedItemId) {
            await db.execute(
              `UPDATE items SET current_stock = current_stock + $1, purchase_price = $2, sale_price = $3, tabs_per_strip = $4, strips_per_box = $5, unit = 'TAB' WHERE id = $6`,
              [inventoryQty, basePurchasePrice, baseSalePrice, tabsPerStripVal, stripsPerBoxVal, resolvedItemId]
            );
          }
        }

        setStatus(`✅ Purchase ${billNo} updated successfully!`);
        setIsEditMode(false);
        setEditTxnDbId(null);
        if (onSaved) onSaved();
        // 🔄 Real-time cloud sync — always attempt when store is set; isOnline check is advisory
        if (activeStore?.id) {
          syncTransactionToCloud(activeStore.id, editTxnDbId).catch((e) => {
            console.warn('[CloudSync] Purchase update sync failed:', e?.message);
          });
        }

      } else {
        // === NEW MODE: Insert new transaction ===
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
          const schemeVal = Number(row.scheme_amount) || 0;

          let inventoryQty = qtyVal;
          let scaleDown = 1;
          if (row.unit === 'BOX') scaleDown = stripsPerBoxVal * tabsPerStripVal;
          else if (row.unit === 'STRIP') scaleDown = tabsPerStripVal;
          inventoryQty = qtyVal * scaleDown;

          const basePurchasePrice = priceVal / scaleDown;
          const baseSalePrice = mrpVal / scaleDown;

          const base = priceVal * qtyVal;
          const discAmt = base * (discVal / 100);
          const taxable = Math.max(0, base - discAmt - schemeVal);
          const taxAmt = taxable * (gstVal / 100);
          const rowAmount = taxable + taxAmt;

          let resolvedItemId = row.itemId;

          // Auto-create or update item in items table if typed manually (no itemId selected)
          if (!resolvedItemId && row.name.trim()) {
            // Try to find existing item by name first
            const existing = await db.select<any[]>(
              `SELECT id FROM items WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
              [row.name.trim()]
            );
            if (existing.length > 0) {
              resolvedItemId = existing[0].id;
            } else {
              // Create new item from purchase data
              const newItem = await db.execute(
                `INSERT INTO items (name, unit, purchase_price, sale_price, current_stock, tabs_per_strip, strips_per_box, tax_rate, discount)
                 VALUES ($1, 'TAB', $2, $3, $4, $5, $6, $7, $8)`,
                [row.name.trim(), basePurchasePrice, baseSalePrice, inventoryQty, tabsPerStripVal, stripsPerBoxVal, gstVal, discVal]
              );
              resolvedItemId = Number((newItem as { lastInsertId?: number }).lastInsertId);
            }
          }

          await db.execute(
            `INSERT INTO transaction_items (txn_id, item_id, item_name, quantity, unit, price, discount_pct, tax_pct, amount, batch_no, expiry_date, scheme_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [txnId, resolvedItemId, row.name, qtyVal, row.unit || 'TAB', priceVal, discVal, gstVal, rowAmount, row.batch, row.expiry, schemeVal]
          );
          if (resolvedItemId) {
            await db.execute(
              `UPDATE items SET current_stock = current_stock + $1, purchase_price = $2, sale_price = $3, tabs_per_strip = $4, strips_per_box = $5, unit = 'TAB' WHERE id = $6`,
              [inventoryQty, basePurchasePrice, baseSalePrice, tabsPerStripVal, stripsPerBoxVal, resolvedItemId]
            );
          }
        }
        setStatus(`✅ Purchase ${billNo} saved!`);
        // 🔄 Real-time cloud sync — always attempt when store is set; isOnline check is advisory
        if (activeStore?.id) {
          syncTransactionToCloud(activeStore.id, txnId).catch((e) => {
            console.warn('[CloudSync] New purchase sync failed:', e?.message);
          });
        }
      }

      // Clear draft on successful save
      try { localStorage.removeItem(DRAFT_KEY); } catch {}

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

  // Keep ref always pointing to latest savePurchase to prevent stale closures
  useEffect(() => { savePurchaseRef.current = savePurchase; });

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        savePurchaseRef.current();
      }
      if (e.key === 'F10') {
        e.preventDefault();
        savePurchaseRef.current();
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
  // Only re-bind when activeRowId changes (for F4), savePurchase is handled via ref
  }, [activeRowId]);

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
        <div className="flex items-center gap-3">
          {isEditMode && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 text-xs font-bold">
              <Edit3 size={12} />
              Editing Bill
            </span>
          )}
          <h2 className="text-xl font-bold text-slate-800">{isEditMode ? `Edit: ${billNo}` : 'Purchase'}</h2>
        </div>
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
              <div className="flex-1">
                <SmartDateInput
                  id="billDate"
                  value={billDate}
                  onChange={setBillDate}
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
                  className="!h-8 !border-0 !border-b-2 !border-slate-100 focus:!border-brand hover:!border-slate-200 !rounded-none !bg-transparent !px-1 !shadow-none !font-sans text-slate-700"
                />
              </div>
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

        <div className="flex-1 overflow-x-auto border-t border-slate-200">
          <table className="w-full min-w-[1100px] text-xs table-fixed border-collapse">
            <thead className="bg-slate-100 border-b-2 border-slate-300 sticky top-0 z-10">
              <tr className="text-slate-600 text-[10px] font-bold uppercase tracking-widest">
                <th className="pl-3 pr-1 py-1.5 text-left w-7 border-r border-slate-200">#</th>
                <th className="px-1 py-1.5 text-left w-[220px] border-r border-slate-200"><HeaderTip label="Item" tip={<><b>Item / Description</b><br/>દવાનું નામ અથવા વર્ણન.<br/><span className="text-slate-300">Search and select the medicine.</span></>} /></th>
                {settings.show_batch && <th className="px-1 py-1.5 text-left w-24 border-r border-slate-200"><HeaderTip label="Batch" tip={<><b>Batch Number</b><br/>બેચ નંબર.<br/><span className="text-slate-300">Must match the physical stock.</span></>} /></th>}
                {settings.show_expiry && <th className="px-1 py-1.5 text-left w-20 border-r border-slate-200"><HeaderTip label="Exp." tip={<><b>Expiry Date</b><br/>એક્સપાયરી તારીખ.<br/><span className="text-slate-300">Format: MM/YY</span></>} /></th>}
                {settings.show_mrp && <th className="px-1 py-1.5 text-right w-16 border-r border-slate-200"><HeaderTip label="MRP" tip={<><b>Max Retail Price</b><br/>મહત્તમ છૂટક કિંમત.</>} /></th>}
                <th className="px-1 py-1.5 text-right w-20 border-r border-slate-200"><HeaderTip label="Price ₹" tip={<><b>Purchase Price</b><br/>ખરીદી કિંમત.</>} /></th>
                <th className="px-1 py-1.5 text-right w-14 border-r border-slate-200"><HeaderTip label="Qty" tip={<><b>Quantity</b><br/>જથ્ધો / નંગ.</>} /></th>
                <th className="px-1 py-1.5 text-right w-12 border-r border-slate-200"><HeaderTip label="Free" tip={<><b>Free Qty</b><br/>મફત જથ્ધો.</>} /></th>
                <th className="px-1 py-1.5 text-left w-16 border-r border-slate-200"><HeaderTip label="Unit" tip={<><b>Unit</b><br/>TAB/STRIP/BOX</>} /></th>
                <th className="px-1 py-1.5 text-center w-10 border-r border-slate-200"><HeaderTip label="T/S" tip={<><b>Tabs/Strip</b><br/>ટેબ્સ પ્રતિ સ્ટ્રિપ</>} /></th>
                <th className="px-1 py-1.5 text-center w-10 border-r border-slate-200"><HeaderTip label="S/B" tip={<><b>Strips/Box</b><br/>સ્ટ્રિપ્સ પ્રતિ બોક્સ</>} /></th>
                {settings.show_tax && <th className="px-1 py-1.5 text-right w-12 border-r border-slate-200"><HeaderTip label="GST%" tip={<><b>GST%</b></>} /></th>}
                <th className="px-1 py-1.5 text-right w-12 border-r border-slate-200"><HeaderTip label="Disc%" tip={<><b>Discount%</b><br/>ડિસ્કાઉન્ટ</>} /></th>
                <th className="px-1 py-1.5 text-right w-16 border-r border-slate-200"><HeaderTip label="Scheme ₹" tip={<><b>Scheme Amount</b><br/>સ્કીમ</>} /></th>
                <th className="px-1 py-1.5 text-right w-20 border-r border-slate-200"><HeaderTip label="Amount" tip={<><b>Total Amount</b><br/><span className="font-mono text-[10px] text-green-300">Qty×Price-Disc-Scheme+GST</span></>} /></th>
                <th className="pr-3 pl-1 py-1.5 w-7"></th>
              </tr>
            </thead>

            <tbody>
              {cart.map((row, idx) => {
                const qtyVal = Number(row.qty) || 0;
                const priceVal = Number(row.price) || 0;
                const discVal = Number(row.disc) || 0;
                const taxVal = Number(row.gst) || 0;
                const schemeVal = Number(row.scheme_amount) || 0;
                
                const rowBase = priceVal * qtyVal;
                const rowDisc = rowBase * (discVal / 100);
                const rowTaxable = Math.max(0, rowBase - rowDisc - schemeVal);
                const rowTax = rowTaxable * (taxVal / 100);
                const rowAmount = rowTaxable + rowTax;
                const isActive = activeRowId === row.rowId;

                return (
                  <React.Fragment key={row.rowId}>
                    <tr className={`border-b border-slate-100 ${isActive ? 'bg-blue-50/60 border-t-2 border-b-2 border-y-brand' : 'hover:bg-slate-50/80'}`}>
                    <td className={`pl-3 pr-1 py-0.5 text-slate-300 font-mono text-[10px] align-middle border-r border-slate-100 text-center ${isActive ? 'border-l-2 border-l-brand' : ''}`}>{idx + 1}</td>
                    <td className="px-0.5 py-0.5 align-middle border-r border-slate-100">
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
                            placeholder="Item name..."
                            className="w-full h-6 border-0 border-b border-slate-200 px-2 text-xs bg-transparent focus:outline-none focus:border-brand focus:bg-white"
                          />
                          {activeRowId === row.rowId && showItemDrop && row.name.trim() && (
                            <div className="absolute left-0 top-[calc(100%+2px)] z-40 w-[400px] overflow-hidden border border-slate-200 bg-white shadow-2xl">
                              <div className="flex bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                                <span className="flex-1">Item Name</span>
                                <span className="w-14 text-right">Stock</span>
                                <span className="w-20 text-right">Pur. Price</span>
                              </div>
                              <div className="max-h-[260px] overflow-y-auto">
                                {itemResults.length > 0 ? itemResults.map((item, iIndex) => (
                                  <button
                                    key={item.id}
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => applyItemToRow(row.rowId, item)}
                                    className={`flex w-full items-center px-3 py-2 text-left border-b border-slate-50 last:border-0 ${
                                        selectedItemIndex === iIndex ? 'bg-brand text-white' : 'hover:bg-blue-50'
                                    }`}
                                  >
                                    <span className="flex-1 truncate text-xs font-medium">{item.name}</span>
                                    <span className={`w-14 text-right text-xs font-mono ${(item.current_stock ?? 0) <= 0 ? 'text-red-400' : ''}`}>
                                      {item.current_stock || 0}
                                    </span>
                                    <span className="w-20 text-right text-xs font-mono font-bold">
                                      ₹{Number(item.purchase_price || 0).toFixed(2)}
                                    </span>
                                  </button>
                              )) : (
                                <div className="px-3 py-6 text-center text-xs text-slate-400">
                                  No items found matching "{row.name}"
                                </div>
                              )}
                            </div>
                            <div className="border-t border-slate-100 bg-slate-50 p-1.5">
                              <button
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => {
                                  setItemModalName(row.name);
                                  setActiveRowId(row.rowId);
                                  setShowItemDrop(false);
                                  setShowItemModal(true);
                                }}
                                className="flex w-full items-center justify-center gap-1.5 py-1.5 text-xs font-bold text-brand hover:bg-brand hover:text-white transition-all border border-brand/30"
                              >
                                <Plus size={12} /> Create New Item
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    {settings.show_batch && (
                      <td className="px-0.5 py-0.5 align-middle border-r border-slate-100">
                        <button
                          onClick={() => { if (row.itemId) { setActiveRowId(row.rowId); setBatchModalRowId(row.rowId); } }}
                          className={`w-full h-6 border-b px-1.5 text-xs text-left truncate transition-colors ${
                            row.batch ? 'border-slate-200 bg-transparent font-mono font-semibold text-slate-700' : 'border-dashed border-slate-300 text-slate-300'
                          } hover:border-brand hover:text-brand focus:outline-none`}
                          title={row.itemId ? 'Click to manage batches' : 'Select an item first'}
                        >
                          {row.batch || (row.itemId ? '+ Batch' : '—')}
                        </button>
                      </td>
                    )}
                    {settings.show_expiry && (
                      <td className="px-0.5 py-0.5 align-middle border-r border-slate-100">
                        <SmartExpiryInput
                          value={row.expiry}
                          onChange={val => updateRow(row.rowId, 'expiry', val)}
                          onKeyDown={e => handleFieldArrow(e, row.rowId, 'expiry')}
                          data-row={row.rowId}
                          data-field="expiry"
                          placeholder="MM/YY"
                          className="!h-6 !rounded-none !border-0 !border-b !border-slate-200 !shadow-none !bg-transparent !px-1.5 focus:!border-brand focus:!bg-white"
                        />
                      </td>
                    )}
                    {settings.show_mrp && (
                      <td className="px-0.5 py-0.5 align-middle border-r border-slate-100">
                        <input type="text" value={row.mrp}
                          onChange={e => updateRow(row.rowId, 'mrp', e.target.value)}
                          className="w-full h-6 border-0 border-b border-slate-200 px-1.5 text-right font-mono text-xs bg-transparent focus:outline-none focus:border-brand focus:bg-white"
                        />
                      </td>
                    )}
                    <td className="px-0.5 py-0.5 align-middle border-r border-slate-100">
                      <input type="text" data-row={row.rowId} data-field="price"
                        value={row.price}
                        onChange={e => updateRow(row.rowId, 'price', e.target.value)}
                        onKeyDown={e => handleFieldArrow(e, row.rowId, 'price')}
                        className="w-full h-6 border-0 border-b border-slate-200 px-1.5 text-right font-mono text-xs bg-transparent focus:outline-none focus:border-brand focus:bg-white"
                      />
                      {(() => {
                        const p = Number(row.price) || 0;
                        const tps = Number(row.tabsPerStrip) || 10;
                        const spb = Number(row.stripsPerBox) || 10;
                        const unit = row.unit || 'TAB';
                        if (p <= 0) return null;
                        if (unit === 'TAB') {
                          const perStrip = p * tps;
                          const perBox = perStrip * spb;
                          return (
                            <div className="text-[9px] text-slate-400 text-right leading-tight px-1 mt-0.5">
                              <span className="text-blue-400 font-semibold">₹{perStrip.toFixed(2)}/S</span>
                              <span className="mx-0.5 text-slate-300">·</span>
                              <span className="text-green-500 font-semibold">₹{perBox.toFixed(2)}/B</span>
                            </div>
                          );
                        }
                        if (unit === 'STRIP') {
                          const perBox = p * spb;
                          return (
                            <div className="text-[9px] text-green-500 font-semibold text-right leading-tight px-1 mt-0.5">
                              ₹{perBox.toFixed(2)}/BOX
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </td>
                    <td className="px-0.5 py-0.5 align-middle border-r border-slate-100">
                      <input type="text" data-row={row.rowId} data-field="qty"
                        value={row.qty}
                        onChange={e => updateRow(row.rowId, 'qty', e.target.value)}
                        onKeyDown={e => handleFieldArrow(e, row.rowId, 'qty')}
                        className="w-full h-6 border-0 border-b border-slate-200 px-1.5 text-right font-mono text-xs bg-transparent focus:outline-none focus:border-brand focus:bg-white"
                      />
                    </td>
                    <td className="px-0.5 py-0.5 align-middle border-r border-slate-100">
                      <input type="text" data-row={row.rowId} data-field="free"
                        value={row.free}
                        onChange={e => updateRow(row.rowId, 'free', e.target.value)}
                        onKeyDown={e => handleFieldArrow(e, row.rowId, 'free')}
                        className="w-full h-6 border-0 border-b border-slate-200 px-1.5 text-right font-mono text-xs bg-transparent focus:outline-none focus:border-brand focus:bg-white"
                      />
                    </td>
                    <td className="px-0.5 py-0.5 align-middle border-r border-slate-100">
                      <select value={row.unit || 'TAB'}
                        onChange={e => handleUnitChange(row.rowId, e.target.value)}
                        className="w-full h-6 border-0 border-b border-slate-200 px-0.5 bg-transparent text-xs font-bold text-slate-600 focus:outline-none focus:border-brand"
                      >
                        <option value="BOX">BOX</option>
                        <option value="STRIP">STRIP</option>
                        <option value="TAB">TAB</option>
                        <option value="PCS">PCS</option>
                        <option value="BTL">BTL</option>
                      </select>
                    </td>
                    <td className="px-0.5 py-0.5 align-middle border-r border-slate-100">
                      <input type="text" value={row.tabsPerStrip}
                        onChange={e => updateRow(row.rowId, 'tabsPerStrip', e.target.value)}
                        className="w-full h-6 border-0 border-b border-slate-200 px-1 text-center font-mono text-xs bg-transparent focus:outline-none focus:border-brand focus:bg-white"
                      />
                    </td>
                    <td className="px-0.5 py-0.5 align-middle border-r border-slate-100">
                      <input type="text" value={row.stripsPerBox}
                        onChange={e => updateRow(row.rowId, 'stripsPerBox', e.target.value)}
                        className="w-full h-6 border-0 border-b border-slate-200 px-1 text-center font-mono text-xs bg-transparent focus:outline-none focus:border-brand focus:bg-white"
                      />
                    </td>
                    {settings.show_tax && (
                      <td className="px-0.5 py-0.5 align-middle border-r border-slate-100">
                        <input type="text" value={row.gst}
                          onChange={e => updateRow(row.rowId, 'gst', e.target.value)}
                          className="w-full h-6 border-0 border-b border-slate-200 px-1.5 text-right font-mono text-xs bg-transparent focus:outline-none focus:border-brand focus:bg-white"
                        />
                      </td>
                    )}
                    <td className="px-0.5 py-0.5 align-middle border-r border-slate-100">
                      <input type="text" data-row={row.rowId} data-field="disc"
                        value={row.disc}
                        onChange={e => updateRow(row.rowId, 'disc', e.target.value)}
                        onKeyDown={e => handleFieldArrow(e, row.rowId, 'disc')}
                        className="w-full h-6 border-0 border-b border-slate-200 px-1.5 text-right font-mono text-xs bg-transparent focus:outline-none focus:border-brand focus:bg-white"
                      />
                    </td>
                    <td className="px-0.5 py-0.5 align-middle border-r border-slate-100">
                      <input type="text" data-row={row.rowId} data-field="scheme_amount"
                        value={row.scheme_amount}
                        onChange={e => updateRow(row.rowId, 'scheme_amount', e.target.value)}
                        onKeyDown={e => handleFieldArrow(e, row.rowId, 'scheme_amount')}
                        className="w-full h-6 border-0 border-b border-slate-200 px-1.5 text-right font-mono text-xs bg-transparent focus:outline-none focus:border-brand focus:bg-white"
                        placeholder="0"
                      />
                    </td>
                    <td className="px-1.5 py-0.5 align-middle border-r border-slate-100 text-right font-bold font-mono text-slate-800">
                      {rowAmount > 0 ? rowAmount.toFixed(2) : ''}
                    </td>
                    <td className={`pr-2 pl-0.5 py-0.5 align-middle text-center ${isActive ? 'border-r-2 border-r-brand' : ''}`}>
                      <button
                        onClick={() => clearRow(row.rowId)}
                        className="h-5 w-5 flex items-center justify-center text-slate-200 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={11} />
                      </button>
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot className="bg-slate-100 border-t-2 border-slate-300 sticky bottom-0 z-10">
            <tr>
              <td colSpan={2} className="px-3 py-1.5">
                <div className="flex items-center gap-3">
                  <button
                    onClick={addEmptyRow}
                    className="inline-flex items-center gap-1 border border-slate-300 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-200 transition-all"
                  >
                    <Plus size={11} /> Add Row
                  </button>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Totals</span>
                </div>
              </td>
              {settings.show_batch && <td className="border-r border-slate-200"></td>}
              {settings.show_expiry && <td className="border-r border-slate-200"></td>}
              {settings.show_mrp && <td className="border-r border-slate-200"></td>}
              <td className="border-r border-slate-200"></td>
              <td className="px-1.5 py-1.5 text-right font-bold text-slate-700 font-mono text-xs border-r border-slate-200">{validRows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0)}</td>
              <td className="border-r border-slate-200"></td>
              <td className="border-r border-slate-200"></td>
              <td className="border-r border-slate-200"></td>
              <td className="border-r border-slate-200"></td>
              {settings.show_tax && <td className="border-r border-slate-200"></td>}
              <td className="border-r border-slate-200"></td>
              <td className="border-r border-slate-200"></td>
              <td className="px-1.5 py-1.5 text-right font-bold text-brand font-mono text-sm border-r border-slate-200">₹{net.toFixed(2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

        {/* Compact bottom panel */}
        <div className="bg-white border-t-2 border-slate-200 px-4 py-2 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative">
              <select
                value={paymentType}
                onChange={e => setPaymentType(e.target.value as 'cash' | 'credit' | 'upi')}
                className="appearance-none h-8 pl-3 pr-8 border border-slate-200 bg-white text-xs font-bold focus:border-brand focus:ring-1 focus:ring-brand outline-none cursor-pointer"
              >
                <option value="cash">Cash</option>
                <option value="credit">Credit</option>
                <option value="upi">UPI</option>
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
            {paymentType !== 'credit' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">Paid</span>
                <input
                  type="number"
                  placeholder={net.toFixed(2)}
                  value={paidAmount}
                  onChange={e => setPaidAmount(e.target.value ? parseFloat(e.target.value) : '')}
                  className="w-20 h-8 border border-slate-200 text-right px-2 font-mono text-xs bg-white focus:border-brand focus:ring-1 focus:ring-brand outline-none"
                />
              </div>
            )}
            {paymentType !== 'credit' && (net - (paidAmount === '' ? net : Number(paidAmount))) > 0 && (
              <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2 py-1 border border-orange-200">
                Due: ₹{(net - (paidAmount === '' ? net : Number(paidAmount))).toFixed(2)}
              </span>
            )}
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Notes..."
              className="w-52 h-8 border border-slate-200 px-2 text-xs bg-white focus:outline-none focus:border-brand"
            />
          </div>

          <div className="flex items-center gap-4">
            {totalTax > 0 && (
              <span className="text-[10px] text-slate-400 font-mono">Tax: ₹{totalTax.toFixed(2)}</span>
            )}
            <div className="text-right">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Total Purchase</div>
              <div className="text-xl font-bold text-brand font-mono">₹{net.toFixed(2)}</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setCart(Array.from({ length: DEFAULT_ROW_COUNT }, (_, index) => createEmptyRow(index + 1)));
                  rowSeedRef.current = DEFAULT_ROW_COUNT + 1;
                  setVendor(null);
                  setVendorSearch('');
                  setItemResults([]);
                  setShowItemDrop(false);
                  setBillNo(createPurchaseBillNo());
                  setIsEditMode(false);
                  setEditTxnDbId(null);
                  setStatus('');
                  // Clear draft on manual clear
                  try { localStorage.removeItem(DRAFT_KEY); } catch {}
                }}
                className="px-4 h-8 border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-medium transition-colors bg-white"
              >
                {isEditMode ? 'Cancel Edit' : 'Clear'}
              </button>
              <button
                onClick={savePurchase}
                className={`px-6 h-8 text-white text-xs font-bold transition-colors flex items-center gap-2 ${
                  isEditMode ? 'bg-amber-500 hover:bg-amber-600' : 'bg-brand hover:bg-brand-hover'
                }`}
              >
                {isEditMode ? '✏️ Update Bill' : 'Save (Ctrl+S)'}
              </button>
            </div>
          </div>
        </div>
      </div>
      {showScanner && (
        <ScannerPanel
          onClose={() => setShowScanner(false)}
          onGeminiData={(data: GeminiBillData) => {
            // Auto-fill bill header from Gemini
            if (data.bill_no) setBillNo(data.bill_no);
            if (data.bill_date) {
              // Convert DD/MM/YYYY → YYYY-MM-DD for the date state
              const parts = data.bill_date.split('/');
              if (parts.length === 3) {
                const [d, m, y] = parts;
                setBillDate(`${y.length === 2 ? '20' + y : y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
              }
            }
            if (data.vendor) {
              setVendorSearch(data.vendor);
              // Try to find matching vendor in DB
              getDB().then(db => {
                db.select<any[]>(`SELECT * FROM parties WHERE name LIKE $1 LIMIT 1`, [`%${data.vendor}%`])
                  .then(res => { if (res.length > 0) setVendor(res[0]); });
              });
            }
          }}
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
                tabsPerStrip: it.tabs_per_strip || 10,
                stripsPerBox: it.strips_per_box || 10,
                purchase_price: Number(it.purchase_price) || 0,
                sale_price: Number(it.sale_price) || 0,
                qty: it.qty_extracted || 1,
                free: it.free_extracted !== undefined && it.free_extracted !== null ? Number(it.free_extracted) : 0,
                batch: it.batch_extracted || '',
                expiry: it.exp_extracted || '',
                mrp: Number(it.mrp_extracted) || Number(it.sale_price) || 0,
                price: Number(it.rate_extracted) || Number(it.purchase_price) || 0,
                disc: Number(it.disc_extracted) || 0,
                gst: it.gst_extracted !== undefined && it.gst_extracted !== null ? Number(it.gst_extracted) : (Number(it.tax_rate) || 0),
                scheme_amount: it.scheme_extracted !== undefined && it.scheme_extracted !== null && Number(it.scheme_extracted) !== 0 ? Number(it.scheme_extracted) : '',
              };
              if (insertIdx < newCart.length && !newCart[insertIdx].itemId) {
                newCart[insertIdx] = { ...row, rowId: cart[insertIdx].rowId };
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
