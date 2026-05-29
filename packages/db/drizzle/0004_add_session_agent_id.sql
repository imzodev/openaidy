-- Add agent_id column to sessions table
-- This stores the last agent used in this session, allowing
-- the session to "remember" which agent was used when re-opened
ALTER TABLE sessions ADD COLUMN agent_id TEXT;

-- Create index for efficient agent filtering (when listing sessions by agent)
CREATE INDEX idx_sessions_agent_id ON sessions(agent_id);