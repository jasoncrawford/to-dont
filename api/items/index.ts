import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAuth } from '../../lib/auth';
import { supabase, DbItem } from '../../lib/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'POST') {
    return handlePost(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleGet(_req: VercelRequest, res: VercelResponse) {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('Error fetching items:', error);
    return res.status(500).json({ error: 'Failed to fetch items' });
  }

  return res.status(200).json(data);
}

async function handlePost(req: VercelRequest, res: VercelResponse) {
  const item = req.body as Partial<DbItem>;

  if (!item.id) {
    return res.status(400).json({ error: 'Missing required field: id' });
  }

  const { data, error } = await supabase
    .from('items')
    .upsert({
      id: item.id,
      parent_id: item.parent_id || null,
      type: item.type || 'todo',
      text: item.text || '',
      important: item.important || false,
      completed_at: item.completed_at || null,
      created_at: item.created_at || new Date().toISOString(),
      sort_order: item.sort_order || 0,
      level: item.level || null,
    }, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('Error creating item:', error);
    return res.status(500).json({ error: 'Failed to create item' });
  }

  return res.status(201).json(data);
}
