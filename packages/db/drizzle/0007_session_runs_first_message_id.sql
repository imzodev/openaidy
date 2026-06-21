-- Add first_message_id column to session_runs table
-- This column tracks the ID of the first assistant message produced by a run

ALTER TABLE session_runs ADD COLUMN first_message_id TEXT;