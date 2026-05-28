'use client';
import { useState, useEffect } from 'react';
import { getDB } from '@/lib/db';
import { X, Plus, Search, Package, Edit2, Check, Trash2 } from 'lucide-react';
import SmartExpiryInput from '@/components/SmartExpiryInput';

interface BatchInfo {
  batch_no: string;
  expiry_date: string;
  current_qty: number;
  isNew?: boolean;
  isEditing?: boolean;
}

interface BatchModalProps {
  itemId: number;
  itemName: string;
  onClose: () => void;
  onSelect: (batch: string, expiry: string, qty: number) => void;
}

export default function BatchModal({ itemId, itemName, onClose, onSelect }: BatchModalProps) {
  const [batches, setBatches] = useState<BatchInfo[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [qtyInputs, setQtyInputs] = useState<Record<number, number>>({});

  // New batch form
  const [newBatch, setNewBatch] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Edit state
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editBatch, setEditBatch] = useState('');
  const [editExpiry, setEditExpiry] = useState('');

  useEffect(() => {
    loadBatches();
  }, [itemId]);

  const loadBatches = async () => {
    setLoading(true);
    try {
      const db = await getDB();
      // Get all batches for this item from purchase transactions
      const rows = await db.select<{batch_no: string, expiry_date: string, total_qty: number}[]>(
        `SELECT 
           ti.batch_no, 
           ti.expiry_date,
           SUM(CASE WHEN t.type = 'purchase' THEN ti.quantity ELSE -ti.quantity END) as total_qty
         FROM transaction_items ti
         JOIN transactions t ON t.id = ti.txn_id
         WHERE ti.item_id = $1 AND ti.batch_no IS NOT NULL AND ti.batch_no != ''
         GROUP BY ti.batch_no, ti.expiry_date
         ORDER BY ti.expiry_date DESC`,
        [itemId]
      );
      setBatches(rows.map(r => ({
        batch_no: r.batch_no,
        expiry_date: r.expiry_date || '',
        current_qty: r.total_qty || 0,
      })));
    } catch (e) {
      console.error('Failed to load batches:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleAddBatch = () => {
    if (!newBatch.trim()) return;

    if (newExpiry && newExpiry.trim() !== '') {
      const parts = newExpiry.split('/');
      const m = parts.length > 0 ? parseInt(parts[0], 10) : 0;
      const yStr = parts.length > 1 ? parts[1] : '';
      const y = parseInt(yStr, 10);
      if (parts.length !== 2 || isNaN(m) || m < 1 || m > 12 || isNaN(y) || (yStr.length !== 2 && yStr.length !== 4)) {
        alert('❌ Please enter a valid Expiry Date (e.g., 12/26 or 12/2026)');
        return;
      }
    }

    const newEntry: BatchInfo = {
      batch_no: newBatch.trim(),
      expiry_date: newExpiry,
      current_qty: 0,
      isNew: true,
    };
    setBatches(prev => [...prev, newEntry]);
    setNewBatch('');
    setNewExpiry('');
    setShowAddForm(false);
    setSelectedIdx(batches.length); // select the newly added
  };

  const handleSaveEdit = (idx: number) => {
    if (editExpiry && editExpiry.trim() !== '') {
      const parts = editExpiry.split('/');
      const m = parts.length > 0 ? parseInt(parts[0], 10) : 0;
      const yStr = parts.length > 1 ? parts[1] : '';
      const y = parseInt(yStr, 10);
      if (parts.length !== 2 || isNaN(m) || m < 1 || m > 12 || isNaN(y) || (yStr.length !== 2 && yStr.length !== 4)) {
        alert('❌ Please enter a valid Expiry Date (e.g., 12/26 or 12/2026)');
        return;
      }
    }
    setBatches(prev => prev.map((b, i) => i === idx ? { ...b, batch_no: editBatch, expiry_date: editExpiry } : b));
    setEditIdx(null);
  };

  const handleDelete = (idx: number) => {
    setBatches(prev => prev.filter((_, i) => i !== idx));
    if (selectedIdx === idx) setSelectedIdx(null);
  };

  const handleSave = () => {
    if (selectedIdx === null || selectedIdx >= batches.length) {
      alert('Please select a batch first');
      return;
    }
    const selected = batches[selectedIdx];
    const qty = qtyInputs[selectedIdx] || 0;
    onSelect(selected.batch_no, selected.expiry_date, qty);
  };

  const formatExpiry = (exp: string) => {
    if (!exp) return '—';
    try {
      // Handle various formats
      if (exp.includes('-') && exp.length >= 7) {
        const d = new Date(exp);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString('en-GB', { month: '2-digit', year: 'numeric' });
        }
      }
      return exp;
    } catch {
      return exp;
    }
  };

  const filtered = search.trim()
    ? batches.filter(b => b.batch_no.toLowerCase().includes(search.toLowerCase()))
    : batches;

  const totalQty = Object.values(qtyInputs).reduce((s, v) => s + (v || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div>
            <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
              <Package size={18} className="text-brand" /> Purchase Item - Batches
            </h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Item Name: <span className="font-semibold text-slate-700">{itemName}</span>
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Search + Add */}
        <div className="px-6 pt-4 pb-2 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search batches..."
              className="w-full pl-8 pr-3 h-9 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            />
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-bold transition-colors shadow-sm"
          >
            <Plus size={14} /> Add Batch
          </button>
        </div>

        {/* Add Batch Form */}
        {showAddForm && (
          <div className="mx-6 mt-2 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs font-semibold text-slate-600 block mb-1">Batch No.</label>
              <input
                value={newBatch}
                onChange={e => setNewBatch(e.target.value)}
                placeholder="e.g. FT4919007"
                autoFocus
                className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm font-mono focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand bg-white"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-slate-600 block mb-1">Exp. Date</label>
              <SmartExpiryInput
                value={newExpiry}
                onChange={setNewExpiry}
                placeholder="MM/YY"
                className="!h-9"
              />
            </div>
            <button onClick={handleAddBatch} className="h-9 px-4 bg-brand text-white rounded-lg text-xs font-bold hover:bg-brand-hover transition-colors">Add</button>
            <button onClick={() => setShowAddForm(false)} className="h-9 px-3 bg-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-300 transition-colors">Cancel</button>
          </div>
        )}

        {/* Table */}
        <div className="px-6 py-3">
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-slate-500 text-xs font-bold uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left w-8"></th>
                  <th className="px-4 py-2.5 text-left">Batch No.</th>
                  <th className="px-4 py-2.5 text-left">Exp. Date</th>
                  <th className="px-4 py-2.5 text-right">Current Qty</th>
                  <th className="px-4 py-2.5 text-right w-24">Qty</th>
                  <th className="px-4 py-2.5 text-center w-16">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-8 text-slate-400">Loading batches...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-slate-400">
                    {search ? 'No batches match search' : 'No batches found. Click "Add Batch" to create one.'}
                  </td></tr>
                ) : filtered.map((batch, idx) => {
                  const realIdx = batches.indexOf(batch);
                  const isSelected = selectedIdx === realIdx;
                  const isEditing = editIdx === realIdx;
                  return (
                    <tr
                      key={`${batch.batch_no}-${idx}`}
                      onClick={() => setSelectedIdx(realIdx)}
                      className={`border-b border-slate-100 cursor-pointer transition-colors ${
                        isSelected ? 'bg-brand/5 ring-1 ring-inset ring-brand/20' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          isSelected ? 'border-brand bg-brand' : 'border-slate-300'
                        }`}>
                          {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {isEditing ? (
                          <input value={editBatch} onChange={e => setEditBatch(e.target.value)}
                            className="w-full h-7 border border-brand rounded px-2 text-xs font-mono focus:outline-none" autoFocus />
                        ) : (
                          <span className="font-mono font-semibold text-slate-700">{batch.batch_no}</span>
                        )}
                        {batch.isNew && <span className="ml-2 text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">NEW</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {isEditing ? (
                          <SmartExpiryInput
                            value={editExpiry}
                            onChange={setEditExpiry}
                            placeholder="MM/YY"
                            className="!h-7"
                          />
                        ) : (
                          formatExpiry(batch.expiry_date)
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-700">
                        {batch.current_qty}
                      </td>
                      <td className="px-4 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                        <input
                          type="number"
                          min={0}
                          value={qtyInputs[realIdx] || ''}
                          onChange={e => setQtyInputs(prev => ({ ...prev, [realIdx]: Number(e.target.value) || 0 }))}
                          onClick={() => setSelectedIdx(realIdx)}
                          placeholder="0"
                          className="w-20 h-7 border border-slate-200 rounded px-2 text-right font-mono text-xs focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand ml-auto block"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          {isEditing ? (
                            <button onClick={() => handleSaveEdit(realIdx)} className="w-6 h-6 rounded flex items-center justify-center text-emerald-600 hover:bg-emerald-50 transition-colors">
                              <Check size={12} />
                            </button>
                          ) : (
                            <button onClick={() => { setEditIdx(realIdx); setEditBatch(batch.batch_no); setEditExpiry(batch.expiry_date); }}
                              className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-brand transition-colors">
                              <Edit2 size={12} />
                            </button>
                          )}
                          {batch.isNew && (
                            <button onClick={() => handleDelete(realIdx)}
                              className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50">
          <div className="text-sm text-slate-600">
            Total: <span className="font-bold text-slate-800 font-mono">{totalQty}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-white transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-6 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-bold transition-colors shadow-sm">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
