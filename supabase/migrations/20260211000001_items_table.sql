-- Create the items table for legacy sync/items endpoints
-- Used by /api/items and /api/sync for CRDT-based per-field LWW merge

CREATE TABLE items (
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
