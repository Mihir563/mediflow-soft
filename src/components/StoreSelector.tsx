'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase, Store } from '@/lib/supabase';
import { Activity, ChevronRight, Loader2 } from 'lucide-react';

/**
 * StoreSelector — shown after login when the user belongs to multiple stores.
 * For super-admin: skipped (they go straight to AdminDashboard).
 * For single-store users: auto-selected in AuthContext, also skipped.
 */
export default function StoreSelector() {
  const { profile, setActiveStore } = useAuth();
  const [loading, setLoading] = useState<string | null>(null); // store_id being loaded

  const handleSelectStore = async (storeId: string, role: 'owner' | 'cashier' | 'viewer') => {
    setLoading(storeId);
    const { data, error } = await supabase
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .single();

    if (!error && data) {
      setActiveStore(data as Store, role);
    }
    setLoading(null);
  };

  if (!profile) return null;

  const roleColor: Record<string, string> = {
    owner:   'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    cashier: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    viewer:  'bg-slate-500/10 text-slate-400 border border-slate-500/20',
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-950">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute rounded-full opacity-15 blur-3xl"
          style={{
            background: 'radial-gradient(circle, #2563eb 0%, transparent 70%)',
            width: 500, height: 500, top: '-10%', left: '-10%',
          }}
        />
        <div
          className="absolute rounded-full opacity-10 blur-3xl"
          style={{
            background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)',
            width: 400, height: 400, bottom: '-5%', right: '-5%',
          }}
        />
      </div>

      <div
        className="relative z-10 w-full max-w-md mx-4"
        style={{
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20,
          boxShadow: '0 32px 64px -12px rgba(0,0,0,0.7)',
        }}
      >
        <div
          className="absolute top-0 left-8 right-8 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.6), transparent)' }}
        />

        <div className="px-8 pt-10 pb-10">
          {/* Header */}
          <div className="flex flex-col items-center mb-8">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
              style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)', boxShadow: '0 0 24px rgba(99,102,241,0.35)' }}
            >
              <Activity size={22} className="text-white" />
            </div>
            <h2 className="text-xl font-bold text-white">Select Store</h2>
            <p className="text-slate-400 text-sm mt-1">
              Welcome back, <span className="text-slate-200">{profile.display_name}</span>
            </p>
          </div>

          {/* Store list */}
          <div className="space-y-3">
            {profile.stores.map(s => (
              <button
                key={s.store_id}
                onClick={() => handleSelectStore(s.store_id, s.role)}
                disabled={loading === s.store_id}
                className="w-full flex items-center gap-4 px-4 py-4 rounded-xl text-left transition-all group disabled:opacity-60"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(99,102,241,0.08)';
                  (e.currentTarget as HTMLElement).style.border = '1px solid rgba(99,102,241,0.25)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
                  (e.currentTarget as HTMLElement).style.border = '1px solid rgba(255,255,255,0.08)';
                }}
              >
                {/* Store avatar */}
                <div
                  className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center text-white font-bold text-sm"
                  style={{ background: 'linear-gradient(135deg, #1d4ed8, #5b21b6)' }}
                >
                  {s.store_name.charAt(0).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{s.store_name}</p>
                  <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded mt-1 ${roleColor[s.role] ?? ''}`}>
                    {s.role}
                  </span>
                </div>

                <div className="flex-shrink-0 text-slate-600 group-hover:text-slate-300 transition-colors">
                  {loading === s.store_id
                    ? <Loader2 size={16} className="animate-spin" />
                    : <ChevronRight size={16} />
                  }
                </div>
              </button>
            ))}
          </div>

          <p className="text-center text-xs text-slate-600 mt-6">
            You have access to {profile.stores.length} store{profile.stores.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
