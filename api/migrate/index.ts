import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

interface LocalStorageItem {
  id: string;
  text: string;
  createdAt: number;
  important?: boolean;
  completed?: boolean;
  completedAt?: number;
  archived?: boolean;
  archivedAt?: number;
  indented?: boolean;
  type?: 'section';
  level?: number;
}

interface MigrationRequest {
  items: LocalStorageItem[];
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { items } = req.body as MigrationRequest;

  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Missing or invalid items array' });
  }

  try {
    // Convert localStorage format to database format
    const idMapping: Record<string, string> = {};
    const dbItems: Array<{
      id: string;
      parent_id: string | null;
      type: string;
      text: string;
      important: boolean;
      completed_at: string | null;
      created_at: string;
      sort_order: number;
      level: number | null;
    }> = [];

    // First pass: generate UUIDs for all items
    items.forEach(item => {
      idMapping[item.id] = generateUUID();
    });

    // Second pass: determine parent relationships (sections become parents)
    let currentSectionId: string | null = null;

    items.forEach((item, index) => {
      if (item.type === 'section') {
        currentSectionId = idMapping[item.id];
      }

      // Skip archived items (they get deleted in new model)
      if (item.archived) {
        return;
      }

      const dbItem = {
        id: idMapping[item.id],
        parent_id: item.type !== 'section' && item.indented && currentSectionId
          ? currentSectionId
          : null,
        type: item.type || 'todo',
        text: item.text || '',
        important: item.important || false,
        completed_at: item.completedAt
          ? new Date(item.completedAt).toISOString()
          : null,
        created_at: new Date(item.createdAt).toISOString(),
        sort_order: index,
        level: item.level || null,
      };

      // For sections, reset parent tracking
      if (item.type === 'section') {
        currentSectionId = dbItem.id;
      }

      dbItems.push(dbItem);
    });

    // Clear existing items and insert migrated ones
    const { error: deleteError } = await supabase
      .from('items')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (deleteError) {
      console.error('Error clearing items:', deleteError);
      return res.status(500).json({ error: 'Failed to clear existing items' });
    }

    if (dbItems.length > 0) {
      const { error: insertError } = await supabase
        .from('items')
        .insert(dbItems);

      if (insertError) {
        console.error('Error inserting migrated items:', insertError);
        return res.status(500).json({ error: 'Failed to insert migrated items' });
      }
    }

    return res.status(200).json({
      success: true,
      idMapping,
      itemCount: dbItems.length,
    });
  } catch (err) {
    console.error('Migration error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
