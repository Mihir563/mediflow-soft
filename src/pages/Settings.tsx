'use client';
import { useState, useEffect } from 'react';
import { getDB } from '@/lib/db';
import Migration from '@/components/Migration';
import { Settings2, Database, Info, Share2, Key, Link as LinkIcon, LayoutGrid, Save, CheckCircle } from 'lucide-react';

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
  const [tab, setTab] = useState<'migration' | 'general' | 'schema'>('general');
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
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
      });
      setSettings(loaded);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
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

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="px-6 py-3 bg-white border-b border-slate-200 flex gap-2">
        <button onClick={() => setTab('schema')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'schema' ? 'bg-brand text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          <Share2 size={14} className="inline mr-2" />Database Schema
        </button>
        <button onClick={() => setTab('migration')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'migration' ? 'bg-brand text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          <Database size={14} className="inline mr-2" />Data Migration
        </button>
        <button onClick={() => setTab('general')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'general' ? 'bg-brand text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          <Settings2 size={14} className="inline mr-2" />General
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
      </div>
    </div>
  );
}
