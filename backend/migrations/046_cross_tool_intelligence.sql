-- Cross-Tool Intelligence: Add metadata columns to response_history
-- for better cross-tool context queries and tracking which context layers were used.

ALTER TABLE response_history
  ADD COLUMN IF NOT EXISTS context_layers_used JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS content_type VARCHAR(50);

-- Index for fast cross-tool context queries
CREATE INDEX IF NOT EXISTS idx_response_history_cross_tool
  ON response_history(organization_id, tool, created_at DESC);

-- Index for content_type filtering
CREATE INDEX IF NOT EXISTS idx_response_history_content_type
  ON response_history(organization_id, content_type)
  WHERE content_type IS NOT NULL;
