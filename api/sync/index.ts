import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAuth } from '../../lib/auth';
import { supabase, DbItem } from '../../lib/supabase';

interface SyncRequest {
  items: DbItem[];
  since?: string; // ISO timestamp for incremental sync
}

/**
 * Merge a client item with a server item using per-field LWW.
 * Returns the merged item where each field is taken from whichever
 * version has the newer timestamp for that field.
 */
function mergeItems(client: DbItem, server: DbItem): DbItem {
  const clientTextTime = new Date(client.text_updated_at).getTime();
  const serverTextTime = new Date(server.text_updated_at).getTime();

  const clientImportantTime = new Date(client.important_updated_at).getTime();
  const serverImportantTime = new Date(server.important_updated_at).getTime();

  const clientCompletedTime = new Date(client.completed_updated_at).getTime();
  const serverCompletedTime = new Date(server.completed_updated_at).getTime();

  const clientPositionTime = new Date(client.position_updated_at).getTime();
  const serverPositionTime = new Date(server.position_updated_at).getTime();

  return {
    id: client.id,
    parent_id: client.parent_id,
    type: client.type,
    created_at: server.created_at, // Keep server's created_at
    updated_at: new Date().toISOString(), // Server sets this
    level: client.level,
    indented: client.indented, // Take client's indentation state

    // Per-field LWW merge
    text: clientTextTime >= serverTextTime ? client.text : server.text,
    text_updated_at: clientTextTime >= serverTextTime
      ? client.text_updated_at : server.text_updated_at,

    important: clientImportantTime >= serverImportantTime
      ? client.important : server.important,
    important_updated_at: clientImportantTime >= serverImportantTime
      ? client.important_updated_at : server.important_updated_at,

    completed_at: clientCompletedTime >= serverCompletedTime
      ? client.completed_at : server.completed_at,
    completed_updated_at: clientCompletedTime >= serverCompletedTime
      ? client.completed_updated_at : server.completed_updated_at,

    position: clientPositionTime >= serverPositionTime
      ? client.position : server.position,
    position_updated_at: clientPositionTime >= serverPositionTime
      ? client.position_updated_at : server.position_updated_at,
  };
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
    const mergedItems: DbItem[] = [];

    if (items.length > 0) {
      // Fetch existing items to merge with
      const itemIds = items.map(i => i.id);
      const { data: existingItems, error: fetchError } = await supabase
        .from('items')
        .select('*')
        .in('id', itemIds);

      if (fetchError) {
        console.error('Error fetching existing items:', fetchError);
        return res.status(500).json({ error: 'Failed to fetch existing items' });
      }

      const existingMap = new Map<string, DbItem>();
      (existingItems || []).forEach(item => existingMap.set(item.id, item));

      // Merge each incoming item with existing server state
      const now = new Date().toISOString();
      for (const clientItem of items) {
        const serverItem = existingMap.get(clientItem.id);

        let itemToSave: DbItem;
        if (serverItem) {
          // Merge with existing item
          itemToSave = mergeItems(clientItem, serverItem);
        } else {
          // New item - use client values
          itemToSave = {
            id: clientItem.id,
            parent_id: clientItem.parent_id || null,
            type: clientItem.type || 'todo',
            text: clientItem.text || '',
            important: clientItem.important || false,
            completed_at: clientItem.completed_at || null,
            created_at: clientItem.created_at || now,
            updated_at: now,
            level: clientItem.level || null,
            position: clientItem.position || 'n',
            text_updated_at: clientItem.text_updated_at || now,
            important_updated_at: clientItem.important_updated_at || now,
            completed_updated_at: clientItem.completed_updated_at || now,
            position_updated_at: clientItem.position_updated_at || now,
          };
        }

        mergedItems.push(itemToSave);
      }

      // Upsert merged items
      const { error: upsertError } = await supabase
        .from('items')
        .upsert(mergedItems, { onConflict: 'id' });

      if (upsertError) {
        console.error('Error upserting items:', upsertError);
        return res.status(500).json({ error: 'Failed to sync items' });
      }
    }

    // Fetch all items (or just updated ones if since is provided)
    let query = supabase
      .from('items')
      .select('*')
      .order('position', { ascending: true });

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
      mergedItems, // Return what we merged so client knows the result
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
