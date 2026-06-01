'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import FastBilling from '@/components/FastBilling';
import Dashboard from '@/views/Dashboard';
import SaleInvoice from '@/views/SaleInvoice';
import PurchaseBill from '@/views/PurchaseBill';
import PurchaseHistory from '@/views/PurchaseHistory';
import Parties from '@/views/Parties';
import Items from '@/views/Items';
import Reports from '@/views/Reports';
import Settings from '@/views/Settings';
import OrderBook from '@/views/OrderBook';
import GlobalSearch from '@/components/GlobalSearch';
import LoginPage from '@/components/LoginPage';
import StoreSelector from '@/components/StoreSelector';
import AdminDashboard from '@/components/AdminDashboard';
import BillTabBar, { BillTab } from '@/components/BillTabBar';
import { useAuth } from '@/lib/AuthContext';
import { MediFlowLogo } from '@/components/MediFlowLogo';
import {
  LayoutDashboard, Zap, FileText, ShoppingCart,
  Users, Package, BarChart3, Settings2, ChevronRight,
  Activity, Keyboard, X, PanelLeftClose, PanelLeftOpen, Bookmark,
  ArrowLeft, LogOut, Shield, Wifi, WifiOff,
} from 'lucide-react';

type Page = 'dashboard' | 'pos' | 'sale' | 'purchase' | 'purchase_history' | 'parties' | 'items' | 'reports' | 'settings' | 'order_book';

const navItems: { page: Page; label: string; icon: any; shortcut: string; group?: string }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, shortcut: 'Alt+1', group: 'Main' },
  { page: 'pos', label: 'Fast Billing (POS)', icon: Zap, shortcut: 'F2', group: 'Sales' },
  { page: 'sale', label: 'Sale Invoice', icon: FileText, shortcut: 'Alt+2', group: 'Sales' },
  { page: 'purchase', label: 'Purchase Bill', icon: ShoppingCart, shortcut: 'Alt+3', group: 'Purchase' },
  { page: 'purchase_history', label: 'Purchase History', icon: FileText, shortcut: 'Alt+H', group: 'Purchase' },
  { page: 'order_book', label: 'Order Book', icon: Bookmark, shortcut: 'Alt+8', group: 'Purchase' },
  { page: 'parties', label: 'Parties', icon: Users, shortcut: 'Alt+4', group: 'Books' },
  { page: 'items', label: 'Items', icon: Package, shortcut: 'Alt+5', group: 'Books' },
  { page: 'reports', label: 'Reports', icon: BarChart3, shortcut: 'Alt+6', group: 'Books' },
  { page: 'settings', label: 'Settings', icon: Settings2, shortcut: 'Alt+7', group: 'System' },
];

// ─── Tab helpers ───────────────────────────────────────────────────────────────
let tabSeq = 0;
const newTabId = () => `tab-${++tabSeq}-${Date.now()}`;

const makeNewPurchaseTab = (): BillTab => ({ id: newTabId(), label: 'New Purchase', editTxnId: null, isDirty: false });
const makeNewSaleTab = (): BillTab => ({ id: newTabId(), label: 'New Sale', editTxnId: null, isDirty: false });

