import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAuth } from '../../lib/auth';
import { supabase, DbItem } from '../../lib/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!validateAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing item id' });
  }

  if (req.method === 'PATCH') {
    return handlePatch(req, res, id);
  } else if (req.method === 'DELETE') {
    return handleDelete(req, res, id);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handlePatch(req: VercelRequest, res: VercelResponse, id: string) {
  const updates = req.body as Partial<DbItem>;

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = {};
  if (updates.parent_id !== undefined) updateData.parent_id = updates.parent_id;
  if (updates.type !== undefined) updateData.type = updates.type;
  if (updates.text !== undefined) updateData.text = updates.text;
  if (updates.important !== undefined) updateData.important = updates.important;
  if (updates.completed_at !== undefined) updateData.completed_at = updates.completed_at;
  if (updates.position !== undefined) updateData.position = updates.position;
  if (updates.level !== undefined) updateData.level = updates.level;
  if (updates.indented !== undefined) updateData.indented = updates.indented;
  if (updates.text_updated_at !== undefined) updateData.text_updated_at = updates.text_updated_at;
  if (updates.important_updated_at !== undefined) updateData.important_updated_at = updates.important_updated_at;
  if (updates.completed_updated_at !== undefined) updateData.completed_updated_at = updates.completed_updated_at;
  if (updates.position_updated_at !== undefined) updateData.position_updated_at = updates.position_updated_at;
  if (updates.type_updated_at !== undefined) updateData.type_updated_at = updates.type_updated_at;
  if (updates.level_updated_at !== undefined) updateData.level_updated_at = updates.level_updated_at;
  if (updates.indented_updated_at !== undefined) updateData.indented_updated_at = updates.indented_updated_at;

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const { data, error } = await supabase
    .from('items')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating item:', error);
    return res.status(500).json({ error: 'Failed to update item' });
  }

  if (!data) {
    return res.status(404).json({ error: 'Item not found' });
  }

  return res.status(200).json(data);
}

async function handleDelete(_req: VercelRequest, res: VercelResponse, id: string) {
  const { error } = await supabase
    .from('items')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting item:', error);
    return res.status(500).json({ error: 'Failed to delete item' });
  }

  return res.status(204).end();
}
