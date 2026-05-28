'use client';
import { useState, useEffect } from 'react';
import { getDB } from '@/lib/db';
import Migration from '@/components/Migration';
import {
  loadMongoConfig, saveMongoConfig, pushToCloud, pullFromCloud,
  getCloudStats, getLocalStats, MongoConfig, SyncProgress
} from '@/lib/cloudSync';
import {
  Settings2, Database, Info, Share2, Key, Link as LinkIcon,
  LayoutGrid, Save, CheckCircle, Cloud, CloudUpload, CloudDownload,
  RefreshCw, AlertTriangle, Loader2, CheckCircle2, HardDrive
} from 'lucide-react';

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

export default function Settings() {
  const [tab, setTab] = useState<'migration' | 'general' | 'schema' | 'cloud'>('general');
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiKeyStatus, setGeminiKeyStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Cloud backup state
  const [mongoConfig, setMongoConfig] = useState<MongoConfig>({
    apiKey: '', appId: '', cluster: 'Cluster0', database: 'mediflow_backup',
  });
  const [cloudConfigLoaded, setCloudConfigLoaded] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress>({ phase: 'idle', message: '' });
  const [localStats, setLocalStats] = useState<Record<string, number>>({});
  const [cloudStats, setCloudStats] = useState<Record<string, number>>({});
  const [lastPush, setLastPush] = useState<string | null>(null);
  const [lastPull, setLastPull] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  useEffect(() => {
    loadSettings();
    loadCloudConfig();
  }, []);

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

  // ─── Cloud Backup Logic ───────────────────────
  const loadCloudConfig = async () => {
    const cfg = await loadMongoConfig();
    if (cfg) setMongoConfig(cfg);
    setCloudConfigLoaded(true);

    // Load timestamps
    try {
      const db = await getDB();
      const pushTs = await db.select<{value:string}[]>(`SELECT value FROM app_settings WHERE key='mongo_last_push'`);
      const pullTs = await db.select<{value:string}[]>(`SELECT value FROM app_settings WHERE key='mongo_last_pull'`);
      if (pushTs.length > 0) setLastPush(pushTs[0].value);
      if (pullTs.length > 0) setLastPull(pullTs[0].value);
    } catch {}
  };

  const handleSaveConfig = async () => {
    await saveMongoConfig(mongoConfig);
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 3000);
  };

  const handleRefreshStats = async () => {
    setStatsLoading(true);
    try {
      const local = await getLocalStats();
      setLocalStats(local);
      if (mongoConfig.apiKey && mongoConfig.appId) {
        const cloud = await getCloudStats(mongoConfig);
        setCloudStats(cloud);
      }
    } catch (e: any) {
      console.error('Stats error:', e);
    } finally {
      setStatsLoading(false);
    }
  };

  const handlePush = async () => {
    if (!mongoConfig.apiKey || !mongoConfig.appId) {
      alert('Please configure your MongoDB API Key and App ID first.');
      return;
    }
    if (!window.confirm('This will OVERWRITE all data in the cloud with your current local data.\n\nAre you sure?')) return;
    try {
      await pushToCloud(mongoConfig, setSyncProgress);
      loadCloudConfig(); // refresh timestamps
      handleRefreshStats();
    } catch (e: any) {
      setSyncProgress({ phase: 'error', message: `❌ Push failed: ${e.message}` });
    }
  };

  const handlePull = async () => {
    if (!mongoConfig.apiKey || !mongoConfig.appId) {
      alert('Please configure your MongoDB API Key and App ID first.');
      return;
    }
    if (!window.confirm('⚠️ WARNING: This will DELETE all your local data and replace it with the cloud backup.\n\nThis action cannot be undone. Are you absolutely sure?')) return;
    try {
      await pullFromCloud(mongoConfig, setSyncProgress);
      loadCloudConfig();
      handleRefreshStats();
    } catch (e: any) {
      setSyncProgress({ phase: 'error', message: `❌ Pull failed: ${e.message}` });
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

            {/* MongoDB Connection Config */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cloud size={18} className="text-emerald-600" />
                  <h2 className="font-semibold text-slate-800">MongoDB Atlas Connection</h2>
                </div>
                <div className="flex items-center gap-3">
                  {configSaved && <span className="text-sm text-emerald-600 font-medium flex items-center gap-1"><CheckCircle2 size={14} /> Saved!</span>}
                  <button onClick={handleSaveConfig} className="flex items-center gap-2 bg-brand hover:bg-brand-hover text-white px-3 py-1.5 rounded-md text-sm font-medium shadow-sm transition-all">
                    <Save size={14} /> Save Config
                  </button>
                </div>
              </div>
              <div className="p-6">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6 flex gap-2">
                  <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-900">
                    <p className="font-semibold mb-1">How to get your MongoDB API credentials</p>
                    <ol className="list-decimal list-inside space-y-1 text-xs text-amber-800">
                      <li>Go to <strong>cloud.mongodb.com</strong> → create a free cluster</li>
                      <li>Click <strong>Data API</strong> in the sidebar → Enable it</li>
                      <li>Create an <strong>API Key</strong> and copy it below</li>
                      <li>Copy your <strong>App ID</strong> (shown on the Data API page)</li>
                    </ol>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-500 font-semibold block mb-1.5">API Key *</label>
                    <input
                      type="password"
                      value={mongoConfig.apiKey}
                      onChange={e => setMongoConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full h-10 border border-slate-200 rounded-lg px-3 text-sm font-mono focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 font-semibold block mb-1.5">App ID *</label>
                    <input
                      type="text"
                      value={mongoConfig.appId}
                      onChange={e => setMongoConfig(prev => ({ ...prev, appId: e.target.value }))}
                      placeholder="data-xxxxx"
                      className="w-full h-10 border border-slate-200 rounded-lg px-3 text-sm font-mono focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 font-semibold block mb-1.5">Cluster Name</label>
                    <input
                      type="text"
                      value={mongoConfig.cluster}
                      onChange={e => setMongoConfig(prev => ({ ...prev, cluster: e.target.value }))}
                      placeholder="Cluster0"
                      className="w-full h-10 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 font-semibold block mb-1.5">Database Name</label>
                    <input
                      type="text"
                      value={mongoConfig.database}
                      onChange={e => setMongoConfig(prev => ({ ...prev, database: e.target.value }))}
                      placeholder="mediflow_backup"
                      className="w-full h-10 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand shadow-sm"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Sync Actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Push */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-slate-100 bg-emerald-50">
                  <div className="flex items-center gap-2">
                    <CloudUpload size={18} className="text-emerald-600" />
                    <h3 className="font-semibold text-emerald-800">Push to Cloud</h3>
                  </div>
                  <p className="text-xs text-emerald-700 mt-1">Overwrites cloud data with your current local database.</p>
                </div>
                <div className="p-6">
                  {lastPush && (
                    <p className="text-xs text-slate-500 mb-3">Last pushed: <strong className="text-slate-700">{new Date(lastPush).toLocaleString('en-GB')}</strong></p>
                  )}
                  <button
                    onClick={handlePush}
                    disabled={syncProgress.phase !== 'idle' && syncProgress.phase !== 'done' && syncProgress.phase !== 'error'}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CloudUpload size={16} /> Push Local → Cloud
                  </button>
                </div>
              </div>

              {/* Pull */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-slate-100 bg-blue-50">
                  <div className="flex items-center gap-2">
                    <CloudDownload size={18} className="text-blue-600" />
                    <h3 className="font-semibold text-blue-800">Restore from Cloud</h3>
                  </div>
                  <p className="text-xs text-blue-700 mt-1">Replaces local data with the cloud backup. Destructive!</p>
                </div>
                <div className="p-6">
                  {lastPull && (
                    <p className="text-xs text-slate-500 mb-3">Last restored: <strong className="text-slate-700">{new Date(lastPull).toLocaleString('en-GB')}</strong></p>
                  )}
                  <button
                    onClick={handlePull}
                    disabled={syncProgress.phase !== 'idle' && syncProgress.phase !== 'done' && syncProgress.phase !== 'error'}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-bold text-sm transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CloudDownload size={16} /> Restore Cloud → Local
                  </button>
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            {syncProgress.phase !== 'idle' && (
              <div className={`rounded-xl border overflow-hidden shadow-sm ${
                syncProgress.phase === 'error' ? 'bg-red-50 border-red-200' :
                syncProgress.phase === 'done' ? 'bg-emerald-50 border-emerald-200' :
                'bg-white border-slate-200'
              }`}>
                <div className="px-6 py-4 flex items-center gap-3">
                  {syncProgress.phase === 'done' ? (
                    <CheckCircle2 size={20} className="text-emerald-600" />
                  ) : syncProgress.phase === 'error' ? (
                    <AlertTriangle size={20} className="text-red-600" />
                  ) : (
                    <Loader2 size={20} className="text-brand animate-spin" />
                  )}
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${
                      syncProgress.phase === 'error' ? 'text-red-700' :
                      syncProgress.phase === 'done' ? 'text-emerald-700' :
                      'text-slate-700'
                    }`}>
                      {syncProgress.message}
                    </p>
                    {syncProgress.tableIndex && syncProgress.totalTables && syncProgress.phase !== 'done' && syncProgress.phase !== 'error' && (
                      <div className="mt-2 w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-brand h-full rounded-full transition-all duration-300"
                          style={{ width: `${(syncProgress.tableIndex / syncProgress.totalTables) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

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

          </div>
        )}
      </div>
    </div>
  );
}
