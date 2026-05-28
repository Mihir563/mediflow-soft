'use client';

/**
 * MediFlow Cloud DB Layer
 * 
 * Wraps Supabase to expose the same interface as the local SQLite db,
 * filtered by the active store. All pages call getDB() which returns
 * either this cloud adapter OR the local Tauri SQLite — whichever is
 * available.
 */

import { supabase } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CloudDBAdapter {
  storeId: string;
  select: <T = any>(query: string, params?: any[]) => Promise<T[]>;
  execute: (query: string, params?: any[]) => Promise<{ rowsAffected: number; lastInsertId?: any }>;
  selectFrom: <T = any>(table: string, options?: SelectOptions) => Promise<T[]>;
  insertInto: (table: string, data: Record<string, any>) => Promise<{ id: string }>;
  updateTable: (table: string, data: Record<string, any>, where: Record<string, any>) => Promise<void>;
  deleteFrom: (table: string, where: Record<string, any>) => Promise<void>;
}

interface SelectOptions {
  select?: string;
  where?: Record<string, any>;
  orderBy?: string;
  limit?: number;
  offset?: number;
}

// ─── Cloud DB Adapter ────────────────────────────────────────────────────────

function createCloudAdapter(storeId: string): CloudDBAdapter {
  return {
    storeId,

    // Generic select — parses simple SQL-like queries for backward compat
    // For cloud, pages should prefer selectFrom()
    async select<T>(query: string, params: any[] = []): Promise<T[]> {
      console.warn('[CloudDB] Raw SQL not supported in cloud mode. Use selectFrom().');
      return [];
    },

    async execute(query: string, params: any[] = []) {
      console.warn('[CloudDB] Raw SQL execute not supported in cloud mode.');
      return { rowsAffected: 0 };
    },

    async selectFrom<T>(table: string, options: SelectOptions = {}): Promise<T[]> {
      let q = supabase.from(table).select(options.select || '*');

      // Always scope to this store
      if (['items', 'parties', 'transactions', 'party_special_rates', 'order_book'].includes(table)) {
        q = q.eq('store_id', storeId);
      }

      if (options.where) {
        for (const [col, val] of Object.entries(options.where)) {
          q = q.eq(col, val);
        }
      }
      if (options.orderBy) {
        const [col, dir] = options.orderBy.split(' ');
        q = q.order(col, { ascending: dir?.toLowerCase() !== 'desc' });
      }
      if (options.limit) q = q.limit(options.limit);
      if (options.offset) q = q.range(options.offset, options.offset + (options.limit ?? 100) - 1);

      const { data, error } = await q;
      if (error) throw new Error(`[CloudDB] selectFrom(${table}): ${error.message}`);
      return (data ?? []) as T[];
    },

    async insertInto(table: string, data: Record<string, any>) {
      const payload = ['items', 'parties', 'transactions', 'party_special_rates', 'order_book'].includes(table)
        ? { ...data, store_id: storeId }
        : data;

      const { data: result, error } = await supabase
        .from(table)
        .insert(payload)
        .select('id')
        .single();

      if (error) throw new Error(`[CloudDB] insertInto(${table}): ${error.message}`);
      return { id: result?.id };
    },

    async updateTable(table: string, data: Record<string, any>, where: Record<string, any>) {
      let q = supabase.from(table).update(data);
      for (const [col, val] of Object.entries(where)) {
        q = q.eq(col, val);
      }
      const { error } = await q;
      if (error) throw new Error(`[CloudDB] updateTable(${table}): ${error.message}`);
    },

    async deleteFrom(table: string, where: Record<string, any>) {
      let q = supabase.from(table).delete();
      for (const [col, val] of Object.entries(where)) {
        q = q.eq(col, val);
      }
      const { error } = await q;
      if (error) throw new Error(`[CloudDB] deleteFrom(${table}): ${error.message}`);
    },
  };
}

// ─── Singleton per store ──────────────────────────────────────────────────────

let cloudAdapterInstance: CloudDBAdapter | null = null;

export function initCloudDB(storeId: string): CloudDBAdapter {
  if (cloudAdapterInstance?.storeId === storeId) return cloudAdapterInstance;
  cloudAdapterInstance = createCloudAdapter(storeId);
  return cloudAdapterInstance;
}

export function getCloudDB(): CloudDBAdapter | null {
  return cloudAdapterInstance;
}

export function clearCloudDB() {
  cloudAdapterInstance = null;
}
