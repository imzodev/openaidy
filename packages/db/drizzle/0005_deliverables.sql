-- ============================================================
-- Migration: 0005_deliverables
-- Description: Add deliverables table for task outputs
-- ============================================================

-- ------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------

CREATE TYPE deliverable_type AS ENUM ('document', 'image', 'code', 'report', 'data', 'link', 'other');
CREATE TYPE deliverable_status AS ENUM ('pending', 'delivered', 'verified');

-- ------------------------------------------------------------
-- Deliverables
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS deliverables (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type         deliverable_type NOT NULL,
  description  TEXT NOT NULL,
  status       deliverable_status NOT NULL DEFAULT 'pending',
  format       TEXT,
  size         TEXT,
  path         TEXT,
  url          TEXT,
  version      TEXT,
  metadata     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deliverables_task_id_idx ON deliverables(task_id);
CREATE INDEX IF NOT EXISTS deliverables_status_idx ON deliverables(status);