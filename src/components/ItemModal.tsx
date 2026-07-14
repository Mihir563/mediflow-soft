'use client';
import { useState, useEffect } from 'react';
import { Save, X } from 'lucide-react';
import { getDB } from '@/lib/db';

interface ItemFormModalProps {
  onClose: () => void;
  onSave: (item: any) => void;
  initialName?: string;
  itemToEdit?: any;
}

const emptyForm = {
  name: '', hsn: '', unit: 'PCS', sale_price: 0, purchase_price: 0,
  opening_stock: 0, current_stock: 0, min_stock: 0, category: '',
  tax_rate: 0, discount: 0, inclusive_tax: 0
};

export default function ItemModal({ onClose, onSave, initialName = '', itemToEdit }: ItemFormModalProps) {
  const [form, setForm] = useState(itemToEdit ? { ...itemToEdit } : { ...emptyForm, name: initialName });
  const [status, setStatus] = useState('');
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    getDB().then(db => {
      db.select<any[]>(`SELECT DISTINCT category FROM items WHERE category != '' ORDER BY category`)
        .then(res => setCategories(res.map(c => c.category)));
    });
  }, []);

  const handleSave = async () => {
    if (!form.name.trim()) { setStatus('Name is required'); return; }
    try {
      const db = await getDB();
      if (itemToEdit) {
        await db.execute(
          `UPDATE items SET name=$1,hsn=$2,unit=$3,sale_price=$4,purchase_price=$5,opening_stock=$6,current_stock=$7,min_stock=$8,category=$9,tax_rate=$10,discount=$11,inclusive_tax=$12 WHERE id=$13`,
          [form.name, form.hsn, form.unit, form.sale_price, form.purchase_price, form.opening_stock, form.current_stock, form.min_stock, form.category, form.tax_rate, form.discount, form.inclusive_tax, itemToEdit.id]
        );
        onSave({ ...form, id: itemToEdit.id });
      } else {
        const res: any = await db.execute(
          `INSERT INTO items (name,hsn,unit,sale_price,purchase_price,opening_stock,current_stock,min_stock,category,tax_rate,discount,inclusive_tax) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [form.name, form.hsn, form.unit, form.sale_price, form.purchase_price, form.opening_stock, form.current_stock, form.min_stock, form.category, form.tax_rate, form.discount, form.inclusive_tax]
        );
        onSave({ ...form, id: res.lastInsertId });
      }
    } catch (e: any) {
      setStatus(`❌ Error: ${e.message}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-lg text-slate-800">{itemToEdit ? 'Edit Item' : 'Add New Item'}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400"><X size={16} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 font-medium block mb-1">Item Name *</label>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} autoFocus
              className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Category</label>
              <input value={form.category} onChange={e => setForm({...form, category: e.target.value})}
                list="cat-list" className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" />
              <datalist id="cat-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">HSN Code</label>
              <input value={form.hsn} onChange={e => setForm({...form, hsn: e.target.value})}
                className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Unit</label>
              <input value={form.unit} onChange={e => setForm({...form, unit: e.target.value})}
                list="unit-list" className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" />
              <datalist id="unit-list">
                <option value="PCS" /><option value="BOX" /><option value="STRIP" />
                <option value="ML" /><option value="GM" /><option value="LTR" /><option value="NOS" />
              </datalist>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Sale Price (MRP) ₹</label>
              <input type="number" min={0} value={form.sale_price} onChange={e => setForm({...form, sale_price: parseFloat(e.target.value) || 0})}
                className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Purchase Price ₹</label>
              <input type="number" min={0} value={form.purchase_price} onChange={e => setForm({...form, purchase_price: parseFloat(e.target.value) || 0})}
                className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">GST Rate %</label>
              <input type="number" min={0} value={form.tax_rate} onChange={e => setForm({...form, tax_rate: parseFloat(e.target.value) || 0})}
                className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" />
              <label className="flex items-center gap-2 mt-2 text-xs text-slate-600 cursor-pointer w-fit">
                <input type="checkbox" checked={form.inclusive_tax === 1} onChange={e => setForm({...form, inclusive_tax: e.target.checked ? 1 : 0})} />
                MRP is Inclusive of Tax
              </label>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Default Discount %</label>
              <input type="number" min={0} max={100} value={form.discount} onChange={e => setForm({...form, discount: parseFloat(e.target.value) || 0})}
                className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Opening Stock</label>
              <input type="number" value={form.opening_stock} onChange={e => { const v = parseFloat(e.target.value) || 0; setForm({...form, opening_stock: v, current_stock: v}); }}
                disabled={!!itemToEdit}
                className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm disabled:bg-slate-50 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Current Stock</label>
              <input type="number" value={form.current_stock} onChange={e => setForm({...form, current_stock: parseFloat(e.target.value) || 0})}
                className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Min Stock Alert</label>
              <input type="number" value={form.min_stock} onChange={e => setForm({...form, min_stock: parseFloat(e.target.value) || 0})}
                className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" />
            </div>
          </div>
          {status && <p className="text-sm font-medium text-red-600">{status}</p>}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 h-10 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
          <button onClick={handleSave} className="flex-1 h-10 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors shadow-sm">
            <Save size={14} /> {itemToEdit ? 'Update' : 'Add'} Item
          </button>
        </div>
      </div>
    </div>
  );
}
