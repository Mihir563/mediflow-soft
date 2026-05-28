'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase, Store } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import {
  Activity, Building2, Users, Plus, Search, MoreVertical,
  CheckCircle, XCircle, X, Loader2, Shield,
  LogOut, RefreshCw, AlertCircle, ChevronDown, Copy, Check,
  Download, Eye, EyeOff, Key, UserCheck, Smartphone, CheckSquare, Sparkles, LogIn
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreWithStats extends Store {
  member_count?: number;
}

// ─── Stat Card Component (Premium Responsive Styling) ─────────────────────────

function StatCard({ icon: Icon, label, value, trend, color, glowColor }: {
  icon: any; label: string; value: string | number; trend: string; color: string; glowColor: string;
}) {
  return (
    <div
      className="relative rounded-2xl p-6 flex flex-col justify-between overflow-hidden transition-all duration-300 hover:translate-y-[-2px] group"
      style={{
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.05)'
      }}
    >
      {/* Back glow */}
      <div 
        className="absolute -top-12 -right-12 w-28 h-28 rounded-full opacity-10 transition-opacity duration-300 group-hover:opacity-15 blur-2xl pointer-events-none"
        style={{ background: glowColor }}
      />

      <div className="flex items-center justify-between mb-4">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110"
          style={{ 
            background: color, 
            boxShadow: `0 8px 24px -4px ${glowColor}`
          }}
        >
          <Icon size={22} className="text-white" />
        </div>
        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
          {trend}
        </span>
      </div>
      <div>
        <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">{label}</p>
        <p className="text-white text-3xl font-extrabold mt-1 tracking-tight">{value}</p>
      </div>
    </div>
  );
}

// ─── Create Store Modal ───────────────────────────────────────────────────────

