-- Create a separate 'test' schema so automated tests don't wipe dev data.
-- Dev uses the default 'public' schema; tests set SUPABASE_SCHEMA=test.

CREATE SCHEMA test;

-- Mirror the events table
CREATE TABLE test.events (
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

CREATE INDEX idx_test_events_seq ON test.events(seq);
CREATE INDEX idx_test_events_item_id ON test.events(item_id);

-- Mirror the items table
CREATE TABLE test.items (
  id                   UUID PRIMARY KEY,
  parent_id            UUID,
  type                 TEXT NOT NULL DEFAULT 'todo',
  text                 TEXT NOT NULL DEFAULT '',
  important            BOOLEAN NOT NULL DEFAULT false,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  level                INTEGER,
  indented             BOOLEAN NOT NULL DEFAULT false,
  position             TEXT NOT NULL DEFAULT 'n',
  text_updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  important_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  position_updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  type_updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  level_updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  indented_updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grant access to Supabase roles
GRANT USAGE ON SCHEMA test TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA test TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA test TO anon, authenticated, service_role;

-- Future objects inherit the same grants
ALTER DEFAULT PRIVILEGES IN SCHEMA test GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA test GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Enable Realtime for the test events table
ALTER PUBLICATION supabase_realtime ADD TABLE test.events;
