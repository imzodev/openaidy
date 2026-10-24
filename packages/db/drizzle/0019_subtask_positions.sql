-- ============================================================
-- Migration: 0019_subtask_positions
-- Description: Remember where each workflow node sits on the canvas, so
--              the layout follows the workflow across browsers and
--              devices instead of living in one browser's localStorage.
--              NULL means "place it with the auto-layout".
-- ============================================================

ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS position_x integer;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS position_y integer;
