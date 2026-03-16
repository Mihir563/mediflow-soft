'use client';

import { useState, useEffect, useCallback } from 'react';
import FastBilling from '@/components/FastBilling';
import Dashboard from '@/pages/Dashboard';
import SaleInvoice from '@/pages/SaleInvoice';
import PurchaseBill from '@/pages/PurchaseBill';
import Parties from '@/pages/Parties';
import Items from '@/pages/Items';
import Reports from '@/pages/Reports';
import Settings from '@/pages/Settings';
import GlobalSearch from '@/components/GlobalSearch';
import {
  LayoutDashboard, Zap, FileText, ShoppingCart,
  Users, Package, BarChart3, Settings2, ChevronRight,
  Activity
} from 'lucide-react';

type Page = 'dashboard' | 'pos' | 'sale' | 'purchase' | 'parties' | 'items' | 'reports' | 'settings';

const navItems: { page: Page; label: string; icon: any; shortcut: string; group?: string }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, shortcut: 'Alt+1', group: 'Main' },
  { page: 'pos', label: 'Fast Billing (POS)', icon: Zap, shortcut: 'F2', group: 'Sales' },
  { page: 'sale', label: 'Sale Invoice', icon: FileText, shortcut: 'Alt+2' },
  { page: 'purchase', label: 'Purchase Bill', icon: ShoppingCart, shortcut: 'Alt+3', group: 'Purchase' },
  { page: 'parties', label: 'Parties', icon: Users, shortcut: 'Alt+4', group: 'Books' },
  { page: 'items', label: 'Items', icon: Package, shortcut: 'Alt+5' },
  { page: 'reports', label: 'Reports', icon: BarChart3, shortcut: 'Alt+6' },
  { page: 'settings', label: 'Settings', icon: Settings2, shortcut: 'Alt+7', group: 'System' },
];

export default function Home() {
  const [page, setPage] = useState<Page>('dashboard');
  const [newSale, setNewSale] = useState(false);

  const navigate = useCallback((p: Page) => setPage(p), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault(); navigate('pos');
      }
      if (e.altKey) {
        const map: Record<string, Page> = { '1': 'dashboard', '2': 'sale', '3': 'purchase', '4': 'parties', '5': 'items', '6': 'reports', '7': 'settings' };
        if (map[e.key]) { e.preventDefault(); navigate(map[e.key]); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  const groups = ['Main', 'Sales', 'Purchase', 'Books', 'System'];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col bg-slate-900 border-r border-slate-800">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Activity size={16} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-none">MediFlow</p>
              <p className="text-slate-400 text-xs mt-0.5">Offline POS</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-0.5">
          {groups.map(group => {
            const groupItems = navItems.filter(i => i.group === group);
            if (!groupItems.length) return null;
            return (
              <div key={group}>
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider px-3 py-2 mt-2">{group}</p>
                {groupItems.map(item => {
                  const Icon = item.icon;
                  const active = page === item.page;
                  return (
                    <button
                      key={item.page}
                      onClick={() => navigate(item.page)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all group relative ${
                        active
                          ? 'bg-blue-600 text-white font-medium shadow-lg shadow-blue-900/30'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <Icon size={15} className="flex-shrink-0" />
                      <span className="flex-1 text-left">{item.label}</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${active ? 'bg-blue-500 text-blue-100' : 'bg-slate-800 text-slate-500 group-hover:bg-slate-700'}`}>
                        {item.shortcut}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Bottom store info */}
        <div className="px-3 py-3 border-t border-slate-800">
          <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-slate-800">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex-shrink-0 flex items-center justify-center text-white text-xs font-bold">R</div>
            <div className="overflow-hidden">
              <p className="text-white text-xs font-medium truncate">Raghuveer Medical</p>
              <p className="text-slate-400 text-xs truncate">Provision Store</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-slate-50">
        {/* Top Bar */}
        <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-slate-200 shadow-sm flex-shrink-0">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            {navItems.find(i => i.page === page)?.label && (
              <>
                <span className="text-slate-400">MediFlow</span>
                <ChevronRight size={14} className="text-slate-300" />
                <span className="text-slate-700 font-medium">{navItems.find(i => i.page === page)?.label}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <GlobalSearch onNavigate={(p) => navigate(p as any)} />
            <button onClick={() => navigate('sale')} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors">
              <FileText size={14} /> + Sale
            </button>
            <button onClick={() => navigate('purchase')} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
              <ShoppingCart size={14} /> + Purchase
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-hidden">
          {page === 'dashboard' && <Dashboard onNavigate={navigate} />}
          {page === 'pos' && <FastBilling />}
          {page === 'sale' && <SaleInvoice />}
          {page === 'purchase' && <PurchaseBill />}
          {page === 'parties' && <Parties />}
          {page === 'items' && <Items />}
          {page === 'reports' && <Reports />}
          {page === 'settings' && <Settings />}
        </div>
      </main>
    </div>
  );
}
