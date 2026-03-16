'use client';
import { useState } from 'react';
import Migration from '@/components/Migration';
import { Settings2, Database, Info } from 'lucide-react';

export default function Settings() {
  const [tab, setTab] = useState<'migration' | 'general'>('migration');

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="px-6 py-3 bg-white border-b border-slate-200 flex gap-2">
        <button onClick={() => setTab('migration')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'migration' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          <Database size={14} className="inline mr-2" />Data Migration
        </button>
        <button onClick={() => setTab('general')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'general' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          <Settings2 size={14} className="inline mr-2" />General
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'migration' && (
          <div className="max-w-3xl">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 flex gap-3">
              <Info size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-700">
                <p className="font-semibold mb-1">Import from Vyapar</p>
                <p>Upload your Vyapar Excel exports to import all items and parties into MediFlow. This can also be re-run to update data.</p>
              </div>
            </div>
            <Migration />
          </div>
        )}
        {tab === 'general' && (
          <div className="max-w-xl space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-700 mb-4">Store Information</h3>
              <div className="space-y-3">
                <div><label className="text-xs text-slate-500 font-medium block mb-1">Store Name</label>
                  <input defaultValue="Raghuveer Medical And Provision Store" className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="text-xs text-slate-500 font-medium block mb-1">GSTIN</label>
                  <input placeholder="24XXXXX..." className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="text-xs text-slate-500 font-medium block mb-1">Address</label>
                  <textarea rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="text-xs text-slate-500 font-medium block mb-1">Phone</label>
                  <input placeholder="+91..." className="w-full h-9 border border-slate-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-700 mb-4">Keyboard Shortcuts</h3>
              <div className="space-y-2 text-sm">
                {[['F2', 'Fast Billing (POS)'], ['Alt+1', 'Dashboard'], ['Alt+2', 'Sale Invoice'], ['Alt+3', 'Purchase Bill'], ['Alt+4', 'Parties'], ['Alt+5', 'Items'], ['Alt+6', 'Reports'], ['Alt+7', 'Settings'], ['Ctrl+N', 'New Item / New Party'], ['F10', 'Save current form'], ['Esc', 'Close / Cancel']].map(([key, desc]) => (
                  <div key={key} className="flex items-center justify-between py-1 border-b border-slate-100 last:border-0">
                    <span className="text-slate-600">{desc}</span>
                    <kbd className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-mono">{key}</kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
