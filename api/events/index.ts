import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthResult } from '../../lib/auth';
import { getSupabase } from '../../lib/supabase';
import { EventPayload, DbEvent, toDbEvent, fromDbEvent } from '../../lib/events';
import { withLogging } from '../../lib/log';

export default withLogging(async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await getAuthResult(req);
  if (!auth.authenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'POST') {
    return handlePost(req, res, auth.userId);
  } else if (req.method === 'GET') {
    return handleGet(req, res, auth.userId);
  } else if (req.method === 'DELETE') {
    // DELETE is admin-only (bearer token)
    if (auth.userId !== null) {
      // JWT user, not bearer token — deny
      return res.status(403).json({ error: 'Forbidden' });
    }
    return handleDelete(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
});

async function handlePost(req: VercelRequest, res: VercelResponse, userId: string | null) {
  const { events, userId: bodyUserId } = req.body as { events: EventPayload[]; userId?: string };

  if (!events || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'Missing or empty events array' });
  }

  const supabase = getSupabase();
  const dbEvents = events.map(e => {
    const dbEvent = toDbEvent(e);
    // JWT users: inject their user_id. Bearer-token callers can pass userId in body (for tests).
    const effectiveUserId = userId ?? bodyUserId ?? null;
    return { ...dbEvent, user_id: effectiveUserId };
  });

  // Insert with ON CONFLICT DO NOTHING for idempotency
  const { error } = await supabase
    .from('events')
    .upsert(dbEvents, { onConflict: 'id', ignoreDuplicates: true });

  if (error) {
    console.error('Error inserting events:', error);
    return res.status(500).json({ error: 'Failed to insert events' });
  }

  // Return the inserted events with their server-assigned seq numbers
  // Re-fetch to get seq values (upsert with ignoreDuplicates may not return all)
  const eventIds = events.map(e => e.id);
  let query = supabase
    .from('events')
    .select('*')
    .in('id', eventIds)
    .order('seq', { ascending: true });

  const { data: inserted, error: fetchError } = await query;

  if (fetchError) {
    console.error('Error fetching inserted events:', fetchError);
    return res.status(500).json({ error: 'Failed to fetch inserted events' });
  }

  const result = (inserted || []).map((e: DbEvent) => fromDbEvent(e));
  return res.status(200).json({ events: result });
}

async function handleDelete(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('events')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (error) {
    console.error('Error deleting events:', error);
    return res.status(500).json({ error: 'Failed to delete events' });
  }

  return res.status(204).end();
}

async function handleGet(req: VercelRequest, res: VercelResponse, userId: string | null) {
  const since = parseInt(req.query.since as string) || 0;
  const limit = Math.min(parseInt(req.query.limit as string) || 500, 1000);

  const supabase = getSupabase();

  let query = supabase
    .from('events')
    .select('*')
    .gt('seq', since)
    .order('seq', { ascending: true })
    .limit(limit);

  // JWT users: filter to their own events
  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching events:', error);
    return res.status(500).json({ error: 'Failed to fetch events' });
  }

  const result = (data || []).map((e: DbEvent) => fromDbEvent(e));
  return res.status(200).json({ events: result });
}
