-- ============================================================
-- Migration: 0006_recurring_tasks
-- Description: Add task_schedules and task_execution_history for the
--              recurring-tasks feature (Phase 1). See
--              docs/recurring-tasks/recurring-tasks-phase-1-schema-repository.md.
-- ============================================================

-- ------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------

CREATE TYPE task_schedule_status AS ENUM ('active', 'paused', 'expired');

CREATE TYPE task_schedule_replan_policy AS ENUM (
  'never',
  'on-description-change',
  'always'
);

CREATE TYPE task_execution_history_status AS ENUM (
  'planned',
  'planning',
  'executing',
  'verifying',
  'completed',
  'failed'
);

-- ------------------------------------------------------------
-- task_schedules
--
-- 1-to-1 with tasks. One row per recurring task. The schedule row
-- holds the cron/preset, the polling state, and the replan policy.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS task_schedules (
  id                TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  cron_expression   TEXT,
  preset            TEXT,
  schedule_date     TIMESTAMPTZ,
  next_run_at       TIMESTAMPTZ NOT NULL,
  last_run_at       TIMESTAMPTZ,
  status            task_schedule_status NOT NULL DEFAULT 'active',
  replan_policy     task_schedule_replan_policy NOT NULL DEFAULT 'never',
  max_executions    INTEGER NOT NULL DEFAULT 9999,  -- ALWAYS finite; default 9999
  execution_count   INTEGER NOT NULL DEFAULT 0,
  -- SHA-256 of the task's description. NULL until the first run completes.
  description_hash  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT task_schedules_max_executions_positive CHECK (max_executions > 0)
);

CREATE INDEX IF NOT EXISTS task_schedules_next_run_at_idx ON task_schedules(next_run_at);
CREATE INDEX IF NOT EXISTS task_schedules_status_idx ON task_schedules(status);
CREATE INDEX IF NOT EXISTS task_schedules_task_id_idx ON task_schedules(task_id);

-- ------------------------------------------------------------
-- task_execution_history
--
-- One row per run of a recurring task. Append-only. The executor
-- (Phase 2) writes a row at the start of each run and updates its
-- status as the run progresses.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS task_execution_history (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  schedule_id         TEXT NOT NULL REFERENCES task_schedules(id) ON DELETE CASCADE,
  status              task_execution_history_status NOT NULL DEFAULT 'planned',
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at         TIMESTAMPTZ,
  duration_ms         INTEGER,
  session_id          TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  -- Snapshot of the task at run time
  task_title          TEXT NOT NULL,
  task_description    TEXT NOT NULL,
  did_replan          BOOLEAN NOT NULL DEFAULT FALSE,
  error_code          TEXT,
  error_message       TEXT,
  attempt_number      INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_execution_history_task_id_idx ON task_execution_history(task_id);
CREATE INDEX IF NOT EXISTS task_execution_history_schedule_id_idx ON task_execution_history(schedule_id);
CREATE INDEX IF NOT EXISTS task_execution_history_session_id_idx ON task_execution_history(session_id);
CREATE INDEX IF NOT EXISTS task_execution_history_started_at_idx ON task_execution_history(started_at);
