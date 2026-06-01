'use client';
import { useState, useEffect, useCallback } from 'react';
import { getDB } from '@/lib/db';
import Migration from '@/components/Migration';
import { getLocalStats } from '@/lib/db';
import {
  Settings2, Database, Info, Share2, Key, Link as LinkIcon,
  LayoutGrid, Save, CheckCircle, Cloud, CloudUpload, CloudDownload,
  RefreshCw, AlertTriangle, Loader2, CheckCircle2, HardDrive
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import { backupLocalToCloud, restoreCloudToLocal } from '@/lib/supabaseSyncHelper';

export const defaultSettings = {
  show_mrp: true,
  show_stock: true,
  show_batch: true,
  show_expiry: true,
  show_hsn: true,
  show_tax: true,
  show_discount: true,
};

export type AppSettings = typeof defaultSettings;

// Financial year settings stored separately in app_settings as plain strings
export const FY_SETTING_KEY = 'fy_start_month';
export const FY_DEFAULT_MONTH = 4; // April

export async function getFyStartMonth(): Promise<number> {
  try {
    const { getDB } = await import('@/lib/db');
    const db = await getDB();
    const res = await db.select<{key: string; value: string}[]>(`SELECT value FROM app_settings WHERE key = '${FY_SETTING_KEY}'`);
    if (res.length > 0) {
      const m = parseInt(res[0].value, 10);
      if (!isNaN(m) && m >= 1 && m <= 12) return m;
    }
  } catch {}
  return FY_DEFAULT_MONTH;
}

export function getFyBounds(referenceDate: string, fyStartMonth: number): { fyStart: string; fyEnd: string } {
  const d = new Date(referenceDate);
  const month = d.getMonth() + 1; // 1-12
  const year = d.getFullYear();
  const fyStartYear = month >= fyStartMonth ? year : year - 1;
  const fyEndYear = fyStartYear + 1;
  // fyEnd month is fyStartMonth - 1, wrap December
  const fyEndMonth = fyStartMonth === 1 ? 12 : fyStartMonth - 1;
  const fyEndDay = new Date(fyEndYear, fyEndMonth, 0).getDate(); // last day of that month
  const fyStartStr = `${fyStartYear}-${String(fyStartMonth).padStart(2, '0')}-01`;
  const fyEndStr = `${fyEndYear}-${String(fyEndMonth).padStart(2, '0')}-${String(fyEndDay).padStart(2, '0')}`;
  return { fyStart: fyStartStr, fyEnd: fyEndStr };
}

export default function Settings() {
  const { activeStore, isOnline } = useAuth();
  const [tab, setTab] = useState<'migration' | 'general' | 'schema' | 'cloud'>('general');
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiKeyStatus, setGeminiKeyStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [fyStartMonth, setFyStartMonth] = useState<number>(FY_DEFAULT_MONTH);
  const [fyStatus, setFyStatus] = useState('');

  // Cloud Sync state
  const [localStats, setLocalStats] = useState<Record<string, number>>({});
  const [cloudStats, setCloudStats] = useState<Record<string, number>>({});
  const [statsLoading, setStatsLoading] = useState(false);

  // Manual cloud sync and backup states
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncPct, setSyncPct] = useState(0);

  useEffect(() => {
    loadSettings();
    handleRefreshStats();
  }, [activeStore]);

  const loadSettings = async () => {
    try {
      const db = await getDB();
      const res = await db.select<{key: string, value: string}[]>('SELECT * FROM app_settings');
      const loaded = { ...defaultSettings };
      res.forEach(r => {
        if (Object.keys(defaultSettings).includes(r.key)) {
          loaded[r.key as keyof AppSettings] = r.value === 'true';
        }
        if (r.key === 'gemini_api_key') setGeminiApiKey(r.value);
        if (r.key === FY_SETTING_KEY) {
          const m = parseInt(r.value, 10);
          if (!isNaN(m) && m >= 1 && m <= 12) setFyStartMonth(m);
        }
      });
      setSettings(loaded);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const saveGeminiKey = async () => {
    setGeminiKeyStatus('saving');
    try {
      const db = await getDB();
      await db.execute(
        `INSERT INTO app_settings (key, value) VALUES ('gemini_api_key', $1) ON CONFLICT(key) DO UPDATE SET value = $1`,
        [geminiApiKey.trim()]
      );
      setGeminiKeyStatus('saved');
      setTimeout(() => setGeminiKeyStatus('idle'), 3000);
    } catch (e) {
      console.error(e);
      setGeminiKeyStatus('error');
    }
  };

  const handleToggle = (key: keyof AppSettings) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const saveSettings = async () => {
    setStatus('Saving...');
    try {
      const db = await getDB();
      for (const [key, value] of Object.entries(settings)) {
        await db.execute(
          `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2`,
          [key, String(value)]
        );
      }
      setStatus('✅ Settings saved globally!');
      setTimeout(() => setStatus(''), 3000);
    } catch (e) {
      console.error(e);
      setStatus('❌ Error saving settings');
    }
  };

  const saveFyStartMonth = async () => {
    setFyStatus('Saving...');
    try {
      const db = await getDB();
      await db.execute(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2`,
        [FY_SETTING_KEY, String(fyStartMonth)]
      );
      setFyStatus('✅ Financial year saved!');
      setTimeout(() => setFyStatus(''), 3000);
    } catch (e) {
      console.error(e);
      setFyStatus('❌ Error saving FY setting');
    }
  };

  // ─── Cloud Sync Stats ──────────────────────────
  const handleRefreshStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const local = await getLocalStats();
      setLocalStats(local);

      if (activeStore) {
        const cloud: Record<string, number> = {};
        await Promise.all(
          ['items', 'parties', 'transactions', 'transaction_items', 'order_book', 'party_special_rates', 'app_settings'].map(async (table) => {
            try {
              let q;
              if (table === 'transaction_items') {
                q = supabase
                  .from('transaction_items')
                  .select('id, transactions!inner(store_id)', { count: 'exact', head: true })
                  .eq('transactions.store_id', activeStore.id);
              } else {
                q = supabase
                  .from(table)
                  .select('*', { count: 'exact', head: true })
                  .eq('store_id', activeStore.id);
              }
              const { count, error } = await q;
              if (!error) {
                cloud[table] = count ?? 0;
              }
            } catch {
              cloud[table] = 0;
            }
          })
        );
        setCloudStats(cloud);
      }
    } catch (e: any) {
      console.error('Stats error:', e);
    } finally {
      setStatsLoading(false);
    }
  }, [activeStore]);

  const handleCloudBackup = async () => {
    if (!activeStore) return;
    if (!isOnline) {
      alert('You must be online to back up to the cloud.');
      return;
    }

    setSyncing(true);
    setSyncMsg('Starting Cloud Backup...');
    setSyncPct(0);

    try {
      await backupLocalToCloud(activeStore.id, (phase, current, total) => {
        setSyncMsg(phase);
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        setSyncPct(pct);
      });
      alert('✅ Cloud Backup completed successfully! All your local data is safely backed up to the cloud.');
      handleRefreshStats();
    } catch (e: any) {
      console.error(e);
      alert('❌ Error during backup: ' + e.message);
    } finally {
      setSyncing(false);
      setSyncMsg('');
      setSyncPct(0);
    }
  };

  const handleCloudRestore = async () => {
    if (!activeStore) return;
    if (!isOnline) {
      alert('You must be online to restore from the cloud.');
      return;
    }

    if (!window.confirm('🚨 CRITICAL WARNING: This will permanently DELETE all your local SQLite database data (including invoices, customers, and inventory) and replace it with the data on the Supabase Cloud.\n\nAre you absolutely sure you want to proceed?')) {
      return;
    }

    if (window.prompt(`To proceed, type the word "OVERWRITE" in all capitals:`) !== 'OVERWRITE') {
      alert('Confirmation failed. Action cancelled.');
      return;
    }

    setSyncing(true);
    setSyncMsg('Starting Cloud Restore...');
    setSyncPct(0);

    try {
      await restoreCloudToLocal(activeStore.id, (phase, current, total) => {
        setSyncMsg(phase);
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        setSyncPct(pct);
      });
      alert('✅ Cloud Restore completed successfully! Your local database has been fully restored from the cloud.');
      handleRefreshStats();
    } catch (e: any) {
      console.error(e);
      alert('❌ Error during restore: ' + e.message);
    } finally {
      setSyncing(false);
      setSyncMsg('');
      setSyncPct(0);
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="px-6 py-3 bg-white border-b border-slate-200 flex gap-2">
        <button onClick={() => setTab('general')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'general' ? 'bg-brand text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          <Settings2 size={14} className="inline mr-2" />General
        </button>
        <button onClick={() => { setTab('cloud'); handleRefreshStats(); }} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'cloud' ? 'bg-brand text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          <Cloud size={14} className="inline mr-2" />Cloud Backup
        </button>
        <button onClick={() => setTab('schema')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'schema' ? 'bg-brand text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          <Share2 size={14} className="inline mr-2" />Database Schema
        </button>
        <button onClick={() => setTab('migration')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'migration' ? 'bg-brand text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          <Database size={14} className="inline mr-2" />Data Migration
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'migration' && (
          <div className="max-w-3xl">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 flex gap-3">
              <Info size={18} className="text-brand flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900 flex-1">
                <p className="font-semibold mb-1">Import from Vyapar</p>
                <p>Upload your Vyapar Excel exports to import all items and parties into MediFlow. This can also be re-run to update data.</p>
              </div>
              <button 
                onClick={async () => {
                  try {
                    const Database = (await import('@tauri-apps/plugin-sql')).default;
                    const db = await Database.load('sqlite:mediflow.db');
                    await db.execute(`
                      UPDATE transaction_items
                      SET item_name = LOWER((SELECT name FROM items WHERE items.id = transaction_items.item_id))
                      WHERE (item_name IS NULL OR item_name = '') AND item_id IS NOT NULL;
                    `);
                    alert('Successfully repaired missing party data in the database!');
                  } catch (e: any) {
                    alert('Error repairing data: ' + e.message);
                  }
                }}
                className="bg-brand text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-brand/90 my-auto shadow-sm whitespace-nowrap"
              >
                Fix Missing Party Data
              </button>
            </div>
            <Migration />
          </div>
        )}
        {tab === 'general' && (
          <div className="max-w-4xl space-y-6">

            {/* Financial Year Settings */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-blue-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
                    <Settings2 size={14} className="text-white" />
                  </div>
                  <div>
                    <h2 className="font-bold text-slate-800 text-sm">Financial Year Settings</h2>
                    <p className="text-xs text-slate-500">Set the starting month of your financial year for bill numbering & duplicate detection</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-brand h-8 flex items-center">{fyStatus}</span>
                  <button
                    onClick={saveFyStartMonth}
                    className="flex items-center gap-2 bg-brand hover:bg-brand-hover text-white px-3 py-1.5 rounded-md text-sm font-medium shadow-sm transition-all"
                  >
                    <Save size={14} /> Save FY
                  </button>
                </div>
              </div>
              <div className="p-6">
                <div className="flex items-center gap-6">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">FY Start Month</label>
                    <select
                      value={fyStartMonth}
                      onChange={e => setFyStartMonth(Number(e.target.value))}
                      className="h-10 border border-slate-200 rounded-lg px-3 pr-8 text-sm font-medium text-slate-700 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-sm bg-white"
                    >
                      {[
                        { val: 1, label: 'January (Jan 1)' },
                        { val: 2, label: 'February (Feb 1)' },
                        { val: 3, label: 'March (Mar 1)' },
                        { val: 4, label: 'April (Apr 1) — Standard India' },
                        { val: 7, label: 'July (Jul 1)' },
                        { val: 10, label: 'October (Oct 1)' },
                      ].map(opt => (
                        <option key={opt.val} value={opt.val}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 p-3 rounded-lg bg-indigo-50 border border-indigo-100 text-sm text-indigo-700">
                    <p className="font-semibold mb-1">Current Financial Year</p>
                    <p className="text-xs font-mono">
                      {(() => {
                        const now = new Date();
                        const m = now.getMonth() + 1;
                        const y = now.getFullYear();
                        const fyY = m >= fyStartMonth ? y : y - 1;
                        const fyEndM = fyStartMonth === 1 ? 12 : fyStartMonth - 1;
                        const fyEndY = fyY + 1;
                        return `FY ${fyY}-${String(fyEndY).slice(2)} (${new Date(fyY, fyStartMonth - 1, 1).toLocaleString('default', { month: 'long' })} ${fyY} → ${new Date(fyEndY, fyEndM - 1, 1).toLocaleString('default', { month: 'long' })} ${fyEndY})`;
                      })()}
                    </p>
                    <p className="text-xs text-indigo-500 mt-1">Bills with the same number in different FY are treated as separate bills.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                   <LayoutGrid size={18} className="text-slate-500" />
                   <h2 className="font-semibold text-slate-800">Grid Variables Visibility</h2>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-sm font-medium h-8 flex items-center text-brand">{status}</div>
                  <button
                    onClick={saveSettings}
                    className="flex items-center gap-2 bg-brand hover:bg-brand-hover text-white px-3 py-1.5 rounded-md text-sm font-medium shadow-sm transition-all"
                  >
                    <Save size={14} /> Save Variables
                  </button>
                </div>
              </div>
              <div className="p-6">
                <p className="text-sm text-slate-500 mb-6">
                  Turn off columns you don't need during Sale and Purchase billing to declutter the interface.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.keys(defaultSettings).map((key) => {
                    const settingKey = key as keyof AppSettings;
                    return (
                      <div key={key} className="flex items-center justify-between p-4 rounded-lg border border-slate-100 hover:border-slate-300 hover:bg-slate-50 transition-colors shadow-sm">
                        <span className="font-medium text-slate-700 capitalize flex items-center gap-2">
                           Show {key.replace('show_', '').toUpperCase()}
                        </span>
                        <button 
                          onClick={() => handleToggle(settingKey)}
                          className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 ${settings[settingKey] ? 'bg-brand' : 'bg-slate-300'}`}
                          role="switch"
                          aria-checked={settings[settingKey]}
                        >
                          <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${settings[settingKey] ? 'translate-x-6' : 'translate-x-1'}`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Gemini AI / OCR */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-purple-50 to-blue-50 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
                  <Key size={16} className="text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800 text-sm">Gemini AI — Bill Scanner OCR</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Enable AI-powered bill scanning with Google Gemini</p>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700 flex gap-2">
                  <Info size={14} className="flex-shrink-0 mt-0.5 text-blue-500" />
                  <span>Get a free key at <strong>aistudio.google.com/app/apikey</strong>. Images are sent <strong>inline as base64</strong> — no cloud storage required. Your key stays local on this device only.</span>
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-semibold block mb-1.5 uppercase tracking-wider">Gemini API Key</label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={geminiApiKey}
                      onChange={e => { setGeminiApiKey(e.target.value); setGeminiKeyStatus('idle'); }}
                      placeholder="AIza..."
                      className="flex-1 h-10 border border-slate-200 rounded-lg px-3 text-sm font-mono focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 shadow-sm"
                    />
                    <button
                      onClick={saveGeminiKey}
                      disabled={!geminiApiKey.trim() || geminiKeyStatus === 'saving'}
                      className={`px-4 h-10 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${
                        geminiKeyStatus === 'saved' ? 'bg-emerald-500 text-white' :
                        geminiKeyStatus === 'error' ? 'bg-red-500 text-white' :
                        'bg-brand hover:bg-brand-hover text-white disabled:opacity-50'
                      }`}
                    >
                      {geminiKeyStatus === 'saving' ? <><Loader2 size={13} className="animate-spin" /> Saving...</> :
                       geminiKeyStatus === 'saved' ? <><CheckCircle2 size={13} /> Saved!</> :
                       geminiKeyStatus === 'error' ? 'Error' :
                       <><Save size={13} /> Save Key</>}
                    </button>
                  </div>
                  {geminiApiKey && (
                    <p className="text-xs text-emerald-600 mt-1.5 flex items-center gap-1">
                      <CheckCircle size={11} /> Key configured — Gemini OCR active in the bill scanner
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <h3 className="font-semibold text-slate-700 mb-4">Store Information</h3>
                <div className="space-y-3">
                  <div><label className="text-xs text-slate-500 font-medium block mb-1">Store Name</label>
                    <input defaultValue="Raghuveer Medical And Provision Store" className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" /></div>
                  <div><label className="text-xs text-slate-500 font-medium block mb-1">GSTIN</label>
                    <input placeholder="24XXXXX..." className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" /></div>
                  <div><label className="text-xs text-slate-500 font-medium block mb-1">Address</label>
                    <textarea rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" /></div>
                  <div><label className="text-xs text-slate-500 font-medium block mb-1">Phone</label>
                    <input placeholder="+91..." className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm" /></div>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <h3 className="font-semibold text-slate-700 mb-4">Keyboard Shortcuts</h3>
                <div className="space-y-2 text-sm">
                  {[['F2', 'Fast Billing (POS)'], ['Alt+1', 'Dashboard'], ['Alt+2', 'Sale Invoice'], ['Alt+3', 'Purchase Bill'], ['Alt+4', 'Parties'], ['Alt+5', 'Items'], ['Alt+6', 'Reports'], ['Alt+7', 'Settings'], ['Ctrl+N', 'New Item / New Party'], ['Ctrl+S', 'Save current form'], ['Esc', 'Close / Cancel']].map(([key, desc]) => (
                    <div key={key} className="flex items-center justify-between py-1 border-b border-slate-100 last:border-0">
                      <span className="text-slate-600">{desc}</span>
                      <kbd className="bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded text-xs font-mono">{key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        {tab === 'schema' && (
          <div className="max-w-5xl">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex gap-3">
              <Info size={18} className="text-brand flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900">
                <p className="font-semibold mb-1">Local SQLite Database Architecture</p>
                <p>MediFlow runs entirely offline using a local SQLite file (`mediflow.db`). Below is the entity-relationship map of how your data is connected under the hood.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative">
              
              {/* Items Card */}
              <div className="bg-white rounded-xl border-2 border-slate-200 overflow-hidden shadow-sm">
                <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2"><Database size={14} className="text-slate-500" /> items</h3>
                  <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-500">Master</span>
                </div>
                <div className="p-4 bg-white space-y-2">
                  <div className="flex justify-between text-sm"><span className="flex items-center gap-1.5 font-medium"><Key size={12} className="text-yellow-500" /> id</span><span className="text-slate-400 font-mono text-xs">INTEGER</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-700">name, category</span><span className="text-slate-400 font-mono text-xs">TEXT</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-700">sale_price, tax_rate</span><span className="text-slate-400 font-mono text-xs">REAL</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-700">current_stock</span><span className="text-slate-400 font-mono text-xs">INTEGER</span></div>
                </div>
              </div>

              {/* Transactions Card */}
              <div className="bg-white rounded-xl border-2 border-brand/40 overflow-hidden shadow-sm">
                <div className="bg-brand/5 px-4 py-3 border-b border-brand/20 flex justify-between items-center">
                  <h3 className="font-bold text-brand flex items-center gap-2"><Database size={14} /> transactions</h3>
                  <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-brand/20 text-brand">Core</span>
                </div>
                <div className="p-4 bg-white space-y-2">
                  <div className="flex justify-between text-sm"><span className="flex items-center gap-1.5 font-medium"><Key size={12} className="text-yellow-500" /> id</span><span className="text-slate-400 font-mono text-xs">INTEGER</span></div>
                  <div className="flex justify-between text-sm"><span className="flex items-center gap-1.5 text-blue-600"><LinkIcon size={12} /> party_id</span><span className="text-slate-400 font-mono text-xs">INTEGER</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-700">type</span><span className="text-slate-400 font-mono text-xs">'sale' | 'purchase'</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-700">invoice_no, date</span><span className="text-slate-400 font-mono text-xs">TEXT</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-700">total_amount</span><span className="text-slate-400 font-mono text-xs">REAL</span></div>
                </div>
              </div>

              {/* Parties Card */}
              <div className="bg-white rounded-xl border-2 border-slate-200 overflow-hidden shadow-sm">
                <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2"><Database size={14} className="text-slate-500" /> parties</h3>
                  <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-500">Master</span>
                </div>
                <div className="p-4 bg-white space-y-2">
                  <div className="flex justify-between text-sm"><span className="flex items-center gap-1.5 font-medium"><Key size={12} className="text-yellow-500" /> id</span><span className="text-slate-400 font-mono text-xs">INTEGER</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-700">name, phone</span><span className="text-slate-400 font-mono text-xs">TEXT</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-700">type</span><span className="text-slate-400 font-mono text-xs">'customer' | 'vendor'</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-700">opening_balance</span><span className="text-slate-400 font-mono text-xs">REAL</span></div>
                </div>
              </div>

              {/* Transaction Items Card */}
              <div className="bg-white rounded-xl border-2 border-slate-200 overflow-hidden shadow-sm md:col-start-2">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2"><Database size={14} className="text-slate-500" /> transaction_items</h3>
                  <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-500">Child</span>
                </div>
                <div className="p-4 bg-white space-y-2 relative">
                  <div className="flex justify-between text-sm"><span className="flex items-center gap-1.5 font-medium"><Key size={12} className="text-yellow-500" /> id</span><span className="text-slate-400 font-mono text-xs">INTEGER</span></div>
                  <div className="flex justify-between text-sm"><span className="flex items-center gap-1.5 text-blue-600"><LinkIcon size={12} /> txn_id</span><span className="text-slate-400 font-mono text-xs">INTEGER</span></div>
                  <div className="flex justify-between text-sm"><span className="flex items-center gap-1.5 text-blue-600"><LinkIcon size={12} /> item_id</span><span className="text-slate-400 font-mono text-xs">INTEGER</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-700">item_name, batch_no, expiry_date</span><span className="text-slate-400 font-mono text-xs">TEXT</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-700">quantity, price, amount</span><span className="text-slate-400 font-mono text-xs">REAL</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-700">discount_pct, tax_pct</span><span className="text-slate-400 font-mono text-xs">REAL</span></div>
                </div>
              </div>

               {/* Special Rates Card */}
               <div className="bg-white rounded-xl border-2 border-slate-200 overflow-hidden shadow-sm">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2"><Database size={14} className="text-slate-500" /> party_special_rates</h3>
                  <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-500">Lookup</span>
                </div>
                <div className="p-4 bg-white space-y-2">
                  <div className="flex justify-between text-sm"><span className="flex items-center gap-1.5 font-medium"><Key size={12} className="text-yellow-500" /> id</span><span className="text-slate-400 font-mono text-xs">INTEGER</span></div>
                  <div className="flex justify-between text-sm"><span className="flex items-center gap-1.5 text-blue-600"><LinkIcon size={12} /> party_id</span><span className="text-slate-400 font-mono text-xs">INTEGER</span></div>
                  <div className="flex justify-between text-sm"><span className="flex items-center gap-1.5 text-blue-600"><LinkIcon size={12} /> item_id</span><span className="text-slate-400 font-mono text-xs">INTEGER</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-700">price, discount</span><span className="text-slate-400 font-mono text-xs">REAL</span></div>
                </div>
              </div>

            </div>
          </div>
        )}
        {tab === 'cloud' && (
          <div className="max-w-4xl space-y-6">

            {/* Supabase Connection Status */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cloud size={18} className="text-brand" />
                  <h2 className="font-semibold text-slate-800">Supabase Cloud Sync Status</h2>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                  activeStore && isOnline
                    ? 'text-emerald-600 bg-emerald-50 border border-emerald-200'
                    : 'text-amber-600 bg-amber-50 border border-amber-200'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${activeStore && isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  {activeStore && isOnline ? 'Online Sync Active' : 'Offline Mode'}
                </span>
              </div>
              <div className="p-6 space-y-4">
                {activeStore ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                      <span className="text-xs text-slate-400 font-semibold block uppercase">Active Pharmacy Space</span>
                      <strong className="text-slate-800 text-base mt-1 block">{activeStore.name}</strong>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                      <span className="text-xs text-slate-400 font-semibold block uppercase">Subscription Level</span>
                      <strong className="text-brand text-base mt-1 block capitalize font-extrabold">{activeStore.plan} Plan</strong>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm flex gap-2">
                    <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Not Logged In to Cloud Store</p>
                      <p className="text-xs mt-1">Please log in with your store credentials from the login screen to enable real-time cloud synchronization.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Manual Sync operations */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CloudUpload size={18} className="text-brand" />
                  <h2 className="font-semibold text-slate-800">Cloud Sync & Backup Operations</h2>
                </div>
              </div>
              <div className="p-6 space-y-6">
                <p className="text-sm text-slate-500">
                  Manually back up your local pharmacy data to the cloud or restore your offline workspace from a cloud backup snapshot.
                </p>

                {syncing && (
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-3">
                    <div className="flex justify-between items-center text-sm font-medium">
                      <span className="text-slate-600 flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin text-brand" />
                        {syncMsg}
                      </span>
                      <span className="text-brand font-bold font-mono">{syncPct}%</span>
                    </div>
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-brand h-full rounded-full transition-all duration-300"
                        style={{ width: `${syncPct}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Backup Button Card */}
                  <div className="p-4 rounded-xl border border-slate-200 flex flex-col justify-between hover:border-slate-300 hover:bg-slate-50/50 transition-colors">
                    <div className="space-y-1">
                      <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                        <CloudUpload size={16} className="text-emerald-500" />
                        Backup to Cloud (Upload)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Uploads all local transactions, customers, and inventory to your secure Supabase store. Safe-merges with existing cloud data.
                      </p>
                    </div>
                    <button
                      onClick={handleCloudBackup}
                      disabled={syncing || !activeStore || !isOnline}
                      className="mt-4 w-full flex items-center justify-center gap-2 bg-brand hover:bg-brand-hover text-white font-bold py-2 px-4 rounded-lg text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {syncing ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />}
                      Start Cloud Backup
                    </button>
                  </div>

                  {/* Restore Button Card */}
                  <div className="p-4 rounded-xl border border-slate-200 flex flex-col justify-between hover:border-slate-300 hover:bg-slate-50/50 transition-colors">
                    <div className="space-y-1">
                      <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                        <CloudDownload size={16} className="text-amber-500" />
                        Restore from Cloud (Download)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Restores your offline app database by downloading all transactions, items, and parties from your active cloud store space.
                      </p>
                    </div>
                    <button
                      onClick={handleCloudRestore}
                      disabled={syncing || !activeStore || !isOnline}
                      className="mt-4 w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-4 rounded-lg text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {syncing ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />}
                      Restore from Backup
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats Comparison */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database size={18} className="text-slate-500" />
                  <h2 className="font-semibold text-slate-800">Data Comparison</h2>
                </div>
                <button
                  onClick={handleRefreshStats}
                  disabled={statsLoading}
                  className="flex items-center gap-1.5 text-xs font-medium text-brand hover:text-brand-hover transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={12} className={statsLoading ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
              <div className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3 text-left font-semibold">Table</th>
                      <th className="px-6 py-3 text-right font-semibold">
                        <span className="flex items-center justify-end gap-1.5"><HardDrive size={12} /> Local</span>
                      </th>
                      <th className="px-6 py-3 text-right font-semibold">
                        <span className="flex items-center justify-end gap-1.5"><Cloud size={12} /> Cloud</span>
                      </th>
                      <th className="px-6 py-3 text-center font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {['items', 'parties', 'transactions', 'transaction_items', 'order_book', 'party_special_rates', 'app_settings'].map((table, idx) => {
                      const local = localStats[table] ?? '—';
                      const cloud = cloudStats[table] ?? '—';
                      const synced = typeof local === 'number' && typeof cloud === 'number' && local === cloud;
                      const hasCloud = typeof cloud === 'number' && cloud > 0;
                      return (
                        <tr key={table} className={`border-b border-slate-50 ${idx % 2 === 0 ? '' : 'bg-slate-50/50'}`}>
                          <td className="px-6 py-3 font-mono text-xs font-semibold text-slate-700">{table}</td>
                          <td className="px-6 py-3 text-right font-mono font-bold text-slate-800">{local}</td>
                          <td className="px-6 py-3 text-right font-mono font-bold text-slate-800">{cloud}</td>
                          <td className="px-6 py-3 text-center">
                            {statsLoading ? (
                              <Loader2 size={14} className="text-slate-300 animate-spin mx-auto" />
                            ) : synced ? (
                              <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">✓ Synced</span>
                            ) : hasCloud ? (
                              <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-full">⚠ Differs</span>
                            ) : (
                              <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-full">No cloud</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="bg-red-50 rounded-xl border border-red-200 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-red-200 bg-red-100/50 flex items-center gap-2">
                <AlertTriangle size={18} className="text-red-600" />
                <h2 className="font-semibold text-red-800">Danger Zone</h2>
              </div>
              <div className="p-6 space-y-6">
                {/* Cloud Wipe */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <p className="font-bold text-slate-800 text-sm">Wipe Cloud Database</p>
                    <p className="text-xs text-slate-500 mt-1">Permanently deletes all transactions, items, and parties in the CLOUD database for this store. Requires an active connection.</p>
                  </div>
                  <button
                    onClick={async () => {
                      if (!activeStore) {
                        alert('You must be logged in to a store to wipe cloud data.');
                        return;
                      }
                      if (!isOnline) {
                        alert('You must be online to wipe cloud data.');
                        return;
                      }
                      if (!window.confirm(`🚨 EXTREME WARNING: This will permanently DELETE all inventory, customers, and transaction histories in the CLOUD database for "${activeStore.name}". This cannot be undone.\n\nAre you absolutely sure?`)) return;
                      if (window.prompt('To verify, please type the store name exactly:') !== activeStore.name) {
                        alert('Verification did not match. Action cancelled.');
                        return;
                      }

                      try {
                        setStatus('Wiping cloud database...');
                        const storeId = activeStore.id;
                        const tables = ['party_special_rates', 'order_book', 'transactions', 'parties', 'items'];
                        for (const table of tables) {
                          const { error } = await supabase
                            .from(table)
                            .delete()
                            .eq('store_id', storeId);
                          if (error) throw error;
                        }
                        alert('Successfully wiped all cloud database tables for this store!');
                        handleRefreshStats();
                      } catch (e: any) {
                        alert('Error wiping cloud database: ' + e.message);
                      } finally {
                        setStatus('');
                      }
                    }}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-all shadow-sm shrink-0"
                  >
                    Clear All Cloud Data
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}













