import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAuth } from '../../lib/auth';
import { getSupabase } from '../../lib/supabase';
import { EventPayload, DbEvent, toDbEvent, fromDbEvent } from '../../lib/events';
import { withLogging } from '../../lib/log';

export default withLogging(async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'POST') {
    return handlePost(req, res);
  } else if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'DELETE') {
    return handleDelete(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
});

async function handlePost(req: VercelRequest, res: VercelResponse) {
  const { events } = req.body as { events: EventPayload[] };

  if (!events || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'Missing or empty events array' });
  }

  const supabase = getSupabase();
  const dbEvents = events.map(toDbEvent);

  // Insert with ON CONFLICT DO NOTHING for idempotency
  const { data, error } = await supabase
    .from('events')
    .upsert(dbEvents, { onConflict: 'id', ignoreDuplicates: true })
    .select();

  if (error) {
    console.error('Error inserting events:', error);
    return res.status(500).json({ error: 'Failed to insert events' });
  }

  // Return the inserted events with their server-assigned seq numbers
  // Re-fetch to get seq values (upsert with ignoreDuplicates may not return all)
  const eventIds = events.map(e => e.id);
  const { data: inserted, error: fetchError } = await supabase
    .from('events')
    .select('*')
    .in('id', eventIds)
    .order('seq', { ascending: true });

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

async function handleGet(req: VercelRequest, res: VercelResponse) {
  const since = parseInt(req.query.since as string) || 0;
  const limit = Math.min(parseInt(req.query.limit as string) || 500, 1000);

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .gt('seq', since)
    .order('seq', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('Error fetching events:', error);
    return res.status(500).json({ error: 'Failed to fetch events' });
  }

  const result = (data || []).map((e: DbEvent) => fromDbEvent(e));
  return res.status(200).json({ events: result });
}
