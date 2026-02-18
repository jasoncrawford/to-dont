import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthResult } from '../../lib/auth';
import { getSupabase } from '../../lib/supabase';
import { DbEvent, fromDbEvent } from '../../lib/events';
import { projectState } from '../../lib/project-state';
import { withLogging } from '../../lib/log';

/**
 * GET /api/state - Projects all events into a materialized item array.
 * Used by tests as a replacement for GET /api/items.
 */
export default withLogging(async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await getAuthResult(req);
  if (!auth.authenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();

  // Fetch all events with pagination (Supabase default limit is 1000)
  const PAGE_SIZE = 1000;
  const allEvents: DbEvent[] = [];
  let lastSeq = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from('events')
      .select('*')
      .gt('seq', lastSeq)
      .order('seq', { ascending: true })
      .limit(PAGE_SIZE);

    if (auth.userId) {
      query = query.eq('user_id', auth.userId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching events:', error);
      return res.status(500).json({ error: 'Failed to fetch events' });
    }

    const page = (data || []) as DbEvent[];
    allEvents.push(...page);

    if (page.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      lastSeq = page[page.length - 1].seq;
    }
  }

  // Convert DB events to camelCase and project into items
  const events = allEvents.map(fromDbEvent);
  const result = projectState(events);

  return res.status(200).json(result);
});
