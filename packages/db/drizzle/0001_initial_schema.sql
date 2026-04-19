-- ============================================================
-- Migration: 0001_initial_schema
-- Description: Full initial schema for all tables
-- ============================================================

-- ------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------

CREATE TYPE session_status AS ENUM ('active', 'archived', 'deleted');
CREATE TYPE message_role AS ENUM ('system', 'user', 'assistant', 'tool');
CREATE TYPE run_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
CREATE TYPE finish_reason AS ENUM ('stop', 'length', 'tool_calls', 'content_filter', 'error');

CREATE TYPE pairing_request_status AS ENUM ('pending', 'approved', 'denied', 'expired');
CREATE TYPE device_status AS ENUM ('approved', 'revoked', 'offline', 'online', 'stale');

CREATE TYPE job_type AS ENUM ('one-shot', 'cron');
CREATE TYPE job_status AS ENUM ('active', 'paused', 'completed', 'failed');
CREATE TYPE job_target_type AS ENUM ('session', 'isolated');
CREATE TYPE job_run_status AS ENUM ('queued', 'running', 'succeeded', 'failed');

CREATE TYPE task_status AS ENUM ('backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE planning_status AS ENUM ('pending', 'in_progress', 'completed', 'failed');
CREATE TYPE subtask_status AS ENUM ('pending', 'assigned', 'in_progress', 'completed', 'failed');
CREATE TYPE agent_role AS ENUM ('primary', 'secondary', 'reviewer');

-- ------------------------------------------------------------
-- Sessions
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  status       session_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS session_messages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role         message_role NOT NULL,
  content      TEXT NOT NULL,
  tool_call_id TEXT,
  sequence     INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata     JSONB
);

CREATE INDEX IF NOT EXISTS session_messages_session_id_idx ON session_messages(session_id);

CREATE TABLE IF NOT EXISTS session_runs (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id            TEXT NOT NULL,
  provider_id         TEXT NOT NULL,
  model_id            TEXT NOT NULL,
  status              run_status NOT NULL DEFAULT 'queued',
  finish_reason       finish_reason,
  error_code          TEXT,
  error_message       TEXT,
  prompt_tokens       INTEGER,
  completion_tokens   INTEGER,
  total_tokens        INTEGER,
  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata            JSONB
);

CREATE INDEX IF NOT EXISTS session_runs_session_id_idx ON session_runs(session_id);
CREATE INDEX IF NOT EXISTS session_runs_status_idx ON session_runs(status);

-- ------------------------------------------------------------
-- Pairing
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pairing_requests (
  id                      TEXT PRIMARY KEY,
  pairing_code            TEXT NOT NULL,
  device_name             TEXT NOT NULL,
  device_type             TEXT NOT NULL,
  requested_capabilities  JSONB NOT NULL,
  granted_scopes          JSONB,
  metadata                JSONB,
  status                  pairing_request_status NOT NULL DEFAULT 'pending',
  requested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at              TIMESTAMPTZ NOT NULL,
  approved_at             TIMESTAMPTZ,
  approved_by             TEXT,
  denied_at               TIMESTAMPTZ,
  denied_by               TEXT,
  node_id                 TEXT,
  token                   TEXT
);

CREATE INDEX IF NOT EXISTS pairing_requests_pairing_code_idx ON pairing_requests(pairing_code);
CREATE INDEX IF NOT EXISTS pairing_requests_status_idx ON pairing_requests(status);
CREATE INDEX IF NOT EXISTS pairing_requests_token_idx ON pairing_requests(token);

CREATE TABLE IF NOT EXISTS devices (
  node_id             TEXT PRIMARY KEY,
  pairing_request_id  TEXT REFERENCES pairing_requests(id) ON DELETE SET NULL,
  device_name         TEXT NOT NULL,
  device_type         TEXT NOT NULL,
  capabilities        JSONB NOT NULL,
  scopes              JSONB NOT NULL,
  metadata            JSONB,
  token               TEXT,
  token_hash          TEXT,
  status              device_status NOT NULL DEFAULT 'approved',
  last_seen           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS devices_pairing_request_id_idx ON devices(pairing_request_id);
CREATE INDEX IF NOT EXISTS devices_status_idx ON devices(status);
CREATE INDEX IF NOT EXISTS devices_token_idx ON devices(token);

-- ------------------------------------------------------------
-- Scheduled Jobs
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type              job_type NOT NULL,
  schedule          TIMESTAMPTZ,
  cron_expression   TEXT,
  target_type       job_target_type NOT NULL,
  target_session_id TEXT,
  payload           JSONB NOT NULL,
  status            job_status NOT NULL DEFAULT 'active',
  next_run_at       TIMESTAMPTZ NOT NULL,
  last_run_at       TIMESTAMPTZ,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  max_retries       INTEGER NOT NULL DEFAULT 3,
  backoff_ms        INTEGER NOT NULL DEFAULT 1000,
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scheduled_jobs_next_run_at_idx ON scheduled_jobs(next_run_at);
CREATE INDEX IF NOT EXISTS scheduled_jobs_status_idx ON scheduled_jobs(status);
CREATE INDEX IF NOT EXISTS scheduled_jobs_type_idx ON scheduled_jobs(type);

CREATE TABLE IF NOT EXISTS job_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  status          job_run_status NOT NULL DEFAULT 'queued',
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  error_code      TEXT,
  error_message   TEXT,
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  result_data     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_runs_job_id_idx ON job_runs(job_id);
CREATE INDEX IF NOT EXISTS job_runs_status_idx ON job_runs(status);
CREATE INDEX IF NOT EXISTS job_runs_created_at_idx ON job_runs(created_at);

-- ------------------------------------------------------------
-- Tasks
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tasks (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  status           task_status NOT NULL DEFAULT 'backlog',
  priority         task_priority NOT NULL DEFAULT 'medium',
  planning_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  planning_status  planning_status,
  session_id       TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_created_at_idx ON tasks(created_at);

CREATE TABLE IF NOT EXISTS subtasks (
  id                TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_subtask_id TEXT REFERENCES subtasks(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  status            subtask_status NOT NULL DEFAULT 'pending',
  assigned_agent_id TEXT,
  session_id        TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  order_index       INTEGER NOT NULL DEFAULT 0,
  result            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subtasks_task_id_idx ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS subtasks_status_idx ON subtasks(status);

CREATE TABLE IF NOT EXISTS task_agents (
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL,
  role        agent_role NOT NULL DEFAULT 'primary',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, agent_id)
);

CREATE INDEX IF NOT EXISTS task_agents_task_id_idx ON task_agents(task_id);
CREATE INDEX IF NOT EXISTS task_agents_agent_id_idx ON task_agents(agent_id);

-- ------------------------------------------------------------
-- Access Tokens
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS access_tokens (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,
  scopes       TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  expires_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS access_tokens_key_hash_idx ON access_tokens(key_hash);
CREATE INDEX IF NOT EXISTS access_tokens_revoked_idx ON access_tokens(revoked);
