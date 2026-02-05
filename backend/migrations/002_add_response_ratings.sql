-- Add rating columns to response_history for feedback loop
-- This enables the AI to learn from thumbs up/down ratings

ALTER TABLE response_history ADD COLUMN IF NOT EXISTS rating VARCHAR(20);
-- 'positive' or 'negative'

ALTER TABLE response_history ADD COLUMN IF NOT EXISTS rating_feedback TEXT;
-- Optional user note on what was wrong (for negative ratings)

ALTER TABLE response_history ADD COLUMN IF NOT EXISTS rating_at TIMESTAMP WITH TIME ZONE;
-- When the rating was given

-- Index for efficient lookup of rated responses per organization
CREATE INDEX IF NOT EXISTS idx_response_history_rating ON response_history(organization_id, rating) WHERE rating IS NOT NULL;
