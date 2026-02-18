-- Enable Row-Level Security on items tables.
-- These tables are legacy (superseded by the events table) and unused by the app.
-- RLS with no policies means they are locked down to all PostgREST roles
-- (service_role still bypasses RLS if direct access is ever needed).

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE test.items ENABLE ROW LEVEL SECURITY;
