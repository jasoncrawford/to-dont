import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withLogging } from '../../lib/log';

export default withLogging(async function handler(req: VercelRequest, res: VercelResponse) {
  // Check which env vars are set (without revealing values)
  const envStatus = {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
    SYNC_BEARER_TOKEN: !!process.env.SYNC_BEARER_TOKEN,
    // Show partial URL to help debug
    SUPABASE_URL_PREFIX: process.env.SUPABASE_URL?.substring(0, 30) || 'NOT SET',
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };

  return res.status(200).json(envStatus);
});
