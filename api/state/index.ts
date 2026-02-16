import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthResult } from '../../lib/auth';
import { getSupabase } from '../../lib/supabase';
import { DbEvent, fromDbEvent } from '../../lib/events';
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

  let query = supabase
    .from('events')
    .select('*')
    .order('seq', { ascending: true });

  // JWT users: filter to their own events
  if (auth.userId) {
    query = query.eq('user_id', auth.userId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching events:', error);
    return res.status(500).json({ error: 'Failed to fetch events' });
  }

  // Project events into items (same logic as client-side projectState)
  const items = new Map<string, any>();

  for (const dbEvent of (data || []) as DbEvent[]) {
    const event = fromDbEvent(dbEvent);

    if (event.type === 'item_created') {
      const val = event.value || {};
      items.set(event.itemId, {
        id: event.itemId,
        text: val.text || '',
        createdAt: val.createdAt || event.timestamp,
        important: val.important || false,
        completed: val.completed || false,
        completedAt: val.completedAt || undefined,
        archived: val.archived || false,
        archivedAt: val.archivedAt || undefined,
        position: val.position || 'n',
        type: val.type || 'todo',
        level: val.level || null,
        indented: val.indented || false,
        textUpdatedAt: val.textUpdatedAt || event.timestamp,
        importantUpdatedAt: val.importantUpdatedAt || event.timestamp,
        completedUpdatedAt: val.completedUpdatedAt || event.timestamp,
        positionUpdatedAt: val.positionUpdatedAt || event.timestamp,
        typeUpdatedAt: val.typeUpdatedAt || event.timestamp,
        levelUpdatedAt: val.levelUpdatedAt || event.timestamp,
        indentedUpdatedAt: val.indentedUpdatedAt || event.timestamp,
        archivedUpdatedAt: val.archivedUpdatedAt || event.timestamp,
      });
    } else if (event.type === 'field_changed') {
      const item = items.get(event.itemId);
      if (!item) continue;

      const field = event.field;
      const tsKey = field + 'UpdatedAt';

      if (item[tsKey] !== undefined && event.timestamp < item[tsKey]) continue;

      switch (field) {
        case 'text':
          item.text = event.value;
          item.textUpdatedAt = event.timestamp;
          break;
        case 'important':
          item.important = event.value;
          item.importantUpdatedAt = event.timestamp;
          break;
        case 'completed':
          item.completed = event.value;
          if (event.value) {
            item.completedAt = event.timestamp;
          } else {
            delete item.completedAt;
          }
          item.completedUpdatedAt = event.timestamp;
          break;
        case 'position':
          item.position = event.value;
          item.positionUpdatedAt = event.timestamp;
          break;
        case 'type':
          item.type = event.value;
          item.typeUpdatedAt = event.timestamp;
          break;
        case 'level':
          item.level = event.value;
          item.levelUpdatedAt = event.timestamp;
          break;
        case 'indented':
          item.indented = event.value;
          item.indentedUpdatedAt = event.timestamp;
          break;
        case 'archived':
          item.archived = event.value;
          if (event.value) {
            item.archivedAt = event.timestamp;
          } else {
            item.archivedAt = null;
          }
          item.archivedUpdatedAt = event.timestamp;
          break;
      }
    } else if (event.type === 'item_deleted') {
      items.delete(event.itemId);
    }
  }

  const result = Array.from(items.values());
  result.sort((a: any, b: any) => (a.position || 'n').localeCompare(b.position || 'n') || a.id.localeCompare(b.id));

  return res.status(200).json(result);
});
