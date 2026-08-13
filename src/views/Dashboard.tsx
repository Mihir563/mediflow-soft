'use client';
import { useState, useMemo } from 'react';
import { useDashboardStats, DashboardFilterOptions } from '@/lib/useStoreData';
import { useAuth } from '@/lib/AuthContext';
import { FileText, ShoppingCart, TrendingUp, Package, Users, ArrowUpRight, RefreshCw, Receipt, BarChart2, Wifi, WifiOff, AlertCircle, Calendar, Filter } from 'lucide-react';
import SmartDateInput from '@/components/SmartDateInput';
import BillDetailModal from '@/components/BillDetailModal';

type Page = 'dashboard' | 'pos' | 'sale' | 'purchase' | 'parties' | 'items' | 'reports' | 'settings' | 'purchase_history' | 'order_book';

interface DashboardProps {
  onNavigate: (p: Page) => void;
  onEditPurchase?: (txnId: any) => void;
  onEditSale?: (txnId: any) => void;
}

type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'all' | 'custom';

const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, string> = {
    paid: 'bg-emerald-100 text-emerald-700',
    partial: 'bg-amber-100 text-amber-700',
    unpaid: 'bg-red-100 text-red-600',
  };
  return (
    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${map[status] || map.paid}`}>
      {status || 'paid'}
    </span>
  );
};

export default function Dashboard({ onNavigate, onEditPurchase, onEditSale }: DashboardProps) {
  const { isOnline, activeStore } = useAuth();
  
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  
  const [preset, setPreset] = useState<DatePreset>('today');
  const [dateType, setDateType] = useState<'bill_date' | 'added_date'>('bill_date');
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);
  const [selectedTxnId, setSelectedTxnId] = useState<string | number | null>(null);

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    if (p === 'today') {
      setFromDate(today);
      setToDate(today);
    } else if (p === 'yesterday') {
      const y = new Date(now);
      y.setDate(now.getDate() - 1);
      const yStr = y.toISOString().split('T')[0];
      setFromDate(yStr);
      setToDate(yStr);
    } else if (p === 'week') {
      const mon = new Date(now);
      const day = mon.getDay();
      const diff = mon.getDate() - day + (day === 0 ? -6 : 1);
      mon.setDate(diff);
      setFromDate(mon.toISOString().split('T')[0]);
      setToDate(today);
    } else if (p === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      setFromDate(first.toISOString().split('T')[0]);
      setToDate(today);
    } else if (p === 'year') {
      const first = new Date(now.getFullYear(), 0, 1);
      setFromDate(first.toISOString().split('T')[0]);
      setToDate(today);
    } else if (p === 'all') {
      setFromDate('');
      setToDate('');
    }
  };

  const filterOpts: DashboardFilterOptions = useMemo(() => ({
    fromDate: preset === 'all' ? '' : fromDate,
    toDate: preset === 'all' ? '' : toDate,
    dateType,
  }), [fromDate, toDate, dateType, preset]);

  const { stats, recentTxns, loading, refetch } = useDashboardStats(filterOpts);

  const periodLabel = useMemo(() => {
    if (preset === 'today') return "Today's Activity";
    if (preset === 'yesterday') return "Yesterday's Activity";
    if (preset === 'week') return "This Week's Activity";
    if (preset === 'month') return "This Month's Activity";
    if (preset === 'year') return "This Year's Activity";
    if (preset === 'all') return "All Time Activity";
    if (fromDate && toDate) return `Activity (${fromDate} to ${toDate})`;
    return "Activity Overview";
  }, [preset, fromDate, toDate]);

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">

        {/* ── Top Header & Date Filter Bar */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-brand">
                <Calendar size={18} />
              </div>
              <div>
                <h1 className="text-base font-extrabold text-slate-800 tracking-tight">Dashboard Overview</h1>
                <p className="text-xs text-slate-400 font-medium">Filter statistics & recent bills by date range</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-slate-50 text-xs font-semibold">
                <button
                  onClick={() => setDateType('bill_date')}
                  className={`px-3 py-1.5 transition-colors ${dateType === 'bill_date' ? 'bg-brand text-white shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Bill Date
                </button>
                <button
                  onClick={() => setDateType('added_date')}
                  className={`px-3 py-1.5 transition-colors ${dateType === 'added_date' ? 'bg-brand text-white shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Added Date
                </button>
              </div>

              <button
                onClick={refetch}
                className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:text-brand hover:border-brand transition-colors bg-white"
                title="Refresh Dashboard"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {/* Presets & Custom Date Pickers */}
          <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { id: 'today', label: 'Today' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: 'week', label: 'This Week' },
                { id: 'month', label: 'This Month' },
                { id: 'year', label: 'This Year' },
                { id: 'all', label: 'All Time' },
                { id: 'custom', label: 'Custom' },
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id as DatePreset)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${
                    preset === p.id
                      ? 'bg-blue-50 border-brand text-brand font-bold shadow-xs'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom Date Pickers */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400 font-medium">From:</span>
                <div className="w-32">
                  <SmartDateInput
                    value={fromDate}
                    onChange={v => { setFromDate(v); setPreset('custom'); }}
                    className="!h-8 !px-2.5 text-xs font-mono"
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400 font-medium">To:</span>
                <div className="w-32">
                  <SmartDateInput
                    value={toDate}
                    onChange={v => { setToDate(v); setPreset('custom'); }}
                    className="!h-8 !px-2.5 text-xs font-mono"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Cloud status banner */}
        {!isOnline && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <WifiOff size={16} className="text-amber-500 flex-shrink-0" />
            <p className="text-sm text-amber-700 font-medium">
              You're offline — showing last synced data. Changes will sync when connection is restored.
            </p>
          </div>
        )}
        {isOnline && activeStore && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
            <Wifi size={14} className="text-emerald-500 flex-shrink-0" />
            <p className="text-xs text-emerald-700 font-medium">
              Connected to cloud · {activeStore.name} · Real-time data
            </p>
          </div>
        )}

        {/* ── Period Label */}
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-400">{periodLabel}</h2>
        </div>

        {/* ── Top Summary Cards */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { page: 'sale' as Page, label: "Sales", sub: `${stats.todayInvoices} invoice${stats.todayInvoices !== 1 ? 's' : ''} in period`, value: `₹${stats.todaySales.toFixed(0)}`, allTime: stats.totalSalesAllTime, icon: TrendingUp, color: 'emerald' },
            { page: 'purchase' as Page, label: "Purchases", sub: `${stats.todayPurchaseCount} bill${stats.todayPurchaseCount !== 1 ? 's' : ''} in period`, value: `₹${stats.todayPurchases.toFixed(0)}`, allTime: stats.totalPurchasesAllTime, icon: ShoppingCart, color: 'orange' },
            { page: 'items' as Page, label: 'Total Items', sub: 'In inventory', value: String(stats.totalItems), icon: Package, color: 'blue' },
            { page: 'parties' as Page, label: 'Total Parties', sub: 'Customers & vendors', value: String(stats.totalParties), icon: Users, color: 'purple' },
          ].map(card => {
            const Icon = card.icon;
            const colorMap: Record<string, { border: string; bg: string; icon: string; arrow: string; allTime: string }> = {
              emerald: { border: 'hover:border-emerald-300', bg: 'from-emerald-50/0 to-emerald-50', icon: 'bg-emerald-100 text-emerald-600', arrow: 'group-hover:text-emerald-500', allTime: 'text-emerald-600' },
              orange:  { border: 'hover:border-orange-300',  bg: 'from-orange-50/0 to-orange-50',   icon: 'bg-orange-100 text-orange-600',   arrow: 'group-hover:text-orange-500',  allTime: 'text-orange-600'  },
              blue:    { border: 'hover:border-blue-300',    bg: 'from-blue-50/0 to-blue-50',       icon: 'bg-blue-100 text-blue-600',       arrow: 'group-hover:text-blue-500',    allTime: 'text-blue-600'    },
              purple:  { border: 'hover:border-purple-300',  bg: 'from-purple-50/0 to-purple-50',   icon: 'bg-purple-100 text-purple-600',   arrow: 'group-hover:text-purple-500',  allTime: 'text-purple-600'  },
            };
            const c = colorMap[card.color];
            return (
              <button key={card.page} onClick={() => onNavigate(card.page)}
                className={`bg-white rounded-2xl border border-slate-200 p-5 text-left hover:shadow-lg ${c.border} transition-all group relative overflow-hidden`}>
                <div className={`absolute inset-0 bg-gradient-to-br ${c.bg} opacity-0 group-hover:opacity-100 transition-opacity`} />
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-10 h-10 rounded-xl ${c.icon} flex items-center justify-center`}><Icon size={20} /></div>
                    <ArrowUpRight size={16} className={`text-slate-300 ${c.arrow} transition-colors`} />
                  </div>
                  {loading ? (
                    <div className="w-20 h-7 bg-slate-100 rounded animate-pulse" />
                  ) : (
                    <p className="text-2xl font-black text-slate-800 tabular-nums">{card.value}</p>
                  )}
                  <p className="text-sm font-semibold text-slate-500 mt-1">{card.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{card.sub}</p>
                  {card.allTime != null && card.allTime > 0 && !loading && (
                    <p className={`text-[10px] ${c.allTime} font-medium mt-2`}>All time: ₹{card.allTime.toFixed(0)}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Pending balance card (only if > 0) */}
        {stats.pendingBalance > 0 && (
          <div className="flex items-center gap-4 bg-red-50 border border-red-200 rounded-2xl px-6 py-4">
            <AlertCircle size={20} className="text-red-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold text-red-700">Pending Receivables</p>
              <p className="text-xs text-red-500 mt-0.5">Unpaid balance from customers</p>
            </div>
            <p className="text-xl font-black text-red-600 tabular-nums">₹{stats.pendingBalance.toFixed(0)}</p>
            <button onClick={() => onNavigate('parties')} className="text-xs bg-red-100 hover:bg-red-200 text-red-700 font-semibold px-3 py-1.5 rounded-lg transition-colors">
              View Parties →
            </button>
          </div>
        )}

        {/* ── Quick Actions */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-4 gap-3">
            {[
              { page: 'pos' as Page,      label: 'Fast Billing',  sub: 'Quick POS',    shortcut: 'F2',    bg: 'bg-brand',        light: 'bg-blue-50 hover:bg-blue-100 border-blue-200',     text: 'text-blue-700',   icon: Receipt },
              { page: 'sale' as Page,     label: 'Sale Invoice',  sub: 'New invoice',  shortcut: 'Alt+2', bg: 'bg-emerald-600',  light: 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200', text: 'text-emerald-700', icon: TrendingUp },
              { page: 'purchase' as Page, label: 'Purchase Bill', sub: 'New purchase', shortcut: 'Alt+3', bg: 'bg-orange-500',   light: 'bg-orange-50 hover:bg-orange-100 border-orange-200',   text: 'text-orange-700', icon: ShoppingCart },
              { page: 'reports' as Page,  label: 'Reports',       sub: 'View analytics', shortcut: 'Alt+6', bg: 'bg-purple-600', light: 'bg-purple-50 hover:bg-purple-100 border-purple-200',   text: 'text-purple-700', icon: BarChart2 },
            ].map(item => {
              const Icon = item.icon;
              return (
                <button key={item.page} onClick={() => onNavigate(item.page)}
                  className={`flex items-center gap-3 p-4 rounded-xl border ${item.light} transition-all group text-left`}>
                  <div className={`w-9 h-9 ${item.bg} rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm group-hover:scale-110 transition-transform`}>
                    <Icon size={17} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className={`text-sm font-bold ${item.text} truncate`}>{item.label}</p>
                    <p className="text-xs text-slate-400 truncate">{item.sub}</p>
                    <kbd className={`text-[10px] ${item.text} opacity-60 font-mono mt-0.5 block`}>{item.shortcut}</kbd>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Recent Transactions */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Recent Transactions</h2>
              <p className="text-xs text-slate-400 mt-0.5">{recentTxns.length} bills found · click any row to view details</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={refetch}
                className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-brand hover:border-brand transition-colors"
                title="Refresh">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
              <button onClick={() => onNavigate('reports')} className="text-xs text-brand font-semibold hover:underline">
                View All →
              </button>
            </div>
          </div>

          {loading ? (
            <div className="py-12 flex flex-col items-center gap-3 text-slate-400">
              <div className="w-6 h-6 border-2 border-slate-200 border-t-brand rounded-full animate-spin" />
              <span className="text-sm">Loading transactions...</span>
            </div>
          ) : recentTxns.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-slate-400">
              <FileText size={36} className="opacity-20 mb-3" />
              <p className="text-sm font-medium">No transactions found for this period</p>
              <p className="text-xs mt-1">Try changing your date filter or create a new sale / purchase</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                  <th className="pl-6 py-2.5 text-left">Invoice</th>
                  <th className="px-3 py-2.5 text-left">Party</th>
                  <th className="px-3 py-2.5 text-left">Type</th>
                  <th className="px-3 py-2.5 text-left">Bill Date</th>
                  <th className="px-3 py-2.5 text-left">Added</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="pl-3 pr-6 py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {recentTxns.map((txn) => (
                  <tr key={txn.id} onClick={() => setSelectedTxnId(txn.id)}
                    className="hover:bg-blue-50/50 cursor-pointer transition-colors group">
                    <td className="pl-6 py-3">
                      <span className="font-mono text-xs font-bold text-brand group-hover:underline">
                        {txn.invoice_no || `#${String(txn.id).slice(0, 8)}`}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-700 font-medium text-sm max-w-[160px] truncate">
                      {txn.party_name || <span className="text-slate-400 italic font-normal">Walk-in</span>}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${txn.type === 'sale' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                        {txn.type}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-500 text-xs font-mono whitespace-nowrap">
                      {txn.date ? new Date(txn.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                    </td>
                    <td className="px-3 py-3 text-slate-400 text-xs whitespace-nowrap" title={txn.created_at ? new Date(txn.created_at).toLocaleString('en-IN') : ''}>
                      {txn.created_at
                        ? new Date(txn.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
                        : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-bold font-mono text-slate-800 tabular-nums">
                      ₹{(txn.total_amount ?? 0).toFixed(2)}
                    </td>
                    <td className="pl-3 pr-6 py-3 text-right">
                      <StatusBadge status={txn.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Bill Detail Modal overlay */}
      {selectedTxnId && (
        <BillDetailModal
          txnId={selectedTxnId}
          onClose={() => setSelectedTxnId(null)}
          onEditPurchase={onEditPurchase}
          onEditSale={onEditSale}
        />
      )}
    </div>
  );
}
