import type { VercelRequest } from '@vercel/node';
import { getSupabase } from './supabase';

export interface AuthResult {
  authenticated: boolean;
  userId: string | null;
}

/**
 * Dual auth: checks bearer token first (admin/tests), then falls back to
 * Supabase JWT validation (browser users).
 */
export async function getAuthResult(req: VercelRequest): Promise<AuthResult> {
  const auth = req.headers.authorization;
  if (!auth) return { authenticated: false, userId: null };

  // Bearer token auth (admin/tests) — service_role key bypasses RLS
  if (auth === `Bearer ${process.env.SYNC_BEARER_TOKEN}`) {
    return { authenticated: true, userId: null };
  }

  // JWT auth (browser users)
  const token = auth.replace('Bearer ', '');
  try {
    const supabase = getSupabase();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { authenticated: false, userId: null };
    return { authenticated: true, userId: user.id };
  } catch {
    return { authenticated: false, userId: null };
  }
}
