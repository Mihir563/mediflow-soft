'use client';

/**
 * useStoreData — Universal data hook for all store pages
 * 
 * Fetches data from Supabase cloud when the user is logged in (cloud mode).
 * Falls back to local SQLite (Tauri) when offline or running desktop-only.
 * 
 * Usage in any page:
 *   const { items, loading, refetch } = useStoreData('items');
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';

// ─── Generic hook for any table ───────────────────────────────────────────────

interface UseStoreDataOptions {
  select?: string;
  filter?: Record<string, any>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
  enabled?: boolean;
}

export function useStoreData<T = any>(
  table: string,
  options: UseStoreDataOptions = {}
) {
  const { activeStore, isOnline } = useAuth();
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { select = '*', filter = {}, order, limit, enabled = true } = options;

  const fetch = useCallback(async () => {
    if (!activeStore || !enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Try cloud first
      let q = supabase
        .from(table)
        .select(select)
        .eq('store_id', activeStore.id);

      for (const [col, val] of Object.entries(filter)) {
        q = q.eq(col, val);
      }
      if (order) q = q.order(order.column, { ascending: order.ascending ?? true });
      if (limit) q = q.limit(limit);

      const { data: rows, error: err } = await q;
      if (err) throw err;
      setData((rows ?? []) as unknown as T[]);
    } catch (e: any) {
      console.error(`[useStoreData] ${table}:`, e.message);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStore?.id, table, select, JSON.stringify(filter), order?.column, limit, enabled]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

// ─── Dashboard stats ──────────────────────────────────────────────────────────

export function useDashboardStats() {
  const { activeStore } = useAuth();
  const [stats, setStats] = useState({
    todaySales: 0, todayInvoices: 0,
    todayPurchases: 0, todayPurchaseCount: 0,
    totalItems: 0, totalParties: 0,
    totalSalesAllTime: 0, totalPurchasesAllTime: 0,
    pendingBalance: 0,
  });
  const [recentTxns, setRecentTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeStore) return;
    setLoading(true);

    const today = new Date().toISOString().split('T')[0];
    const storeId = activeStore.id;

    try {
      const [todaySaleRes, todayPurRes, itemsRes, partiesRes, recentRes, allSaleRes, allPurRes, pendingRes] =
        await Promise.all([
          supabase.from('transactions').select('total_amount').eq('store_id', storeId).eq('type', 'sale').gte('date', today),
          supabase.from('transactions').select('total_amount').eq('store_id', storeId).eq('type', 'purchase').gte('date', today),
          supabase.from('items').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('is_active', true),
          supabase.from('parties').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('is_active', true),
          supabase.from('transactions').select('id, invoice_no, date, total_amount, paid_amount, balance_due, type, payment_type, status, party_id, parties(name)').eq('store_id', storeId).order('created_at', { ascending: false }).limit(15),
          supabase.from('transactions').select('total_amount').eq('store_id', storeId).eq('type', 'sale'),
          supabase.from('transactions').select('total_amount').eq('store_id', storeId).eq('type', 'purchase'),
          supabase.from('transactions').select('balance_due').eq('store_id', storeId).eq('status', 'unpaid'),
        ]);

      const sum = (rows: any[]) => rows?.reduce((s, r) => s + (Number(r.total_amount) || 0), 0) ?? 0;

      setStats({
        todaySales:          sum(todaySaleRes.data ?? []),
        todayInvoices:       todaySaleRes.data?.length ?? 0,
        todayPurchases:      sum(todayPurRes.data ?? []),
        todayPurchaseCount:  todayPurRes.data?.length ?? 0,
        totalItems:          itemsRes.count ?? 0,
        totalParties:        partiesRes.count ?? 0,
        totalSalesAllTime:   sum(allSaleRes.data ?? []),
        totalPurchasesAllTime: sum(allPurRes.data ?? []),
        pendingBalance:      (pendingRes.data ?? []).reduce((s, r) => s + (Number(r.balance_due) || 0), 0),
      });

      setRecentTxns(
        (recentRes.data ?? []).map((t: any) => ({
          ...t,
          party_name: (t.parties as any)?.name ?? null,
        }))
      );
    } catch (e: any) {
      console.error('[useDashboardStats]', e.message);
    }
    setLoading(false);
  }, [activeStore?.id]);

  useEffect(() => { load(); }, [load]);

  return { stats, recentTxns, loading, refetch: load };
}

// ─── Items with search ────────────────────────────────────────────────────────

export function useItems(search = '') {
  const { activeStore } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeStore) return;
    setLoading(true);
    let q = supabase
      .from('items')
      .select('*')
      .eq('store_id', activeStore.id)
      .eq('is_active', true)
      .order('name');

    if (search.trim()) {
      q = q.ilike('name', `%${search}%`);
    }

    const { data, error } = await q;
    if (error) console.error('[useItems]', error.message);
    else setItems(data ?? []);
    setLoading(false);
  }, [activeStore?.id, search]);

  useEffect(() => { load(); }, [load]);
  return { items, loading, refetch: load };
}

// ─── Parties with search ──────────────────────────────────────────────────────

export function useParties(type?: 'customer' | 'vendor', search = '') {
  const { activeStore } = useAuth();
  const [parties, setParties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeStore) return;
    setLoading(true);
    let q = supabase
      .from('parties')
      .select('*')
      .eq('store_id', activeStore.id)
      .eq('is_active', true)
      .order('name');

    if (type) q = q.eq('type', type);
    if (search.trim()) q = q.ilike('name', `%${search}%`);

    const { data, error } = await q;
    if (error) console.error('[useParties]', error.message);
    else setParties(data ?? []);
    setLoading(false);
  }, [activeStore?.id, type, search]);

  useEffect(() => { load(); }, [load]);
  return { parties, loading, refetch: load };
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export function useTransactions(type?: 'sale' | 'purchase', limit = 50, search = '') {
  const { activeStore } = useAuth();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeStore) return;
    setLoading(true);
    let q = supabase
      .from('transactions')
      .select('*, parties(name)')
      .eq('store_id', activeStore.id)
      .order('date', { ascending: false })
      .limit(limit);

    if (type) q = q.eq('type', type);
    if (search.trim()) q = q.ilike('invoice_no', `%${search}%`);

    const { data, error } = await q;
    if (error) console.error('[useTransactions]', error.message);
    else setTransactions(
      (data ?? []).map((t: any) => ({
        ...t,
        party_name: (t.parties as any)?.name ?? null,
      }))
    );
    setLoading(false);
  }, [activeStore?.id, type, limit, search]);

  useEffect(() => { load(); }, [load]);
  return { transactions, loading, refetch: load };
}

// ─── Cloud CRUD helpers (used by invoice/purchase pages) ─────────────────────

export async function cloudInsert(table: string, data: Record<string, any>, storeId: string) {
  const payload = ['items','parties','transactions','party_special_rates','order_book'].includes(table)
    ? { ...data, store_id: storeId }
    : data;

  const { data: result, error } = await supabase.from(table).insert(payload).select('id').single();
  if (error) throw new Error(`Insert ${table}: ${error.message}`);
  return result;
}

export async function cloudUpdate(table: string, id: string, data: Record<string, any>) {
  const { error } = await supabase.from(table).update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(`Update ${table}: ${error.message}`);
}

export async function cloudDelete(table: string, id: string) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw new Error(`Delete ${table}: ${error.message}`);
}

export async function cloudSelect<T = any>(
  table: string,
  storeId: string,
  options: { select?: string; filter?: Record<string, any>; order?: string; limit?: number } = {}
): Promise<T[]> {
  let q = supabase.from(table).select(options.select ?? '*');

  if (['items','parties','transactions','party_special_rates','order_book'].includes(table)) {
    q = q.eq('store_id', storeId);
  }
  if (options.filter) {
    for (const [col, val] of Object.entries(options.filter)) {
      q = q.eq(col, val);
    }
  }
  if (options.order) {
    const [col, dir] = options.order.split(' ');
    q = q.order(col, { ascending: dir?.toLowerCase() !== 'desc' });
  }
  if (options.limit) q = q.limit(options.limit);

  const { data, error } = await q;
  if (error) throw new Error(`Select ${table}: ${error.message}`);
  return (data ?? []) as T[];
}
