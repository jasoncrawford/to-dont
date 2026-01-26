import type { VercelRequest } from '@vercel/node';

export function validateAuth(req: VercelRequest): boolean {
  const auth = req.headers.authorization;
  if (!auth) return false;
  return auth === `Bearer ${process.env.SYNC_BEARER_TOKEN}`;
}

export function unauthorizedResponse() {
  return {
    statusCode: 401,
    body: JSON.stringify({ error: 'Unauthorized' }),
  };
}
