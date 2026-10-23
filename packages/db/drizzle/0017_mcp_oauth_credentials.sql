-- ============================================================
-- Migration: 0017_mcp_oauth_credentials
-- Description: Encrypted OAuth credentials for remote MCP servers
-- (dynamic client registration, tokens, PKCE verifier, discovery
-- metadata), one row per server.
-- ============================================================

CREATE TABLE IF NOT EXISTS mcp_oauth_credentials (
  server_id       TEXT PRIMARY KEY,
  encrypted_data  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
