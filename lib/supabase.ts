import { config } from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Load .env.local and .env files
config({ path: '.env.local' });
config({ path: '.env' });

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
  sort_order: number;
  level: number | null;
}
