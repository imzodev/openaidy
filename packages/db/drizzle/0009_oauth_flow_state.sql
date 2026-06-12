-- ============================================================
-- Migration: 0009_oauth_flow_state
-- Description: Short-lived OAuth flow state for PKCE flows.
-- Holds the code_verifier between the /start and /callback steps.
-- Rows older than 10 minutes are cleaned up on read.
-- ============================================================

CREATE TABLE IF NOT EXISTS oauth_flow_state (
  state           TEXT PRIMARY KEY,
  provider_id     TEXT NOT NULL,
  code_verifier   TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,
  region          TEXT,
  redirect_uri    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for TTL cleanup (find rows older than X)
CREATE INDEX IF NOT EXISTS oauth_flow_state_created_at_idx ON oauth_flow_state(created_at);

-- Index for finding by provider (debugging + cleanup)
CREATE INDEX IF NOT EXISTS oauth_flow_state_provider_id_idx ON oauth_flow_state(provider_id);
