-- ============================================================
-- Migration: 0008_provider_credentials
-- Description: Provider credentials table for storing encrypted API keys and OAuth tokens
-- ============================================================

CREATE TABLE IF NOT EXISTS provider_credentials (
  id           TEXT PRIMARY KEY,
  provider_id  TEXT NOT NULL,
  auth_method   TEXT NOT NULL,  -- 'api_key', 'oauth', 'device_code'
  encrypted_credentials TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'connected',  -- 'connected', 'error', 'disconnected'
  last_used_at TIMESTAMPTZ,
  error_message TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: only one credential per provider
CREATE UNIQUE INDEX IF NOT EXISTS provider_credentials_provider_id_idx ON provider_credentials(provider_id);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS provider_credentials_status_idx ON provider_credentials(status);