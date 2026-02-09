-- Add tool column to response_history so we can track feedback per tool
-- (response_assistant, draft_assistant, ask_lightspeed)
ALTER TABLE response_history ADD COLUMN IF NOT EXISTS tool VARCHAR(50) DEFAULT 'response_assistant';

-- Index for filtering rated examples by tool
CREATE INDEX IF NOT EXISTS idx_response_history_tool_rating
ON response_history(organization_id, tool, rating) WHERE rating IS NOT NULL;
