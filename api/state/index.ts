import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAuth } from '../../lib/auth';
import { getSupabase } from '../../lib/supabase';
import { DbEvent, fromDbEvent } from '../../lib/events';

/**
 * GET /api/state - Projects all events into a materialized item array.
 * Used by tests as a replacement for GET /api/items.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('seq', { ascending: true });

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
        createdAt: event.timestamp,
        important: val.important || false,
        completed: false,
        archived: val.archived || false,
        position: val.position || 'n',
        type: val.type || 'todo',
        level: val.level || null,
        indented: val.indented || false,
        textUpdatedAt: event.timestamp,
        importantUpdatedAt: event.timestamp,
        completedUpdatedAt: event.timestamp,
        positionUpdatedAt: event.timestamp,
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
          break;
        case 'level':
          item.level = event.value;
          break;
        case 'indented':
          item.indented = event.value;
          break;
        case 'archived':
          item.archived = event.value;
          if (event.value) {
            item.archivedAt = event.timestamp;
          } else {
            item.archivedAt = null;
          }
          break;
      }
    } else if (event.type === 'item_deleted') {
      items.delete(event.itemId);
    }
  }

  const result = Array.from(items.values());
  result.sort((a: any, b: any) => (a.position || 'n').localeCompare(b.position || 'n'));

  return res.status(200).json(result);
}
