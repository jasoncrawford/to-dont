-- Migration 004: Drop items table (superseded by events table)
-- Run this AFTER all clients have been updated to use event-based sync
-- and the events table has been fully populated.

-- Safety: rename instead of drop, so we can recover if needed
ALTER TABLE IF EXISTS items RENAME TO items_deprecated;
