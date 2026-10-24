-- ============================================================
-- Migration: 0020_workflow_triggers
-- Description: Start workflows from outside: a webhook URL or a matching
--              channel message. Runs remember what started them (input)
--              and, for channel messages, which chat to reply to.
-- ============================================================

ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS input text;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS reply_target text;

CREATE TABLE IF NOT EXISTS workflow_triggers (
  id text PRIMARY KEY NOT NULL,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  config text NOT NULL DEFAULT '{}',
  secret_hash text,
  last_fired_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_triggers_task_id_idx ON workflow_triggers(task_id);
CREATE INDEX IF NOT EXISTS workflow_triggers_kind_idx ON workflow_triggers(kind);
