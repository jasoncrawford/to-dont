import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAuth } from '../../lib/auth';
import { supabase, DbItem } from '../../lib/supabase';

interface SyncRequest {
  items: DbItem[];
  since?: string; // ISO timestamp for incremental sync
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { items, since } = req.body as SyncRequest;

  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Missing or invalid items array' });
  }

  try {
    // Upsert all items (last-write-wins strategy)
    if (items.length > 0) {
      const { error: upsertError } = await supabase
        .from('items')
        .upsert(
          items.map(item => ({
            id: item.id,
            parent_id: item.parent_id || null,
            type: item.type || 'todo',
            text: item.text || '',
            important: item.important || false,
            completed_at: item.completed_at || null,
            created_at: item.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
            sort_order: item.sort_order || 0,
            level: item.level || null,
          })),
          { onConflict: 'id' }
        );

      if (upsertError) {
        console.error('Error upserting items:', upsertError);
        return res.status(500).json({ error: 'Failed to sync items' });
      }
    }

    // Fetch all items (or just updated ones if since is provided)
    let query = supabase
      .from('items')
      .select('*')
      .order('sort_order', { ascending: true });

    if (since) {
      query = query.gt('updated_at', since);
    }

    const { data: serverItems, error: fetchError } = await query;

    if (fetchError) {
      console.error('Error fetching items:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch items after sync' });
    }

    return res.status(200).json({
      items: serverItems,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
