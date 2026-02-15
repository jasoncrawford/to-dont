-- Run this in your Supabase SQL Editor (supabase.com > your project > SQL Editor)

-- Events table for event sourcing
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

CREATE INDEX idx_events_seq ON events(seq);
CREATE INDEX idx_events_item_id ON events(item_id);

ALTER PUBLICATION supabase_realtime ADD TABLE events;
