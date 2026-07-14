'use client';
import { useState, useEffect } from 'react';
import { getDB } from '@/lib/db';
import { X, Edit3, User, Calendar, CreditCard, Hash, FileText, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

interface BillDetailModalProps {
  txnId: number;
  onClose: () => void;
  onEditPurchase?: (txnId: number) => void;
  onEditSale?: (txnId: number) => void;
}

export default function BillDetailModal({ txnId, onClose, onEditPurchase, onEditSale }: BillDetailModalProps) {
  const [txn, setTxn] = useState<any | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const db = await getDB();
        const [t] = await db.select<any[]>(
          `SELECT t.*, p.name as party_name, p.phone as party_phone, p.gstin as party_gstin
           FROM transactions t LEFT JOIN parties p ON t.party_id = p.id WHERE t.id = $1`,
          [txnId]
        );
        const its = await db.select<any[]>(
          `SELECT * FROM transaction_items WHERE txn_id = $1 ORDER BY id ASC`,
          [txnId]
        );
        setTxn(t || null);
        setItems(its || []);
      } catch (e) {
        console.error('BillDetailModal load error:', e);
      }
      setLoading(false);
    };
    load();
  }, [txnId]);

  const isPurchase = txn?.type === 'purchase';
  const canEdit = isPurchase ? !!onEditPurchase : !!onEditSale;

  const handleEdit = () => {
    if (isPurchase && onEditPurchase) onEditPurchase(txnId);
    else if (!isPurchase && onEditSale) onEditSale(txnId);
    onClose();
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const cfg: Record<string, { cls: string; icon: any; label: string }> = {
      paid:    { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2, label: 'PAID' },
      partial: { cls: 'bg-amber-100 text-amber-700 border-amber-200',     icon: Clock,         label: 'PARTIAL' },
      unpaid:  { cls: 'bg-red-100 text-red-600 border-red-200',           icon: AlertCircle,   label: 'UNPAID' },
    };
    const c = cfg[status] || cfg.paid;
    const Icon = c.icon;
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${c.cls}`}>
        <Icon size={10} />{c.label}
      </span>
    );
  };

  // Compute totals from items for accuracy
  const computedSubtotal = items.reduce((s, it) => s + (it.price || 0) * (it.quantity || 0), 0);
  const computedDiscount = items.reduce((s, it) => {
    const base = (it.price || 0) * (it.quantity || 0);
    return s + base * ((it.discount_pct || 0) / 100);
  }, 0);
  const computedTax = items.reduce((s, it) => {
    const base = (it.price || 0) * (it.quantity || 0);
    const disc = base * ((it.discount_pct || 0) / 100);
    return s + (base - disc) * ((it.tax_pct || 0) / 100);
  }, 0);

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-end"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      {/* Panel */}
      <div className="w-[560px] h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right-6 duration-250">

        {/* ── Header ─────────────────────────────────────── */}
        <div className={`flex-shrink-0 px-6 pt-5 pb-4 border-b ${isPurchase ? 'bg-orange-50 border-orange-100' : 'bg-emerald-50 border-emerald-100'}`}>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              {/* Type + Status row */}
              <div className="flex items-center gap-2 mb-2">
                <span className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md ${isPurchase ? 'bg-orange-200 text-orange-800' : 'bg-emerald-200 text-emerald-800'}`}>
                  <FileText size={9} />
                  {isPurchase ? 'Purchase Bill' : 'Sale Invoice'}
                </span>
                {txn?.status && <StatusBadge status={txn.status} />}
              </div>
              {/* Invoice number */}
              <h2 className="text-2xl font-black text-slate-900 font-mono tracking-tight leading-none">
                {txn?.invoice_no || `#${txnId}`}
              </h2>
              {/* Party */}
              {txn?.party_name && (
                <div className="flex items-center gap-1.5 mt-2">
                  <User size={12} className="text-slate-400 flex-shrink-0" />
                  <span className="text-sm font-semibold text-slate-700 truncate">{txn.party_name}</span>
                  {txn.party_phone && (
                    <span className="text-xs text-slate-400 font-mono">· {txn.party_phone}</span>
                  )}
                </div>
              )}
            </div>
            {/* Action buttons */}
            <div className="flex items-center gap-2 ml-3 flex-shrink-0">
              {canEdit && (
                <button
                  onClick={handleEdit}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-bold shadow-sm transition-all hover:shadow-md active:scale-95`}
                  style={{ color: '#ffffff', backgroundColor: isPurchase ? '#f97316' : '#059669', border: 'none', cursor: 'pointer' }}
                >
                  <Edit3 size={12} /> Edit Bill
                </button>
              )}
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors shadow-sm"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Meta info row */}
          {txn && (
            <div className="flex items-center gap-5 mt-3 pt-3 border-t border-black/10 text-xs text-slate-600">
              <div className="flex items-center gap-1.5">
                <Calendar size={12} className="text-slate-400" />
                <span className="font-medium">
                  {txn.date
                    ? new Date(txn.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '—'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <CreditCard size={12} className="text-slate-400" />
                <span className="font-medium capitalize">{txn.payment_type || 'Cash'}</span>
              </div>
              {txn.challan_no && (
                <div className="flex items-center gap-1.5">
                  <Hash size={12} className="text-slate-400" />
                  <span className="font-mono">{txn.challan_no}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Items Table ────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <div className="w-8 h-8 border-2 border-slate-200 border-t-brand rounded-full animate-spin" />
                <span className="text-sm">Loading bill details...</span>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-400">
              <FileText size={32} className="opacity-30 mb-2" />
              <p className="text-sm">No item details available</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              {/* Table header */}
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100 border-b border-slate-200">
                  <th className="pl-6 pr-2 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 w-full">
                    Item / Description
                  </th>
                  <th className="px-2 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap w-12">
                    Qty
                  </th>
                  <th className="px-2 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap w-20">
                    Rate ₹
                  </th>
                  <th className="pl-2 pr-6 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap w-24">
                    Amount ₹
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, i) => {
                  const base = (item.price || 0) * (item.quantity || 0);
                  const discAmt = base * ((item.discount_pct || 0) / 100);
                  const taxAmt = (base - discAmt) * ((item.tax_pct || 0) / 100);
                  const rowAmount = item.amount ?? (base - discAmt + taxAmt);

                  return (
                    <tr key={item.id ?? i} className="hover:bg-slate-50/80 transition-colors">
                      {/* Item name + tags */}
                      <td className="pl-6 pr-2 py-3 align-top">
                        <p className="font-semibold text-slate-800 text-sm leading-snug">{item.item_name || '—'}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.batch_no && (
                            <span className="inline-block text-[10px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                              Batch: {item.batch_no}
                            </span>
                          )}
                          {item.expiry_date && (
                            <span className="inline-block text-[10px] font-mono bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                              Exp: {item.expiry_date}
                            </span>
                          )}
                          {(item.discount_pct || 0) > 0 && (
                            <span className="inline-block text-[10px] font-bold bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded">
                              -{item.discount_pct}% disc
                            </span>
                          )}
                          {(item.tax_pct || 0) > 0 && (
                            <span className="inline-block text-[10px] font-bold bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">
                              GST {item.tax_pct}%
                            </span>
                          )}
                        </div>
                      </td>
                      {/* Qty */}
                      <td className="px-2 py-3 text-right align-top">
                        <span className="font-bold text-slate-700 font-mono tabular-nums">{item.quantity ?? '—'}</span>
                      </td>
                      {/* Rate */}
                      <td className="px-2 py-3 text-right align-top">
                        <span className="font-mono text-slate-600 tabular-nums">
                          {item.price != null ? item.price.toFixed(2) : '—'}
                        </span>
                      </td>
                      {/* Amount */}
                      <td className="pl-2 pr-6 py-3 text-right align-top">
                        <span className="font-bold font-mono text-slate-900 tabular-nums text-sm">
                          {rowAmount.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Totals Footer ──────────────────────────────── */}
        {txn && !loading && (
          <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50">
            {/* Breakdown */}
            <div className="px-6 py-4 space-y-2">
              {computedDiscount > 0 && (
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums">₹{computedSubtotal.toFixed(2)}</span>
                </div>
              )}
              {computedDiscount > 0 && (
                <div className="flex justify-between text-sm text-orange-600">
                  <span>Discount</span>
                  <span className="font-mono tabular-nums">-₹{computedDiscount.toFixed(2)}</span>
                </div>
              )}
              {computedTax > 0 && (
                <div className="flex justify-between text-sm text-purple-600">
                  <span>Tax (GST)</span>
                  <span className="font-mono tabular-nums">+₹{computedTax.toFixed(2)}</span>
                </div>
              )}

              {/* Total */}
              <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                <span className="text-base font-bold text-slate-800">Total</span>
                <span className="text-xl font-black font-mono text-slate-900 tabular-nums">
                  ₹{(txn.total_amount ?? 0).toFixed(2)}
                </span>
              </div>

              {/* Payment rows */}
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">{isPurchase ? 'Paid' : 'Received'}</span>
                <span className="font-semibold font-mono text-emerald-600 tabular-nums">
                  ₹{(txn.paid_amount ?? 0).toFixed(2)}
                </span>
              </div>

              {(txn.balance_due ?? 0) > 0 && (
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-red-500">Balance Due</span>
                  <span className="font-mono text-red-500 tabular-nums">₹{txn.balance_due.toFixed(2)}</span>
                </div>
              )}

              {txn.description && (
                <p className="text-xs text-slate-400 pt-2 border-t border-slate-100 italic">
                  {txn.description}
                </p>
              )}
            </div>

            {/* Edit CTA */}
            {canEdit && (
              <div className="px-6 pb-5">
                <button
                  onClick={handleEdit}
                  className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white transition-all hover:shadow-lg active:scale-[0.98]`}
                  style={{ color: '#ffffff', backgroundColor: isPurchase ? '#f97316' : '#059669', border: 'none', cursor: 'pointer' }}
                >
                  <Edit3 size={15} /> Edit This Bill
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
