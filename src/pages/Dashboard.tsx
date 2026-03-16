'use client';
import { useState, useEffect } from 'react';
import { getDB } from '@/lib/db';
import { FileText, ShoppingCart, TrendingUp, Package, Users, ArrowUp, ArrowDown } from 'lucide-react';

type Page = 'dashboard' | 'pos' | 'sale' | 'purchase' | 'parties' | 'items' | 'reports' | 'settings';

interface DashboardProps { onNavigate: (p: Page) => void; }

export default function Dashboard({ onNavigate }: DashboardProps) {
  const [stats, setStats] = useState({ todaySales: 0, todayInvoices: 0, todayPurchases: 0, totalItems: 0, totalParties: 0 });
  const [recentTxns, setRecentTxns] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const db = await getDB();
      const today = new Date().toISOString().split('T')[0];

      const [todaySalesResult, todayPurchasesResult, itemsResult, partiesResult, recentResult] = await Promise.all([
        db.select<any[]>(`SELECT COALESCE(SUM(total_amount),0) as total, COUNT(*) as cnt FROM transactions WHERE type='sale' AND date LIKE $1`, [`${today}%`]),
        db.select<any[]>(`SELECT COALESCE(SUM(total_amount),0) as total FROM transactions WHERE type='purchase' AND date LIKE $1`, [`${today}%`]),
        db.select<any[]>('SELECT COUNT(*) as cnt FROM items'),
        db.select<any[]>('SELECT COUNT(*) as cnt FROM parties'),
        db.select<any[]>(`SELECT t.*, p.name as party_name FROM transactions t LEFT JOIN parties p ON t.party_id=p.id ORDER BY t.id DESC LIMIT 10`),
      ]);

      setStats({
        todaySales: todaySalesResult[0]?.total || 0,
        todayInvoices: todaySalesResult[0]?.cnt || 0,
        todayPurchases: todayPurchasesResult[0]?.total || 0,
        totalItems: itemsResult[0]?.cnt || 0,
        totalParties: partiesResult[0]?.cnt || 0,
      });
      setRecentTxns(recentResult || []);
    } catch (e) { console.error(e); }
  };

  const statCards = [
    { label: "Today's Sales", value: `₹${stats.todaySales.toFixed(2)}`, sub: `${stats.todayInvoices} invoices`, icon: TrendingUp, color: 'green', page: 'sale' as Page },
    { label: "Today's Purchases", value: `₹${stats.todayPurchases.toFixed(2)}`, sub: 'Expenses today', icon: ShoppingCart, color: 'orange', page: 'purchase' as Page },
    { label: 'Total Items', value: stats.totalItems.toString(), sub: 'In inventory', icon: Package, color: 'blue', page: 'items' as Page },
    { label: 'Total Parties', value: stats.totalParties.toString(), sub: 'Customers & vendors', icon: Users, color: 'purple', page: 'parties' as Page },
  ];

  const colorMap: Record<string, string> = {
    green: 'bg-green-100 text-green-700',
    orange: 'bg-orange-100 text-orange-700',
    blue: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Stat Cards */}
        <div className="grid grid-cols-4 gap-4">
          {statCards.map(card => {
            const Icon = card.icon;
            return (
              <button key={card.label} onClick={() => onNavigate(card.page)}
                className="bg-white rounded-xl border border-slate-200 p-5 text-left hover:shadow-md hover:border-blue-300 transition-all group">
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorMap[card.color]}`}>
                    <Icon size={20} />
                  </div>
                  <ArrowUp size={14} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
                </div>
                <p className="text-2xl font-bold text-slate-800">{card.value}</p>
                <p className="text-sm text-slate-500 mt-1">{card.label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{card.sub}</p>
              </button>
            );
          })}
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-4">Quick Actions</h2>
          <div className="flex gap-3">
            <button onClick={() => onNavigate('pos')} className="flex-1 flex flex-col items-center gap-2 py-4 bg-blue-50 hover:bg-blue-100 rounded-xl border border-blue-200 transition-colors group">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                <FileText size={18} className="text-white" />
              </div>
              <span className="text-sm font-medium text-blue-700">Fast Billing</span>
              <kbd className="text-xs bg-blue-100 text-blue-500 px-2 py-0.5 rounded font-mono">F2</kbd>
            </button>
            <button onClick={() => onNavigate('sale')} className="flex-1 flex flex-col items-center gap-2 py-4 bg-green-50 hover:bg-green-100 rounded-xl border border-green-200 transition-colors">
              <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                <TrendingUp size={18} className="text-white" />
              </div>
              <span className="text-sm font-medium text-green-700">Sale Invoice</span>
              <kbd className="text-xs bg-green-100 text-green-500 px-2 py-0.5 rounded font-mono">Alt+2</kbd>
            </button>
            <button onClick={() => onNavigate('purchase')} className="flex-1 flex flex-col items-center gap-2 py-4 bg-orange-50 hover:bg-orange-100 rounded-xl border border-orange-200 transition-colors">
              <div className="w-10 h-10 bg-orange-600 rounded-lg flex items-center justify-center">
                <ShoppingCart size={18} className="text-white" />
              </div>
              <span className="text-sm font-medium text-orange-700">Purchase Bill</span>
              <kbd className="text-xs bg-orange-100 text-orange-500 px-2 py-0.5 rounded font-mono">Alt+3</kbd>
            </button>
            <button onClick={() => onNavigate('parties')} className="flex-1 flex flex-col items-center gap-2 py-4 bg-purple-50 hover:bg-purple-100 rounded-xl border border-purple-200 transition-colors">
              <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
                <Users size={18} className="text-white" />
              </div>
              <span className="text-sm font-medium text-purple-700">Parties</span>
              <kbd className="text-xs bg-purple-100 text-purple-500 px-2 py-0.5 rounded font-mono">Alt+4</kbd>
            </button>
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Recent Transactions</h2>
            <button onClick={() => onNavigate('reports')} className="text-xs text-blue-600 hover:underline">View All →</button>
          </div>
          {recentTxns.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <FileText size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No transactions yet. Start billing!</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-100">
                  <th className="text-left py-2 font-medium">Invoice</th>
                  <th className="text-left py-2 font-medium">Party</th>
                  <th className="text-left py-2 font-medium">Type</th>
                  <th className="text-left py-2 font-medium">Date</th>
                  <th className="text-right py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recentTxns.map((txn, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 font-mono text-xs text-slate-600">{txn.invoice_no || `#${txn.id}`}</td>
                    <td className="py-2.5 text-slate-700">{txn.party_name || 'Walk-in Customer'}</td>
                    <td className="py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${txn.type === 'sale' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                        {txn.type}
                      </span>
                    </td>
                    <td className="py-2.5 text-slate-500 text-xs">{txn.date?.split('T')[0]}</td>
                    <td className="py-2.5 text-right font-semibold text-slate-800">₹{txn.total_amount?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
