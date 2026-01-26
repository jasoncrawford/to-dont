-- Migration: CRDT-inspired sync with fractional indexing and per-field timestamps
-- Run this in your Supabase SQL Editor

-- Step 1: Add new CRDT columns
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS position TEXT,
  ADD COLUMN IF NOT EXISTS text_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS important_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS position_updated_at TIMESTAMPTZ;

-- Step 2: Migrate existing data
-- Convert sort_order to fractional positions (spread across alphabet)
-- Items with sort_order 0 get 'c', 1 gets 'd', etc.
UPDATE items SET
  position = chr(99 + LEAST(sort_order, 20)), -- 99 = 'c', max at 'w'
  text_updated_at = COALESCE(updated_at, now()),
  important_updated_at = COALESCE(updated_at, now()),
  completed_updated_at = COALESCE(updated_at, now()),
  position_updated_at = COALESCE(updated_at, now())
WHERE position IS NULL;

-- Step 3: Set NOT NULL constraints after migration
ALTER TABLE items
  ALTER COLUMN position SET NOT NULL,
  ALTER COLUMN position SET DEFAULT 'n',
  ALTER COLUMN text_updated_at SET NOT NULL,
  ALTER COLUMN text_updated_at SET DEFAULT now(),
  ALTER COLUMN important_updated_at SET NOT NULL,
  ALTER COLUMN important_updated_at SET DEFAULT now(),
  ALTER COLUMN completed_updated_at SET NOT NULL,
  ALTER COLUMN completed_updated_at SET DEFAULT now(),
  ALTER COLUMN position_updated_at SET NOT NULL,
  ALTER COLUMN position_updated_at SET DEFAULT now();

-- Step 4: Create index for position-based ordering
CREATE INDEX IF NOT EXISTS idx_items_position ON items(position);

-- Step 5: Drop the old sort_order column
ALTER TABLE items DROP COLUMN IF EXISTS sort_order;

-- Step 6: Update the trigger to handle per-field timestamps
-- We'll let the client manage field-level timestamps, but keep updated_at for general tracking
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