export default function Home() {
  // ── Auth state ──────────────────────────────────────────────────────────────
  const { user, profile, loading: authLoading, isSuperAdmin, activeStore, activeRole, signOut, isOnline } = useAuth();
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!authLoading) setAuthReady(true);
  }, [authLoading]);

  // ── Billing app state ────────────────────────────────────────────────────────
  const [page, setPage] = useState<Page>('dashboard');
  const [pageHistory, setPageHistory] = useState<Page[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── Tab state ────────────────────────────────────────────────────────────────
  const [purchaseTabs, setPurchaseTabs] = useState<BillTab[]>(() => [makeNewPurchaseTab()]);
  const [activePurchaseTabId, setActivePurchaseTabId] = useState(() => purchaseTabs[0].id);
  const [saleTabs, setSaleTabs] = useState<BillTab[]>(() => [makeNewSaleTab()]);
  const [activeSaleTabId, setActiveSaleTabId] = useState(() => saleTabs[0].id);

  // Update a tab label (called from PurchaseBill/SaleInvoice when bill number changes)
  const updatePurchaseTabLabel = useCallback((tabId: string, label: string, isDirty?: boolean) => {
    setPurchaseTabs(prev => prev.map(t => t.id === tabId ? { ...t, label, ...(isDirty !== undefined ? { isDirty } : {}) } : t));
  }, []);
  const updateSaleTabLabel = useCallback((tabId: string, label: string, isDirty?: boolean) => {
    setSaleTabs(prev => prev.map(t => t.id === tabId ? { ...t, label, ...(isDirty !== undefined ? { isDirty } : {}) } : t));
  }, []);

  // Add a new purchase tab
  const addPurchaseTab = useCallback(() => {
    const tab = makeNewPurchaseTab();
    setPurchaseTabs(prev => [...prev, tab]);
    setActivePurchaseTabId(tab.id);
  }, []);

  // Add a new sale tab
  const addSaleTab = useCallback(() => {
    const tab = makeNewSaleTab();
    setSaleTabs(prev => [...prev, tab]);
    setActiveSaleTabId(tab.id);
  }, []);

  // Close a purchase tab
  const closePurchaseTab = useCallback((tabId: string) => {
    setPurchaseTabs(prev => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex(t => t.id === tabId);
      const next = prev.filter(t => t.id !== tabId);
      if (tabId === activePurchaseTabId) {
        setActivePurchaseTabId(next[Math.max(0, idx - 1)].id);
      }
      return next;
    });
  }, [activePurchaseTabId]);

  // Close a sale tab
  const closeSaleTab = useCallback((tabId: string) => {
    setSaleTabs(prev => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex(t => t.id === tabId);
      const next = prev.filter(t => t.id !== tabId);
      if (tabId === activeSaleTabId) {
        setActiveSaleTabId(next[Math.max(0, idx - 1)].id);
      }
      return next;
    });
  }, [activeSaleTabId]);

  // Navigate to a new page, pushing current page onto the history stack
  const navigate = useCallback((p: Page, query?: string) => {
    setPageHistory(prev => [...prev, page]);
    setPage(p);
    if (query !== undefined) setSearchQuery(query);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Go back to the previous page
  const goBack = useCallback(() => {
    setPageHistory(prev => {
      if (prev.length === 0) return prev;
      const history = [...prev];
      const prevPage = history.pop()!;
      setPage(prevPage);
      return history;
    });
  }, []);

  const handleEditPurchase = useCallback((txnId: number) => {
    setPageHistory(prev => [...prev, page]);
    setPage('purchase');
    // Open in a new purchase tab
    const tab: BillTab = { id: newTabId(), label: `Edit #${txnId}`, editTxnId: txnId, isDirty: false };
    setPurchaseTabs(prev => {
      // Don't open the same txn twice
      const existing = prev.find(t => t.editTxnId === txnId);
      if (existing) { setActivePurchaseTabId(existing.id); return prev; }
      setActivePurchaseTabId(tab.id);
      return [...prev, tab];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const handleEditSale = useCallback((txnId: number) => {
    setPageHistory(prev => [...prev, page]);
    setPage('sale');
    // Open in a new sale tab
    const tab: BillTab = { id: newTabId(), label: `Edit #${txnId}`, editTxnId: txnId, isDirty: false };
    setSaleTabs(prev => {
      const existing = prev.find(t => t.editTxnId === txnId);
      if (existing) { setActiveSaleTabId(existing.id); return prev; }
      setActiveSaleTabId(tab.id);
      return [...prev, tab];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault(); navigate('pos');
      }
      if (e.altKey) {
        const map: Record<string, Page> = { '1': 'dashboard', '2': 'sale', '3': 'purchase', '4': 'parties', '5': 'items', '6': 'reports', '7': 'settings' };
        if (map[e.key]) { e.preventDefault(); navigate(map[e.key]); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, goBack]);

  const groups = ['Main', 'Sales', 'Purchase', 'Books', 'System'];
  const currentLabel = navItems.find(i => i.page === page)?.label ?? page;

  // ── Auth routing ─────────────────────────────────────────────────────────────
  // Full-screen spinner while session is initialising
  if (!authReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#2563eb,#7c3aed)' }}>
            <MediFlowLogo size={24} className="text-white" />
          </div>
          <div className="w-6 h-6 border-2 border-slate-600 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // Not logged in → show login screen
  if (!user) {
    return <LoginPage onLoggedIn={() => {}} />;
  }

  // Logged in as super-admin → admin console
  if (isSuperAdmin) {
    return <AdminDashboard />;
  }

  // Logged in as store user but store not selected yet (multiple stores)
  if (!activeStore) {
    return <StoreSelector />;
  }

  // If the selected store is suspended, show a premium warning block
  if (!isSuperAdmin && activeStore && !activeStore.is_active) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 font-sans relative overflow-hidden">
        {/* Glowing background meshes */}
        <div className="absolute inset-0 pointer-events-none z-0">
          <div className="absolute rounded-full opacity-20 blur-[130px]" style={{ background: 'radial-gradient(circle, #ef4444 0%, transparent 60%)', width: 600, height: 600, top: '20%', left: '30%' }} />
        </div>

        <div
          className="relative z-10 w-full max-w-md mx-4 px-8 py-10 text-center border border-red-500/20"
          style={{
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(24px)',
            borderRadius: 24,
            boxShadow: '0 32px 64px -12px rgba(0,0,0,0.8)',
          }}
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-600 to-rose-600 flex items-center justify-center mx-auto mb-6 text-white shadow-lg shadow-red-900/30">
            <Shield size={28} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-slate-400 text-sm mb-8 leading-relaxed">
            Your store space <strong className="text-white">"{activeStore.name}"</strong> has been suspended by the administrator. Please contact store support or reach out to MediFlow administration for assistance.
          </p>
          <div className="flex flex-col gap-3">
            {profile && profile.stores.length > 1 && (
              <button
                onClick={signOut}
                className="w-full h-11 bg-brand hover:bg-brand-hover text-white rounded-xl font-bold text-sm transition-all shadow-md shadow-blue-900/30"
              >
                Switch Store Space
              </button>
            )}
            <button
              onClick={signOut}
              className="w-full h-11 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-sm transition-all border border-white/5"
            >
              Sign Out Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Normal billing app (store selected)
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans">
      {/* Sidebar */}
      <aside className={`flex-shrink-0 flex flex-col bg-sidebar-bg border-r border-sidebar-border-color transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-56'}`}>
        <div className="px-4 py-4 border-b border-sidebar-border-color flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-brand flex-shrink-0 flex items-center justify-center">
              <MediFlowLogo size={18} className="text-white" />
            </div>
            {!sidebarCollapsed && (
              <div className="whitespace-nowrap">
                <p className="text-white font-bold text-sm leading-none">MediFlow</p>
                <p className="text-slate-400 text-xs mt-0.5">Offline POS</p>
              </div>
            )}
          </div>
          {!sidebarCollapsed && (
            <button onClick={() => setSidebarCollapsed(true)} className="text-slate-500 hover:text-white transition-colors">
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>

        {sidebarCollapsed && (
          <div className="flex justify-center py-3 border-b border-sidebar-border-color">
            <button onClick={() => setSidebarCollapsed(false)} className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-800 hover:text-white flex items-center justify-center transition-colors">
              <PanelLeftOpen size={16} />
            </button>
          </div>
        )}

        <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-0.5">
          {groups.map(group => {
            const groupItems = navItems.filter(i => i.group === group);
            if (!groupItems.length) return null;
            return (
              <div key={group}>
                {!sidebarCollapsed && (
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider px-3 py-2 mt-2">{group}</p>
                )}
                {groupItems.map(item => {
                  const Icon = item.icon;
                  const active = page === item.page;
                  return (
                    <button
                      key={item.page}
                      onClick={() => navigate(item.page)}
                      className={`w-full flex items-center gap-3 py-2 rounded-lg text-sm transition-all group relative ${sidebarCollapsed ? 'px-0 justify-center' : 'px-3'} ${
                        active
                          ? 'bg-brand text-white font-medium shadow-lg shadow-blue-900/30'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                      }`}
                      title={sidebarCollapsed ? `${item.label} (${item.shortcut})` : undefined}
                    >
                      <Icon size={15} className="flex-shrink-0" />
                      {!sidebarCollapsed && (
                        <>
                          <span className="flex-1 text-left whitespace-nowrap">{item.label}</span>
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${active ? 'bg-blue-500 text-blue-100' : 'bg-slate-800 text-slate-500 group-hover:bg-slate-700'}`}>
                            {item.shortcut}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="px-2 py-3 border-t border-sidebar-border-color space-y-1">
          {/* Active store info */}
          <div className={`flex items-center gap-2 px-2 py-2 rounded-lg bg-slate-800/60 ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <div className="relative flex-shrink-0">
              <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center text-white text-xs font-bold">
                {activeStore.name.charAt(0)}
              </div>
              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-800 ${isOnline ? 'bg-emerald-400' : 'bg-slate-500'}`} title={isOnline ? 'Cloud connected' : 'Offline'} />
            </div>
            {!sidebarCollapsed && (
              <div className="overflow-hidden whitespace-nowrap flex-1">
                <p className="text-white text-xs font-medium truncate">{activeStore.name}</p>
                <p className="text-slate-400 text-xs truncate capitalize">{activeRole}</p>
              </div>
            )}
          </div>
          {/* Sign out */}
          <button
            onClick={signOut}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition-all text-xs ${sidebarCollapsed ? 'justify-center' : ''}`}
            title={sidebarCollapsed ? 'Sign Out' : undefined}
          >
            <LogOut size={13} />
            {!sidebarCollapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-slate-50">
        {/* Top Bar */}
        <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shadow-sm flex-shrink-0">
          <div className="flex items-center gap-2">
            {/* Back button — only shown when there's history */}
            {pageHistory.length > 0 && (
              <button
                onClick={goBack}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 hover:border-slate-300 transition-all text-sm font-medium group"
                title="Go back (Alt + ←)"
              >
                <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
                <span className="text-xs font-semibold">Back</span>
              </button>
            )}
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-slate-400 text-xs">MediFlow</span>
              <ChevronRight size={13} className="text-slate-300" />
              <span className="text-slate-800 font-semibold">{currentLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <GlobalSearch onNavigate={(p) => navigate(p as any)} />
            <button onClick={() => setShowShortcuts(true)} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-sm font-medium transition-colors">
              <Keyboard size={14} /> Shortcuts
            </button>
            <button onClick={() => navigate('sale')} className="flex items-center gap-1.5 px-3 py-1.5 bg-success hover:bg-success-hover text-white rounded-lg text-sm font-medium transition-colors">
              <FileText size={14} /> + Sale
            </button>
            <button onClick={() => navigate('purchase')} className="flex items-center gap-1.5 px-3 py-1.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-medium transition-colors">
              <ShoppingCart size={14} /> + Purchase
            </button>
          </div>
        </header>

        {/* Shortcuts Modal */}
        {showShortcuts && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && setShowShortcuts(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2 text-slate-800">
                  <Keyboard size={18} className="text-brand" />
                  <h3 className="font-bold text-lg">Keyboard Shortcuts</h3>
                </div>
                <button onClick={() => setShowShortcuts(false)} className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"><X size={16} /></button>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Global Navigation</h4>
                    <ul className="space-y-2">
                      <li className="flex justify-between text-sm"><span className="text-slate-600">Fast Billing</span><kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 font-mono text-[10px]">F2</kbd></li>
                      <li className="flex justify-between text-sm"><span className="text-slate-600">Dashboard</span><kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 font-mono text-[10px]">Alt + 1</kbd></li>
                      <li className="flex justify-between text-sm"><span className="text-slate-600">Sale / Purchase</span><kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 font-mono text-[10px]">Alt + 2/3</kbd></li>
                      <li className="flex justify-between text-sm"><span className="text-slate-600">Go Back</span><kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 font-mono text-[10px]">Alt + ←</kbd></li>
                      <li className="flex justify-between text-sm"><span className="text-slate-600">Global Search</span><kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 font-mono text-[10px]">Ctrl + K</kbd></li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Forms & Actions</h4>
                    <ul className="space-y-2">
                      <li className="flex justify-between text-sm"><span className="text-slate-600">Search/Add Item</span><kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 font-mono text-[10px]">F4</kbd></li>
                      <li className="flex justify-between text-sm"><span className="text-slate-600">Save Invoice</span><kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 font-mono text-[10px]">Ctrl + S</kbd></li>
                      <li className="flex justify-between text-sm"><span className="text-slate-600">Create New Entity</span><kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 font-mono text-[10px]">Ctrl + N</kbd></li>
                      <li className="flex justify-between text-sm"><span className="text-slate-600">Cancel / Clear</span><kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 font-mono text-[10px]">Esc</kbd></li>
                    </ul>
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 shadow-inner">
                <button onClick={() => setShowShortcuts(false)} className="w-full h-10 bg-brand hover:bg-brand-hover text-white rounded-lg font-medium transition-colors">Got it</button>
              </div>
            </div>
          </div>
        )}

        {/* Page Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {page === 'dashboard' && <Dashboard onNavigate={navigate} onEditPurchase={handleEditPurchase} onEditSale={handleEditSale} />}
          {page === 'pos' && <FastBilling />}
          {page === 'sale' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <BillTabBar
                tabs={saleTabs}
                activeTabId={activeSaleTabId}
                type="sale"
                onSelect={setActiveSaleTabId}
                onClose={closeSaleTab}
                onNew={addSaleTab}
              />
              <div className="flex-1 overflow-hidden relative">
                {saleTabs.map(tab => (
                  <div
                    key={tab.id}
                    className="absolute inset-0"
                    style={{ display: tab.id === activeSaleTabId ? 'flex' : 'none', flexDirection: 'column' }}
                  >
                    <SaleInvoice
                      key={tab.id}
                      editTxnId={tab.editTxnId}
                      tabId={tab.id}
                      onSaved={() => {
                        setSaleTabs(prev => prev.map(t => t.id === tab.id ? { ...t, editTxnId: null, label: 'New Sale', isDirty: false } : t));
                      }}
                      onLabelChange={(label, isDirty) => updateSaleTabLabel(tab.id, label, isDirty)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          {page === 'purchase' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <BillTabBar
                tabs={purchaseTabs}
                activeTabId={activePurchaseTabId}
                type="purchase"
                onSelect={setActivePurchaseTabId}
                onClose={closePurchaseTab}
                onNew={addPurchaseTab}
              />
              <div className="flex-1 overflow-hidden relative">
                {purchaseTabs.map(tab => (
                  <div
                    key={tab.id}
                    className="absolute inset-0"
                    style={{ display: tab.id === activePurchaseTabId ? 'flex' : 'none', flexDirection: 'column' }}
                  >
                    <PurchaseBill
                      key={tab.id}
                      editTxnId={tab.editTxnId}
                      tabId={tab.id}
                      onSaved={() => {
                        setPurchaseTabs(prev => prev.map(t => t.id === tab.id ? { ...t, editTxnId: null, label: 'New Purchase', isDirty: false } : t));
                      }}
                      onLabelChange={(label, isDirty) => updatePurchaseTabLabel(tab.id, label, isDirty)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          {page === 'purchase_history' && <PurchaseHistory onEditPurchase={handleEditPurchase} />}
          {page === 'parties' && <Parties initialSearch={searchQuery} />}
          {page === 'items' && <Items initialSearch={searchQuery} />}
          {page === 'reports' && <Reports initialSearch={searchQuery} onEditPurchase={handleEditPurchase} onEditSale={handleEditSale} />}
          {page === 'settings' && <Settings />}
          {page === 'order_book' && <OrderBook />}
        </div>
      </main>
    </div>
  );
}
