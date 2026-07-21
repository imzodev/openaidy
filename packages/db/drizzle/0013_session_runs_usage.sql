-- ============================================================
-- Migration: 0013_session_runs_usage
-- Description: Add prompt-cache token counts and estimated cost
--              to session_runs for usage tracking and cost
--              estimation. All nullable — populated at run
--              completion when the provider reports them.
-- ============================================================

ALTER TABLE session_runs ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER;
ALTER TABLE session_runs ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER;
ALTER TABLE session_runs ADD COLUMN IF NOT EXISTS cost DOUBLE PRECISION;

-- Indexes to support usage aggregation queries by time and dimension.
CREATE INDEX IF NOT EXISTS session_runs_provider_model_idx ON session_runs(provider_id, model_id);
