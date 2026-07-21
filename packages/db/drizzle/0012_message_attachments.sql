-- ============================================================
-- Migration: 0012_message_attachments
-- Description: Metadata table for image/audio attachments on
--              session messages. Bytes live on local disk at
--              storage_path; message_id is null until the
--              attachment is linked to a persisted message.
-- ============================================================

CREATE TABLE IF NOT EXISTS message_attachments (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id   TEXT REFERENCES session_messages(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                          -- 'image' | 'audio'
  source       TEXT NOT NULL DEFAULT 'user_upload',    -- 'user_upload' | 'tool_output'
  name         TEXT,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS message_attachments_message_id_idx ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS message_attachments_session_id_idx ON message_attachments(session_id);
