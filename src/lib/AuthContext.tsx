'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase, UserProfile, Store, StoreUser } from '@/lib/supabase';
import { initCloudDB, clearCloudDB } from '@/lib/db-cloud';

// ─── Context shape ────────────────────────────────────────────────────────────

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;

  activeStore: Store | null;
  activeRole: StoreUser['role'] | null;
  setActiveStore: (store: Store, role: StoreUser['role']) => void;

  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;

  isSuperAdmin: boolean;
  isOwner: boolean;
  isCashier: boolean;

  // Cloud connection status
  isOnline: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession]         = useState<Session | null>(null);
  const [user, setUser]               = useState<User | null>(null);
  const [profile, setProfile]         = useState<UserProfile | null>(null);
  const [loading, setLoading]         = useState(true);
  const [isOnline, setIsOnline]       = useState(true);

  const [activeStore, setActiveStoreState] = useState<Store | null>(null);
  const [activeRole, setActiveRole]        = useState<StoreUser['role'] | null>(null);

  const STORE_PERSIST_KEY = 'mediflow-active-store';

  // ── Online detection ──────────────────────────────────────────────────────
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // ── Load user profile from store_users ────────────────────────────────────
  const loadProfile = useCallback(async (u: User) => {
    // Super admin check — supports both metadata formats
    const meta = u.user_metadata ?? {};
    const appMeta = u.app_metadata ?? {};
    const isSuperAdmin =
      meta.role === 'super_admin' ||
      appMeta.role === 'super_admin' ||
      u.email === 'winmihir@gmail.com'; // fallback for the hardcoded super admin

    if (isSuperAdmin) {
      setProfile({
        id: u.id,
        email: u.email ?? '',
        display_name: meta.display_name ?? 'Super Admin',
        is_super_admin: true,
        stores: [],
      });
      return;
    }

    // Fetch store memberships
    const { data, error } = await supabase
      .from('store_users')
      .select(`
        store_id,
        role,
        display_name,
        stores ( id, name, gstin, address, phone, logo_url, plan, is_active, created_at, updated_at, created_by )
      `)
      .eq('user_id', u.id)
      .eq('is_active', true);

    if (error) {
      console.error('[AuthContext] Failed to load stores:', error.message);
      setProfile({
        id: u.id,
        email: u.email ?? '',
        display_name: u.email ?? '',
        is_super_admin: false,
        stores: [],
      });
      return;
    }

    const storeList = (data ?? []).map((row: any) => ({
      store_id: row.store_id,
      store_name: row.stores?.name ?? 'Unknown Store',
      role: row.role,
    }));

    setProfile({
      id: u.id,
      email: u.email ?? '',
      display_name: data?.[0]?.display_name ?? u.email ?? '',
      is_super_admin: false,
      stores: storeList,
    });

    // Auto-select if only one store
    if (storeList.length === 1 && data?.[0]?.stores) {
      const storeData = data[0].stores as unknown as Store;
      setActiveStoreState(storeData);
      setActiveRole(storeList[0].role);
      // Persist to localStorage for next app launch
      try { localStorage.setItem(STORE_PERSIST_KEY, JSON.stringify({ store: storeData, role: storeList[0].role })); } catch {}
      // Init cloud DB for this store
      initCloudDB(storeData.id);
    } else if (storeList.length > 1) {
      // Multi-store: try to restore previously selected store from localStorage
      try {
        const raw = localStorage.getItem(STORE_PERSIST_KEY);
        if (raw) {
          const { store, role } = JSON.parse(raw) as { store: Store; role: StoreUser['role'] };
          // Verify the stored store is still in the user's store list
          const stillMember = storeList.find(s => s.store_id === store.id);
          if (stillMember && store.is_active) {
            setActiveStoreState(store);
            setActiveRole(role);
            initCloudDB(store.id);
          }
        }
      } catch {}
    }
  }, []);

  // ── Bootstrap session ────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Handle invalid/expired refresh tokens gracefully
      if (event === 'TOKEN_REFRESHED' && !session) {
        console.warn('[Auth] Token refresh failed — session expired. Signing out.');
        supabase.auth.signOut();
        setProfile(null);
        setActiveStoreState(null);
        setActiveRole(null);
        clearCloudDB();
        return;
      }
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setProfile(null);
        setActiveStoreState(null);
        setActiveRole(null);
        clearCloudDB();
        return;
      }
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user);
      } else {
        setProfile(null);
        setActiveStoreState(null);
        setActiveRole(null);
        clearCloudDB();
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [loadProfile]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const signIn = useCallback(async (email: string, password: string): Promise<{ error: string | null }> => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setActiveStoreState(null);
    setActiveRole(null);
    clearCloudDB();
    // Clear persisted store so a fresh login works correctly
    try { localStorage.removeItem(STORE_PERSIST_KEY); } catch {}
  }, [STORE_PERSIST_KEY]);

  const setActiveStore = useCallback((store: Store, role: StoreUser['role']) => {
    setActiveStoreState(store);
    setActiveRole(role);
    // Persist selection so it's restored on next app launch
    try { localStorage.setItem(STORE_PERSIST_KEY, JSON.stringify({ store, role })); } catch {}
    initCloudDB(store.id);
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────
  const isSuperAdmin = profile?.is_super_admin ?? false;
  const isOwner      = activeRole === 'owner';
  const isCashier    = activeRole === 'cashier';

  return (
    <AuthContext.Provider
      value={{
        session, user, profile, loading,
        activeStore, activeRole, setActiveStore,
        signIn, signOut,
        isSuperAdmin, isOwner, isCashier,
        isOnline,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
