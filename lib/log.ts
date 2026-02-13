import type { VercelRequest, VercelResponse } from '@vercel/node';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

export function withLogging(handler: Handler): Handler {
  return async (req, res) => {
    const start = Date.now();
    console.log(`--> ${req.method} ${req.url}`);
    try {
      await handler(req, res);
    } finally {
      console.log(`<-- ${req.method} ${req.url} ${res.statusCode} ${Date.now() - start}ms`);
    }
  };
}
