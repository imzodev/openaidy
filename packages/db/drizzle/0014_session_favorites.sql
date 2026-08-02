-- Session favorites: add favorited_at to sessions.
-- Nullable timestamp; null means the session is not a favorite. Favoriting
-- deliberately does not touch updated_at so it never affects recency ordering.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS favorited_at TIMESTAMPTZ;
