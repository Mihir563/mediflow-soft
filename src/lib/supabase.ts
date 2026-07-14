import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Make sure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.local'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // Tauri / desktop — no URL-based auth
    storageKey: 'mediflow-auth-token', // named storage key for clarity
    // Supabase issues tokens with configurable expiry. The refresh token is valid
    // for the period set in the Supabase project (default 7 days / 604800 seconds).
    // autoRefreshToken: true ensures the access token is silently renewed before expiry.
  },
});

// ─── Types matching our Supabase schema ─────────────────────────────────────

export type UserRole = 'owner' | 'cashier' | 'viewer';
export type StorePlan = 'basic' | 'pro' | 'enterprise';

export interface Store {
  id: string;
  name: string;
  created_by: string;
  gstin: string | null;
  address: string | null;
  phone: string | null;
  logo_url: string | null;
  plan: StorePlan;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StoreUser {
  id: string;
  store_id: string;
  user_id: string;
  role: UserRole;
  display_name: string;
  is_active: boolean;
  invited_by: string | null;
  created_at: string;
}

// Session profile — what we store in AuthContext after login
export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  is_super_admin: boolean;
  stores: Array<{
    store_id: string;
    store_name: string;
    role: UserRole;
  }>;
}
