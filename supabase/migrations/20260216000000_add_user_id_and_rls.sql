-- Add user_id column and Row-Level Security to events tables.
-- user_id is nullable initially — existing events have none (backfilled later).

-- Public schema
ALTER TABLE events ADD COLUMN user_id UUID;
CREATE INDEX idx_events_user_id ON events(user_id);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own events
CREATE POLICY events_select_own ON events
  FOR SELECT
  USING (auth.uid() = user_id);

-- Authenticated users can insert events with their own user_id
CREATE POLICY events_insert_own ON events
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Test schema
ALTER TABLE test.events ADD COLUMN user_id UUID;
CREATE INDEX idx_test_events_user_id ON test.events(user_id);

ALTER TABLE test.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY events_select_own ON test.events
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY events_insert_own ON test.events
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
