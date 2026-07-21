-- ============================================================
-- Migration: 0011_subtask_summary
-- Description: Add subtask_summary column to task_execution_history.
--              Stores a JSON snapshot of subtask statuses when a
--              recurring run completes. Because subtasks are reset
--              between runs, without this snapshot historical runs
--              would have no subtask data.
-- ============================================================

ALTER TABLE task_execution_history ADD COLUMN IF NOT EXISTS subtask_summary TEXT;
