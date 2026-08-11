'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { getDB } from '@/lib/db';
import { Search, X, FileText, Package, Users } from 'lucide-react';

interface GlobalSearchProps {
  onNavigate?: (page: string, query?: string, txnId?: number, txnType?: string) => void;
}

const normalizeSql = (column: string) =>
  `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${column}, ''), ' ', ''), '.', ''), '-', ''), '/', ''), '(', ''), ')', ''))`;

export default function GlobalSearch({ onNavigate }: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ items: any[]; parties: any[]; transactions: any[] }>({ items: [], parties: [], transactions: [] });
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 2) { setResults({ items: [], parties: [], transactions: [] }); setLoading(false); return; }
    setLoading(true);
    try {
      const db = await getDB();
      const words = q.trim().split(/\s+/).filter(w => w.length > 0);
      const like = `%${q}%`;
      const wordLikes = words.map(w => `%${w}%`);

      // Fast item name matching: each word must appear in name
      const itemWordConds = words.map((_, i) => `name LIKE $${i + 1}`).join(' AND ');
      const partyWordConds = words.map((_, i) => `name LIKE $${i + 1}`).join(' AND ');

      // Step 1: Fast items query — no JOINs, just search items table directly
      const items = await db.select<any[]>(
        `SELECT id, name, category, sale_price, current_stock, tax_rate FROM items WHERE (${itemWordConds}) OR hsn LIKE $${words.length + 1} ORDER BY name LIMIT 8`,
        [...wordLikes, like]
      );

      // Step 2: Fetch last supplier for found items, falling back to normalized item-name matching
      if (items.length > 0) {
        const supplierPromises = items.map(async (it: any) => {
          const normalizedName = it.name
            .toLowerCase()
            .replace(/[\s./()-]+/g, '');
          const res = await db.select<any[]>(`
            SELECT p.name as supplier 
            FROM transaction_items ti 
            JOIN transactions t ON t.id=ti.txn_id AND t.type='purchase' 
            JOIN parties p ON p.id=t.party_id 
            WHERE ti.item_id = $1 OR ${normalizeSql('ti.item_name')} = $2
            ORDER BY t.id DESC LIMIT 1
          `, [it.id, normalizedName]);
          return res.length > 0 ? res[0].supplier : null;
        });
        const suppliers = await Promise.all(supplierPromises);
        items.forEach((it: any, i: number) => { it.last_supplier = suppliers[i]; });
      }

      // Step 3: Parties — simple and fast
      const parties = await db.select<any[]>(
        `SELECT id,name,phone,type FROM parties WHERE (${partyWordConds}) OR phone LIKE $${words.length + 1} LIMIT 5`,
        [...wordLikes, like]
      );

      // Step 4: Transactions — simplified
      const transactions = await db.select<any[]>(
        `SELECT t.id,t.invoice_no,t.date,t.total_amount,t.type,p.name as party_name FROM transactions t LEFT JOIN parties p ON t.party_id=p.id WHERE t.invoice_no LIKE $1 OR p.name LIKE $1 ORDER BY t.id DESC LIMIT 8`,
        [like]
      );

      setResults({ items, parties, transactions });
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  const search = useCallback((q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim() || q.length < 2) { setResults({ items: [], parties: [], transactions: [] }); return; }
    setLoading(true);
    debounceRef.current = setTimeout(() => doSearch(q), 200);
  }, [doSearch]);

  const hasResults = results.items.length + results.parties.length + results.transactions.length > 0;

  return (
    <>
      {/* Trigger pill in header */}
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className="flex items-center gap-2 px-4 h-9 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-sm text-slate-400 transition-colors min-w-48"
      >
        <Search size={14} />
        <span>Search anything...</span>
        <kbd className="ml-auto text-xs bg-white border border-slate-200 text-slate-400 px-1.5 py-0.5 rounded font-mono">Ctrl+F</kbd>
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center pt-20 bg-black/40 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) { setOpen(false); setQuery(''); } }}
        >
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 border-b border-slate-200">
              <Search size={18} className="text-slate-400 flex-shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => search(e.target.value)}
                placeholder="Search items, parties, invoices…"
                className="flex-1 h-14 text-lg text-slate-800 bg-transparent focus:outline-none placeholder:text-slate-300"
                autoFocus
              />
              {loading && <span className="text-xs text-slate-400 animate-pulse">Searching…</span>}
              <button onClick={() => { setOpen(false); setQuery(''); }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400">
                <X size={16} />
              </button>
            </div>

            {/* Results */}
            <div className="max-h-[480px] overflow-y-auto p-2">
              {!query && (
                <div className="py-12 text-center text-slate-300">
                  <Search size={36} className="mx-auto mb-3" />
                  <p className="text-sm">Type to search across all items, parties & invoices</p>
                </div>
              )}

              {query && !hasResults && !loading && (
                <div className="py-8 text-center text-slate-400 text-sm">No results for "{query}"</div>
              )}

              {/* Items */}
              {results.items.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 py-1.5">Items</p>
                  {results.items.map(item => (
                    <button key={`item-${item.id}`} onClick={() => { onNavigate?.('items', item.name); setOpen(false); setQuery(''); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-blue-50 text-left transition-colors group">
                      <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <Package size={15} className="text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-800 truncate">{item.name}</p>
                        <p className="text-[11px] text-slate-400">
                          {item.category || 'No category'} • Stock: {item.current_stock}
                        </p>
                        {item.last_supplier && <p className="text-[10px] text-brand font-semibold mt-0.5">⬅ Purchased from: {item.last_supplier}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-slate-800 font-mono">₹{item.sale_price}</p>
                        {item.tax_rate > 0 && <p className="text-[10px] text-slate-400">GST {item.tax_rate}%</p>}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Parties */}
              {results.parties.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 py-1.5">Parties</p>
                  {results.parties.map(p => (
                    <button key={p.id} onClick={() => { onNavigate?.('parties', p.name); setOpen(false); setQuery(''); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-green-50 text-left transition-colors">
                      <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                        <Users size={15} className="text-green-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-slate-800">{p.name}</p>
                        <p className="text-xs text-slate-400">{p.phone && `📞 ${p.phone} • `}{p.type}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${p.type === 'customer' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{p.type}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Transactions */}
              {results.transactions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 py-1.5">Transactions</p>
                  {results.transactions.map(t => (
                    <button key={t.id} onClick={() => {
                      onNavigate?.(t.type === 'sale' ? 'sale' : 'purchase', undefined, t.id, t.type);
                      setOpen(false); setQuery('');
                    }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-purple-50 text-left transition-colors">
                      <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                        <FileText size={15} className="text-purple-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-slate-800 font-mono">{t.invoice_no || `#${t.id}`}</p>
                        <p className="text-xs text-slate-400">{t.party_name || 'Walk-in'} • {t.date ? new Date(t.date).toLocaleDateString('en-GB') : ''}</p>
                        {t.matched_batch && <p className="text-[10px] text-brand font-medium mt-0.5">Matched Batch: {t.matched_batch}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-slate-800 font-mono">₹{t.total_amount?.toFixed(2)}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${t.type === 'sale' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{t.type}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center gap-4 text-xs text-slate-400">
              <span><kbd className="font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded">↑↓</kbd> navigate</span>
              <span><kbd className="font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded">Enter</kbd> open</span>
              <span><kbd className="font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded">Esc</kbd> close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
