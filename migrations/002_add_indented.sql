-- Migration: Add indented boolean column
-- This stores the indentation state directly instead of relying on parent_id

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS indented BOOLEAN NOT NULL DEFAULT false;

-- Backfill: Set indented = true for any items that have a parent_id
UPDATE items SET indented = true WHERE parent_id IS NOT NULL;