function CreateStoreModal({
  onClose,
  onCreated,
  superAdminId,
}: {
  onClose: () => void;
  onCreated: (store: Store) => void;
  superAdminId: string;
}) {
  const [form, setForm] = useState({
    name: '', gstin: '', address: '', phone: '',
    ownerEmail: '', ownerName: '', ownerPassword: '', plan: 'basic' as const,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  
  // Credentials review card state upon success
  const [successCredentials, setSuccessCredentials] = useState<{
    email: string;
    pass: string;
    storeName: string;
    plan: string;
  } | null>(null);
  const [copiedUser, setCopiedUser] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  const set = (k: string, v: string) => {
    setForm(f => ({ ...f, [k]: v }));
    setError(null);
  };

  // Generate secure random password
  const handleAutoGeneratePassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
    let newPass = '';
    // Let's add prefix "MF-" to make it recognizable
    newPass += 'MF-';
    for (let i = 0; i < 9; i++) {
      newPass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    set('ownerPassword', newPass);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { setError('Store Name is required.'); return; }
    if (!form.ownerEmail.trim()) { setError('Owner Email Address is required.'); return; }
    if (!form.ownerPassword || form.ownerPassword.length < 6) { 
      setError('A secure password (at least 6 characters) is required for the store owner.'); 
      return; 
    }

    setLoading(true);
    setError(null);

    // Call database security definer RPC
    const { data: storeId, error: createError } = await supabase.rpc('create_store_with_owner', {
      p_store_name: form.name.trim(),
      p_gstin: form.gstin.trim() || null,
      p_address: form.address.trim() || null,
      p_phone: form.phone.trim() || null,
      p_plan: form.plan,
      p_owner_email: form.ownerEmail.trim(),
      p_owner_password: form.ownerPassword,
      p_owner_name: form.ownerName.trim() || form.ownerEmail.trim(),
      p_super_admin_id: superAdminId,
    });

    if (createError || !storeId) {
      setError(createError?.message ?? 'Failed to execute store creation script.');
      setLoading(false);
      return;
    }

    // Retrieve created store stats to append back to UI
    const { data: newStore, error: fetchErr } = await supabase
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .single();

    setLoading(false);

    if (fetchErr || !newStore) {
      // Still display success credentials since database creation completed successfully
      setSuccessCredentials({
        email: form.ownerEmail.trim(),
        pass: form.ownerPassword,
        storeName: form.name.trim(),
        plan: form.plan
      });
      return;
    }

    // Setup credentials display before modal transition
    setSuccessCredentials({
      email: form.ownerEmail.trim(),
      pass: form.ownerPassword,
      storeName: form.name.trim(),
      plan: form.plan
    });
    
    // Optimistically update list
    onCreated(newStore as Store);
  };

  const handleCopy = (text: string, type: 'user' | 'pass') => {
    navigator.clipboard.writeText(text);
    if (type === 'user') {
      setCopiedUser(true);
      setTimeout(() => setCopiedUser(false), 2000);
    } else {
      setCopiedPass(true);
      setTimeout(() => setCopiedPass(false), 2000);
    }
  };

  const handleDownloadCredentials = () => {
    if (!successCredentials) return;
    const content = `================================================
MEDIFLOW ENTERPRISE SUITE — STORE ACCESS CREDENTIALS
================================================
Store Name : ${successCredentials.storeName}
Plan Level : ${successCredentials.plan.toUpperCase()}
Owner Email: ${successCredentials.email}
Password   : ${successCredentials.pass}
================================================
Instructions:
1. Open the MediFlow App or go to the Web Address.
2. Sign in with the Owner Email and Password above.
3. Access store catalogs, billing settings, and cashier roles.
================================================`;
    
    const file = new Blob([content], { type: 'text/plain' });
    const element = document.createElement("a");
    element.href = URL.createObjectURL(file);
    element.download = `${successCredentials.storeName.replace(/\s+/g, "_")}_credentials.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const inputClass = `
    w-full h-11 px-4 rounded-xl text-sm text-white placeholder-slate-600 outline-none transition-all duration-200
    bg-white/5 border border-white/10
    focus:border-blue-500/50 focus:bg-white/[0.08] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.15)]
  `;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in" onClick={e => e.target === e.currentTarget && !successCredentials && onClose()}>
      
      {/* Card container */}
      <div
        className="w-full max-w-xl rounded-3xl overflow-hidden transition-all duration-300 scale-in"
        style={{
          background: 'rgba(10, 14, 26, 0.96)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 40px 80px -15px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.02)',
        }}
      >
        {/* SUCCESS CREDENTIALS DISPATCH CARD */}
        {successCredentials ? (
          <div className="p-8 space-y-6">
            
            {/* Header */}
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 animate-bounce">
                <CheckSquare size={32} />
              </div>
              <h3 className="text-white font-extrabold text-2xl tracking-tight">Store Created Successfully!</h3>
              <p className="text-slate-400 text-sm mt-1 max-w-sm">
                The database tables have been provisioned and the owner profile has been registered.
              </p>
            </div>

            {/* Plan indicator badge */}
            <div className="p-4 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400">
                  <Sparkles size={16} />
                </div>
                <div>
                  <h4 className="text-white text-xs font-bold">{successCredentials.storeName}</h4>
                  <span className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">{successCredentials.plan} Subscription</span>
                </div>
              </div>
              <span className="text-[10px] text-emerald-400 font-bold uppercase bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                Active Store
              </span>
            </div>

            {/* Credentials copy grids */}
            <div className="space-y-3.5">
              <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Administrative Credentials</h5>
              
              {/* Owner Username / Email */}
              <div className="space-y-1">
                <label className="text-xs text-slate-400 font-medium">Owner Username / Email</label>
                <div className="flex gap-2">
                  <div className="flex-1 h-11 px-4 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between text-white font-mono text-sm overflow-hidden select-text">
                    <span className="truncate">{successCredentials.email}</span>
                  </div>
                  <button
                    onClick={() => handleCopy(successCredentials.email, 'user')}
                    className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    {copiedUser ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              {/* Owner Password */}
              <div className="space-y-1">
                <label className="text-xs text-slate-400 font-medium">Owner Password</label>
                <div className="flex gap-2">
                  <div className="flex-1 h-11 px-4 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between text-white font-mono text-sm overflow-hidden select-text">
                    <span className="truncate">{successCredentials.pass}</span>
                  </div>
                  <button
                    onClick={() => handleCopy(successCredentials.pass, 'pass')}
                    className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    {copiedPass ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Warnings and dispatch instructions */}
            <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/15 flex items-start gap-3">
              <AlertCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-200/70 leading-normal">
                <strong>CRITICAL SECURITY NOTICE:</strong> This password is encrypted in our servers and cannot be viewed again. Please copy or download the credentials right now to avoid account recovery.
              </p>
            </div>

            {/* Actions button */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={handleDownloadCredentials}
                className="flex-1 h-11 rounded-xl border border-white/10 hover:bg-white/5 transition-colors flex items-center justify-center gap-2 text-sm text-slate-300 hover:text-white font-bold"
              >
                <Download size={15} /> Download Credentials (.TXT)
              </button>
              <button
                onClick={onClose}
                className="flex-1 h-11 rounded-xl text-white font-bold text-sm transition-all flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)', boxShadow: '0 4px 16px rgba(37,99,235,0.35)' }}
              >
                Done, Back to Dashboard
              </button>
            </div>

          </div>
        ) : (
          /* STANDARD STORE DETAILS CAPTURE FORM */
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-white/5 bg-white/[0.01]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
                  <Building2 size={18} className="text-white" />
                </div>
                <div>
                  <h3 className="text-white font-extrabold text-lg leading-none">Provision Store Space</h3>
                  <span className="text-[10px] text-blue-500 uppercase tracking-widest font-semibold">Instance Creator</span>
                </div>
              </div>
              <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1.5 rounded-xl hover:bg-white/5">
                <X size={18} />
              </button>
            </div>

            {/* Form scroll window */}
            <div className="px-8 py-6 max-h-[65vh] overflow-y-auto space-y-6 scrollbar-thin">
              {error && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-xs">
                  <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* SECTION A: Store specs */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                  <Building2 size={14} className="text-blue-400" />
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Store Configurations</h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Store Name *</label>
                    <input className={inputClass} placeholder="e.g. Raghuveer Medical Store" value={form.name} onChange={e => set('name', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Primary Phone</label>
                    <input className={inputClass} placeholder="e.g. +91 98765 43210" value={form.phone} onChange={e => set('phone', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Store GSTIN</label>
                    <input className={inputClass} placeholder="e.g. 27AAAAA0000A1Z5" value={form.gstin} onChange={e => set('gstin', e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Full Store Address</label>
                    <input className={inputClass} placeholder="Full physical location address" value={form.address} onChange={e => set('address', e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Subscription Level Plan</label>
                    <div className="relative">
                      <select
                        className={`${inputClass} appearance-none cursor-pointer pr-10`}
                        value={form.plan}
                        onChange={e => set('plan', e.target.value as any)}
                      >
                        <option value="basic" className="bg-slate-950 text-white">Basic Core Space (Free / Offline-Capable)</option>
                        <option value="pro" className="bg-slate-950 text-white">Professional Cloud Space (₹999/mo / Multi-Device)</option>
                        <option value="enterprise" className="bg-slate-950 text-white">Enterprise Space (Custom SLA / Unlimited Channels)</option>
                      </select>
                      <ChevronDown size={14} className="text-slate-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION B: Owner account creator */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                  <UserCheck size={14} className="text-violet-400" />
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Store Administrator Account</h4>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Owner Display Name</label>
                    <input className={inputClass} placeholder="e.g. Raghuveer Patel" value={form.ownerName} onChange={e => set('ownerName', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Owner Email Address *</label>
                    <input className={inputClass} type="email" placeholder="owner@storeemail.com" value={form.ownerEmail} onChange={e => set('ownerEmail', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 font-semibold mb-1.5 block">Owner Access Password *</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          className={inputClass}
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Password min 6 chars"
                          value={form.ownerPassword}
                          onChange={e => set('ownerPassword', e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors p-1"
                        >
                          {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={handleAutoGeneratePassword}
                        className="h-11 px-4 rounded-xl bg-blue-600/10 border border-blue-500/25 hover:bg-blue-600/20 text-blue-400 font-semibold text-xs transition-colors flex items-center gap-1.5 flex-shrink-0"
                      >
                        <Key size={13} /> Auto-Generate
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-end gap-3 px-8 py-5 border-t border-white/5 bg-white/[0.01]">
              <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-all">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed select-none active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)', boxShadow: '0 4px 16px rgba(37,99,235,0.3)' }}
              >
                {loading ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Provisioning Instance…
                  </>
                ) : (
                  <>
                    <Plus size={15} /> Create Store Space
                  </>
                )}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

// ─── Main Admin Dashboard Component (State-Of-The-Art Redesign) ─────────────

export default function AdminDashboard() {
  const { profile, signOut } = useAuth();

  const [stores, setStores] = useState<StoreWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState<'all' | 'basic' | 'pro' | 'enterprise'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  const fetchStores = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('stores')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      const withStats = await Promise.all(
        (data as Store[]).map(async store => {
          const { count } = await supabase
            .from('store_users')
            .select('*', { count: 'exact', head: true })
            .eq('store_id', store.id)
            .eq('is_active', true);
          return { ...store, member_count: count ?? 0 };
        })
      );
      setStores(withStats);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStores(); }, [fetchStores]);

  const toggleStoreStatus = async (store: StoreWithStats) => {
    const nextStatus = !store.is_active;
    await supabase
      .from('stores')
      .update({ is_active: nextStatus })
      .eq('id', store.id);
      
    setStores(prev =>
      prev.map(s => s.id === store.id ? { ...s, is_active: nextStatus } : s)
    );
    setActionMenuId(null);
  };

  const filtered = stores.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase()) || (s.phone ?? '').includes(search);
    const matchesPlan = planFilter === 'all' || s.plan === planFilter;
    return matchesSearch && matchesPlan;
  });

  const activeCount   = stores.filter(s => s.is_active).length;
  const suspendedCount = stores.filter(s => !s.is_active).length;
  const totalMembers  = stores.reduce((acc, s) => acc + (s.member_count ?? 0), 0);

  const planBadge: Record<string, string> = {
    basic:      'bg-slate-800 text-slate-300 border border-slate-700/60',
    pro:        'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    enterprise: 'bg-violet-500/10 text-violet-400 border border-violet-500/20',
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col font-sans relative overflow-x-hidden">
      
      {/* Decorative gradient shifting mesh back drop */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <div className="absolute rounded-full opacity-20 blur-[130px]" style={{ background: 'radial-gradient(circle, #2563eb 0%, transparent 60%)', width: 600, height: 600, top: '-5%', right: '5%' }} />
        <div className="absolute rounded-full opacity-10 blur-[120px]" style={{ background: 'radial-gradient(circle, #8b5cf6 0%, transparent 60%)', width: 500, height: 500, bottom: '5%', left: '5%' }} />
      </div>

      {/* Header element (Glassmorphic) */}
      <header
        className="flex items-center justify-between px-6 sm:px-10 py-5 sticky top-0 z-30 border-b border-white/5 backdrop-blur-xl"
        style={{ background: 'rgba(8, 10, 22, 0.75)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25"
          >
            <Activity size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-extrabold text-base tracking-tight leading-none">MediFlow</h1>
            <p className="text-slate-500 text-xs mt-1 font-semibold">Super Admin Console</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
            <Shield size={13} className="text-indigo-400" />
            <span className="text-indigo-300 text-[10px] font-bold uppercase tracking-wider">Master Root</span>
          </div>
          <span className="hidden sm:inline text-slate-400 text-xs font-mono">{profile?.email}</span>
          <button
            onClick={signOut}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all select-none active:scale-[0.98]"
          >
            <LogOut size={13} /> Sign Out
          </button>
        </div>
      </header>

      {/* Core viewport */}
      <main className="flex-1 p-6 sm:p-10 max-w-7xl w-full mx-auto relative z-10 space-y-8">
        
        {/* Intro greetings panel */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-3xl font-extrabold text-white tracking-tight">Infrastructure Hub</h2>
            <p className="text-slate-400 mt-1.5 text-sm max-w-xl">
              Create sandbox pharmacy spaces, monitor cashier configurations, manage storage layers, and enforce global cloud RLS policies.
            </p>
          </div>
          <div className="flex gap-3 w-full sm:w-auto">
            <button
              onClick={fetchStores}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 h-11 px-4 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-white/5 border border-white/5 hover:bg-white/10 transition-all"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh Space
            </button>
            <button
              id="admin-create-store"
              onClick={() => setShowCreate(true)}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 h-11 px-5 rounded-xl text-xs font-extrabold text-white transition-all select-none active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)', boxShadow: '0 4px 16px rgba(37,99,235,0.3)' }}
            >
              <Plus size={15} /> New Store Space
            </button>
          </div>
        </div>

        {/* Dynamic Metric cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <StatCard icon={Building2} label="Configured Store Spaces" value={stores.length} trend="+12% MoM" color="linear-gradient(135deg, #2563eb, #1d4ed8)" glowColor="rgba(37,99,235,0.6)" />
          <StatCard icon={CheckSquare} label="Active Cloud Channels" value={activeCount} trend="98.4% uptime" color="linear-gradient(135deg, #10b981, #059669)" glowColor="rgba(16,185,129,0.6)" />
          <StatCard icon={Users} label="Registered Ledger Members" value={totalMembers} trend="Live cache" color="linear-gradient(135deg, #8b5cf6, #7c3aed)" glowColor="rgba(139,92,246,0.6)" />
        </div>

        {/* Search, filters, list section */}
        <div className="space-y-4">
          
          {/* Filtering bar elements */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/40 border border-white/5 backdrop-blur-md">
            
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search instances by business name, address or phone…"
                className="w-full h-11 pl-11 pr-4 rounded-xl text-xs text-white placeholder-slate-600 bg-white/5 border border-white/10 outline-none focus:border-blue-500/50 focus:bg-white/[0.08] transition-all"
              />
            </div>

            {/* Plan selector segment controls */}
            <div className="flex p-1 rounded-xl bg-slate-950 border border-white/5 flex-wrap gap-1">
              {(['all', 'basic', 'pro', 'enterprise'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setPlanFilter(tab)}
                  className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all select-none ${
                    planFilter === tab 
                      ? 'bg-blue-600 text-white shadow-md' 
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

          </div>

          {/* List display */}
          {loading ? (
            <div className="rounded-2xl border border-white/5 p-20 flex flex-col items-center justify-center bg-slate-900/20">
              <Loader2 size={32} className="animate-spin text-blue-500 mb-3" />
              <p className="text-slate-400 text-sm">Querying global infrastructure catalog…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-white/5 p-20 flex flex-col items-center justify-center text-center bg-slate-900/20">
              <Building2 size={40} className="text-slate-800 mb-4" />
              <h4 className="text-white font-bold text-base">No instances found</h4>
              <p className="text-slate-500 text-xs mt-1 max-w-sm">
                {search || planFilter !== 'all' 
                  ? 'No store spaces match your search term or plan configuration filter criteria.' 
                  : 'Get started by creating your very first store space in the sandbox area.'}
              </p>
            </div>
          ) : (
            <>
              {/* DESKTOP TABLE VIEW (Visible on larger viewports) */}
              <div className="hidden md:block rounded-2xl border border-white/5 overflow-hidden bg-slate-900/10">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.02] border-b border-white/5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      <th className="px-6 py-4">Store Profile</th>
                      <th className="px-6 py-4">Level</th>
                      <th className="px-6 py-4">Contact</th>
                      <th className="px-6 py-4">Tax ID (GST)</th>
                      <th className="px-6 py-4">Active Staff</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((store, idx) => (
                      <tr
                        key={store.id}
                        className="border-b border-white/5 hover:bg-white/[0.02] transition-colors duration-200"
                        style={{ background: idx % 2 === 0 ? 'rgba(255,255,255,0.005)' : 'transparent' }}
                      >
                        <td className="px-6 py-4.5">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 to-indigo-700 flex items-center justify-center text-white font-extrabold text-sm shadow-md shadow-blue-950/20">
                              {store.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-white font-bold text-sm leading-none">{store.name}</p>
                              <span className="text-slate-500 text-[10px] mt-1.5 block truncate max-w-[180px] font-mono leading-none">{store.address ?? 'No physical address set'}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4.5">
                          <span className={`text-[9px] font-extrabold uppercase px-2.5 py-1 rounded-lg ${planBadge[store.plan]}`}>
                            {store.plan}
                          </span>
                        </td>
                        <td className="px-6 py-4.5 text-slate-300 text-xs font-semibold">{store.phone ?? '—'}</td>
                        <td className="px-6 py-4.5 text-slate-400 font-mono text-xs">{store.gstin ?? '—'}</td>
                        <td className="px-6 py-4.5">
                          <div className="flex items-center gap-1.5 text-slate-300 text-xs font-semibold">
                            <Users size={12} className="text-slate-500" />
                            <span>{store.member_count} active</span>
                          </div>
                        </td>
                        <td className="px-6 py-4.5">
                          {store.is_active ? (
                            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-500/10 border border-slate-500/25 px-2 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" /> Suspended
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4.5 relative">
                          <button
                            onClick={() => setActionMenuId(actionMenuId === store.id ? null : store.id)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-all"
                          >
                            <MoreVertical size={16} />
                          </button>
                          {actionMenuId === store.id && (
                            <div
                              className="absolute right-6 top-12 z-20 rounded-2xl overflow-hidden py-1.5 min-w-[180px] scale-in border border-white/10"
                              style={{
                                background: 'rgba(10, 12, 25, 0.98)',
                                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.8)',
                              }}
                            >
                              <button
                                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-xs font-semibold text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                                onClick={() => toggleStoreStatus(store)}
                              >
                                {store.is_active ? (
                                  <>
                                    <XCircle size={14} className="text-red-400" />
                                    <span>Suspend Channel</span>
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle size={14} className="text-emerald-400" />
                                    <span>Activate Channel</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* RESPONSIVE MOBILE CARDS VIEW (Visible on mobile/tablet viewports) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:hidden">
                {filtered.map(store => (
                  <div 
                    key={store.id} 
                    className="p-5 rounded-2xl border border-white/5 space-y-4"
                    style={{ background: 'rgba(15, 23, 42, 0.4)' }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 to-indigo-700 flex items-center justify-center text-white font-extrabold text-sm shadow-md">
                          {store.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h4 className="text-white font-bold text-sm leading-tight">{store.name}</h4>
                          <span className="text-[10px] text-slate-500 mt-1 block truncate max-w-[150px] font-mono">{store.address ?? 'No address'}</span>
                        </div>
                      </div>
                      <span className={`text-[8px] font-extrabold uppercase px-2 py-0.5 rounded-md ${planBadge[store.plan]}`}>
                        {store.plan}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs border-y border-white/5 py-3">
                      <div>
                        <span className="text-slate-500 text-[10px]">Contact</span>
                        <p className="text-slate-300 font-semibold mt-0.5">{store.phone ?? '—'}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 text-[10px]">Active Staff</span>
                        <p className="text-slate-300 font-semibold mt-0.5">{store.member_count} users</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div>
                        {store.is_active ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-wider text-emerald-400">
                            <span className="w-1 h-1 rounded-full bg-emerald-400" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-wider text-slate-500">
                            <span className="w-1 h-1 rounded-full bg-slate-500" /> Suspended
                          </span>
                        )}
                      </div>
                      
                      <button
                        onClick={() => toggleStoreStatus(store)}
                        className={`px-3.5 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                          store.is_active 
                            ? 'text-red-400 bg-red-500/10 border-red-500/20 hover:bg-red-500/20' 
                            : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20'
                        }`}
                      >
                        {store.is_active ? 'Suspend' : 'Activate'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

        </div>

      </main>

      {/* Provision Space Modal */}
      {showCreate && profile && (
        <CreateStoreModal
          superAdminId={profile.id}
          onClose={() => setShowCreate(false)}
          onCreated={store => {
            setStores(prev => [{ ...store, member_count: 0 }, ...prev]);
            setShowCreate(false);
          }}
        />
      )}

      {/* Global dismiss for actions menu */}
      {actionMenuId && (
        <div className="fixed inset-0 z-10" onClick={() => setActionMenuId(null)} />
      )}
    </div>
  );
}
