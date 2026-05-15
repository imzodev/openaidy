-- Add session_type column to sessions table
ALTER TABLE sessions ADD COLUMN type session_type NOT NULL DEFAULT 'chat';

-- Add index for efficient type filtering
CREATE INDEX idx_sessions_type ON sessions(type);