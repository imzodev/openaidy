-- ============================================================
-- Migration: 0016_workflow_conditions_loops_approval
-- Description: Foundation for a visual workflow builder on top of
--              the subtask dependency graph (0015_subtask_edges):
--              conditional edges, bounded single-subtask loops, and
--              human-approval gate subtasks. All additive/nullable —
--              the subtask_status enum is intentionally untouched.
-- ============================================================

ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS subtask_kind TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS loop_max_iterations INTEGER;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS loop_condition_operator TEXT;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS loop_condition_value TEXT;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS loop_iteration_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS loop_last_result TEXT;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS awaiting_approval_since TIMESTAMPTZ;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS approval_decision TEXT;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS approval_note TEXT;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS approved_by TEXT;

CREATE INDEX IF NOT EXISTS subtasks_awaiting_approval_idx
  ON subtasks (awaiting_approval_since)
  WHERE awaiting_approval_since IS NOT NULL;

ALTER TABLE subtask_edges ADD COLUMN IF NOT EXISTS condition_operator TEXT;
ALTER TABLE subtask_edges ADD COLUMN IF NOT EXISTS condition_value TEXT;

DO $$ BEGIN
  ALTER TABLE subtask_edges
    ADD CONSTRAINT subtask_edges_kind_check
    CHECK (edge_kind IN ('dependency', 'conditional'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE subtask_edges
    ADD CONSTRAINT subtask_edges_condition_required_check
    CHECK (edge_kind <> 'conditional' OR (condition_operator IS NOT NULL AND condition_value IS NOT NULL));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
