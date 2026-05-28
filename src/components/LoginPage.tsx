'use client';

import { useState, useEffect } from 'react';
import { Eye, EyeOff, Activity, Loader2, AlertCircle, Mail, Lock, ShieldCheck, Sparkles, Server } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

export default function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { signIn, loading: authLoading } = useAuth();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Background particle configuration for visual premium effect
  const [particles] = useState(() =>
    Array.from({ length: 30 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 1,
      delay: Math.random() * 5,
      duration: Math.random() * 6 + 4,
    }))
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setLoading(true);
    setError(null);

    const { error: signInError } = await signIn(email.trim(), password);

    setLoading(false);

    if (signInError) {
      if (signInError.toLowerCase().includes('invalid login')) {
        setError('Incorrect email or password. Please verify and try again.');
      } else if (signInError.toLowerCase().includes('email not confirmed')) {
        setError('Your email address is not verified. Please contact your administrator.');
      } else {
        setError(signInError);
      }
      return;
    }

    onLoggedIn();
  };

  const isLoading = loading || authLoading;

  return (
    <div className="min-h-screen w-full flex bg-slate-950 font-sans overflow-hidden relative">
      
      {/* Decorative Shifting Ambient Background (Global) */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <div
          className="absolute rounded-full opacity-30 blur-[130px] animate-pulse"
          style={{
            background: 'radial-gradient(circle, rgba(37,99,235,0.2) 0%, transparent 70%)',
            width: '600px',
            height: '600px',
            top: '-15%',
            left: '-10%',
            animationDuration: '8s',
          }}
        />
        <div
          className="absolute rounded-full opacity-20 blur-[120px] animate-pulse"
          style={{
            background: 'radial-gradient(circle, rgba(124,58,237,0.15) 0%, transparent 70%)',
            width: '500px',
            height: '500px',
            bottom: '-10%',
            right: '-5%',
            animationDuration: '10s',
          }}
        />
      </div>

      {/* LEFT SIDE: Brand presentation & feature grid (Visible on desktop) */}
      <div className="hidden lg:flex lg:w-7/12 p-12 flex-col justify-between relative overflow-hidden border-r border-slate-900 bg-slate-950">
        
        {/* Subtle decorative grid overlay */}
        <div 
          className="absolute inset-0 opacity-[0.02] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: '24px 24px'
          }}
        />

        {/* Shifting colored vector layers inside the brand panel */}
        <div className="absolute top-1/4 right-0 w-80 h-80 rounded-full bg-blue-600/10 blur-[100px] pointer-events-none animate-bounce" style={{ animationDuration: '25s' }} />
        <div className="absolute bottom-1/4 left-10 w-96 h-96 rounded-full bg-violet-600/5 blur-[120px] pointer-events-none animate-bounce" style={{ animationDuration: '30s' }} />

        {/* Logo and system designation */}
        <div className="flex items-center gap-3 relative z-10 animate-fade-in">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Activity size={18} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight leading-none">MediFlow</h2>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-500">Enterprise Suite</span>
          </div>
        </div>

        {/* Dynamic Mockup Showcase */}
        <div className="my-auto max-w-lg relative z-10">
          <div className="mb-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-950/40 border border-blue-900/30 text-blue-400 text-xs font-semibold">
            <Sparkles size={12} className="animate-spin" style={{ animationDuration: '4s' }} />
            <span>Next-Generation POS Billing Platform</span>
          </div>
          <h1 className="text-4xl font-extrabold text-white tracking-tight leading-tight">
            Seamless multi-store pharmacy operations, made simple.
          </h1>
          <p className="text-slate-400 mt-4 text-base leading-relaxed">
            Manage drug catalog inventory, handle instant thermal receipts, monitor cashier shifts, and track offline transaction syncs seamlessly from any device.
          </p>

          {/* Core Feature Checklist */}
          <div className="grid grid-cols-2 gap-4 mt-8">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/30 border border-slate-800/40 backdrop-blur-md">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 flex-shrink-0">
                <ShieldCheck size={16} />
              </div>
              <div>
                <p className="text-white text-xs font-bold leading-none">Strict Tenant Isolation</p>
                <p className="text-slate-500 text-[10px] mt-1">RLS protected store partitions</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/30 border border-slate-800/40 backdrop-blur-md">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 flex-shrink-0">
                <Server size={16} />
              </div>
              <div>
                <p className="text-white text-xs font-bold leading-none">Realtime Sync Outbox</p>
                <p className="text-slate-500 text-[10px] mt-1">Automatic SQLite cloud bridge</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="text-xs text-slate-500 relative z-10 flex items-center justify-between">
          <span>&copy; {new Date().getFullYear()} MediFlow Inc. All rights reserved.</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Cloud Sync Online</span>
        </div>
      </div>

      {/* RIGHT SIDE: Interactive Glassmorphic Login Form (Full width on smaller screens) */}
      <div className="w-full lg:w-5/12 flex items-center justify-center p-6 sm:p-12 relative z-10">
        
        {/* Floating particle background behind form */}
        <div className="absolute inset-0 pointer-events-none z-0">
          {particles.map(p => (
            <div
              key={p.id}
              className="absolute rounded-full bg-blue-400/20"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                animation: `floatUp ${p.duration}s linear infinite`,
                animationDelay: `${p.delay}s`,
              }}
            />
          ))}
        </div>

        {/* Responsive glass container */}
        <div
          className="w-full max-w-md p-8 sm:p-10 relative z-10"
          style={{
            background: 'rgba(11, 17, 32, 0.75)',
            backdropFilter: 'blur(30px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '24px',
            boxShadow: '0 30px 60px -15px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
          }}
        >
          {/* Glowing blue ceiling bar inside card */}
          <div
            className="absolute top-0 left-12 right-12 h-[2px]"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(37,99,235,0.7), transparent)' }}
          />

          {/* Form Header */}
          <div className="flex flex-col items-center mb-8">
            {/* Show simple logo on mobile header */}
            <div className="lg:hidden w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25 mb-4">
              <Activity size={22} className="text-white" />
            </div>
            
            <h2 className="text-2xl font-extrabold text-white tracking-tight">Welcome Back</h2>
            <p className="text-slate-400 text-sm mt-1.5 text-center">
              Enter your registered store account credentials below
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div
              className="flex items-start gap-3 mb-6 p-4 rounded-xl text-xs leading-normal animate-in fade-in slide-in-from-top-2 duration-200"
              style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#fca5a5',
              }}
            >
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            
            {/* Email Address */}
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Store Email Address
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 flex items-center pointer-events-none">
                  <Mail size={16} />
                </div>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(null); }}
                  placeholder="name@store.com"
                  disabled={isLoading}
                  className="w-full h-11 pl-11 pr-4 rounded-xl text-sm text-white placeholder-slate-600 outline-none transition-all duration-200"
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                  onFocus={e => {
                    e.target.style.border = '1px solid rgba(37, 99, 235, 0.5)';
                    e.target.style.background = 'rgba(255, 255, 255, 0.05)';
                    e.target.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.15)';
                  }}
                  onBlur={e => {
                    e.target.style.border = '1px solid rgba(255, 255, 255, 0.08)';
                    e.target.style.background = 'rgba(255, 255, 255, 0.03)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label htmlFor="login-password" className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Account Password
                </label>
              </div>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 flex items-center pointer-events-none">
                  <Lock size={16} />
                </div>
                <input
                  id="login-password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(null); }}
                  placeholder="••••••••"
                  disabled={isLoading}
                  className="w-full h-11 pl-11 pr-11 rounded-xl text-sm text-white placeholder-slate-600 outline-none transition-all duration-200"
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                  onFocus={e => {
                    e.target.style.border = '1px solid rgba(37, 99, 235, 0.5)';
                    e.target.style.background = 'rgba(255, 255, 255, 0.05)';
                    e.target.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.15)';
                  }}
                  onBlur={e => {
                    e.target.style.border = '1px solid rgba(255, 255, 255, 0.08)';
                    e.target.style.background = 'rgba(255, 255, 255, 0.03)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(p => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors p-1"
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Login button */}
            <button
              id="login-submit"
              type="submit"
              disabled={isLoading || !email.trim() || !password}
              className="w-full h-11 mt-4 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]"
              style={{
                background: isLoading
                  ? 'rgba(37, 99, 235, 0.6)'
                  : 'linear-gradient(135deg, #2563eb, #4f46e5)',
                boxShadow: isLoading ? 'none' : '0 4px 20px rgba(37, 99, 235, 0.3)',
              }}
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Authenticating Credentials…
                </>
              ) : (
                'Sign In to Dashboard'
              )}
            </button>
          </form>

          {/* Form Footer */}
          <div className="mt-8 text-center border-t border-slate-900/60 pt-6">
            <p className="text-[11px] text-slate-500">
              Need cashier access? Request your Store Administrator to invite you.
            </p>
          </div>
        </div>
      </div>

      {/* Floating animations definitions */}
      <style>{`
        @keyframes floatUp {
          0% {
            transform: translateY(110vh) scale(0.8);
            opacity: 0;
          }
          10% {
            opacity: 0.3;
          }
          90% {
            opacity: 0.3;
          }
          100% {
            transform: translateY(-10vh) scale(1.2);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
