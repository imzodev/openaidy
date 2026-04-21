-- ============================================================
-- Migration: 0002_addons
-- Description: Addon system database schema
-- ============================================================

-- ------------------------------------------------------------
-- Addons table
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS addons (
  id           TEXT PRIMARY KEY,
  addon_id     TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  version      TEXT NOT NULL,
  manifest     JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'installed',
  permissions  JSONB NOT NULL DEFAULT '[]',
  config       JSONB NOT NULL DEFAULT '{}',
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  installed_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS addons_status_idx ON addons(status);
CREATE INDEX IF NOT EXISTS addons_addon_id_idx ON addons(addon_id);

-- ------------------------------------------------------------
-- Addon permission changes table
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS addon_permission_changes (
  id                TEXT PRIMARY KEY,
  addon_id          TEXT NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
  changed_by        TEXT NOT NULL,
  old_permissions   JSONB,
  new_permissions   JSONB,
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS addon_permission_changes_addon_id_idx ON addon_permission_changes(addon_id);
CREATE INDEX IF NOT EXISTS addon_permission_changes_created_at_idx ON addon_permission_changes(created_at);

-- ------------------------------------------------------------
-- Addon usage table
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS addon_usage (
  id              TEXT PRIMARY KEY,
  addon_id        TEXT NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
  endpoint        TEXT NOT NULL,
  request_count   INTEGER NOT NULL DEFAULT 0,
  last_used       TIMESTAMPTZ,
  date            TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS addon_usage_addon_endpoint_date_idx ON addon_usage(addon_id, endpoint, date);
CREATE INDEX IF NOT EXISTS addon_usage_addon_id_idx ON addon_usage(addon_id);
CREATE INDEX IF NOT EXISTS addon_usage_date_idx ON addon_usage(date);

-- ------------------------------------------------------------
-- Rollback
-- ------------------------------------------------------------

-- To rollback this migration, run:
-- DROP INDEX IF EXISTS addon_usage_date_idx;
-- DROP INDEX IF EXISTS addon_usage_addon_id_idx;
-- DROP INDEX IF EXISTS addon_usage_addon_endpoint_date_idx;
-- DROP TABLE IF EXISTS addon_usage;
-- DROP INDEX IF EXISTS addon_permission_changes_created_at_idx;
-- DROP INDEX IF EXISTS addon_permission_changes_addon_id_idx;
-- DROP TABLE IF EXISTS addon_permission_changes;
-- DROP INDEX IF EXISTS addons_addon_id_idx;
-- DROP INDEX IF EXISTS addons_status_idx;
-- DROP TABLE IF EXISTS addons;