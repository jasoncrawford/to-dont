// Shared Supabase client for browser use (auth + sync).
// Singleton created from window.SYNC_* globals set by compat.ts.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient<any, any, any> | null = null;

export function getSupabaseClient(): SupabaseClient<any, any, any> | null {
  if (_client) return _client;

  const url = window.SYNC_SUPABASE_URL;
  const anonKey = window.SYNC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const schema = window.SYNC_SUPABASE_SCHEMA || 'public';
  _client = createClient(url, anonKey, { db: { schema } });
  return _client;
}

/**
 * Get the current user's JWT access token, or null if not authenticated.
 */
export async function getAccessToken(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data: { session } } = await client.auth.getSession();
  return session?.access_token ?? null;
}
