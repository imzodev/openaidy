-- ============================================================
-- Migration: 0015_subtask_edges
-- Description: Model subtask dependencies as a graph of edges
--              instead of a single parent_subtask_id column, so a
--              subtask can depend on multiple upstream subtasks
--              (fan-in). Backfills existing single-parent chains
--              into edges before dropping the old column.
-- ============================================================

CREATE TABLE IF NOT EXISTS subtask_edges (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  subtask_id            TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  depends_on_subtask_id TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  edge_kind             TEXT NOT NULL DEFAULT 'dependency',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subtask_edges_no_self_edge CHECK (subtask_id <> depends_on_subtask_id)
);

CREATE INDEX IF NOT EXISTS subtask_edges_subtask_id_idx ON subtask_edges(subtask_id);
CREATE UNIQUE INDEX IF NOT EXISTS subtask_edges_unique_idx ON subtask_edges(subtask_id, depends_on_subtask_id);

INSERT INTO subtask_edges (subtask_id, depends_on_subtask_id, edge_kind)
SELECT id, parent_subtask_id, 'dependency'
FROM subtasks
WHERE parent_subtask_id IS NOT NULL AND parent_subtask_id <> id
ON CONFLICT DO NOTHING;

ALTER TABLE subtasks DROP COLUMN IF EXISTS parent_subtask_id;
