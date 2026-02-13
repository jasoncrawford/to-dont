import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url) {
    console.error('ENV VARS:', Object.keys(process.env).filter(k => k.includes('SUPA') || k.includes('VERCEL')));
    throw new Error('Missing SUPABASE_URL environment variable');
  }
  if (!key) {
    throw new Error('Missing SUPABASE_SERVICE_KEY environment variable');
  }

  _supabase = createClient(url, key);
  return _supabase;
}

// For backwards compatibility
export const supabase = {
  from: (table: string) => getSupabase().from(table),
};

export interface DbItem {
  id: string;
  parent_id: string | null;
  type: string;
  text: string;
  important: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  level: number | null;
  indented: boolean;
  // CRDT fields
  position: string;
  text_updated_at: string;
  important_updated_at: string;
  completed_updated_at: string;
  position_updated_at: string;
  type_updated_at: string;
  level_updated_at: string;
  indented_updated_at: string;
}
