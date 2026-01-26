-- Run this in your Supabase SQL Editor (supabase.com > your project > SQL Editor)

-- Create the items table
CREATE TABLE items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id    UUID REFERENCES items(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'todo',
  text         TEXT NOT NULL DEFAULT '',
  important    BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  level        INTEGER CHECK (level IS NULL OR level IN (1, 2))
);

-- Indexes for performance
CREATE INDEX idx_items_parent_sort ON items(parent_id, sort_order);
CREATE INDEX idx_items_updated ON items(updated_at);

-- Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Enable Realtime for cross-device sync
ALTER PUBLICATION supabase_realtime ADD TABLE items;
