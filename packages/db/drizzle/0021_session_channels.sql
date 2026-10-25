-- ============================================================
-- Migration: 0021_session_channels
-- Description: Remember which WhatsApp/Discord chat a channel
--              conversation replies to, so reminders and follow-ups
--              scheduled in that conversation reach the same chat.
-- ============================================================

CREATE TABLE IF NOT EXISTS session_channels (
  session_id text PRIMARY KEY NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  channel_type text NOT NULL,
  target text NOT NULL,
  sender_id text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
