import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient<any, any, any> | null = null;

export function getSupabase(): SupabaseClient<any, any, any> {
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

  const schema = process.env.SUPABASE_SCHEMA || 'public';
  _supabase = createClient(url, key, { db: { schema } });
  return _supabase;
}
