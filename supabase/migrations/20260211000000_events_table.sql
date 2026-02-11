-- Create the events table for event sourcing
-- Events are the source of truth; item state is derived by projecting events

CREATE TABLE events (
  id         UUID PRIMARY KEY,
  item_id    UUID NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('item_created', 'field_changed', 'item_deleted')),
  field      TEXT,
  value      JSONB,
  timestamp  BIGINT NOT NULL,
  client_id  TEXT NOT NULL,
  seq        BIGSERIAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index on seq for cursor-based sync (GET /api/events?since=N)
CREATE INDEX idx_events_seq ON events(seq);

-- Index on item_id for projecting state per item
CREATE INDEX idx_events_item_id ON events(item_id);

-- Enable Realtime for cross-device sync
ALTER PUBLICATION supabase_realtime ADD TABLE events;
