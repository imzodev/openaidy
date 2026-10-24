-- ============================================================
-- Migration: 0018_workflow_runs
-- Description: Workflow run records and the `skipped` subtask status.
--              Every execution of a task's subtask graph (Run button,
--              agent tool or schedule) gets a workflow_runs row that is
--              finished once every step is terminal. `skipped` marks a
--              step whose branch was not taken or whose upstream failed.
-- ============================================================

ALTER TYPE subtask_status ADD VALUE IF NOT EXISTS 'skipped';

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'running',
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  -- No FK: task_execution_history is not created on every Postgres install.
  history_id TEXT,
  error TEXT,
  summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS workflow_runs_task_id_idx
  ON workflow_runs (task_id, started_at);
CREATE INDEX IF NOT EXISTS workflow_runs_status_idx
  ON workflow_runs (status);
