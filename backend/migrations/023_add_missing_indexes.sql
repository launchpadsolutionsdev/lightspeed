-- Migration 023: Add missing compound indexes for common query patterns
--
-- These indexes optimize the most frequent queries identified in the audit:
-- 1. Rated examples lookup (used on every AI generation)
-- 2. Auth middleware org membership lookup (used on every authenticated request)
-- 3. Monthly usage count (used on every AI generation for limit checks)

-- Rated examples: compound index for the responseHistory.js rated-examples query
-- Covers: WHERE organization_id = $1 AND rating = 'positive' AND (tool = $2 OR tool IS NULL) AND format = $3
CREATE INDEX IF NOT EXISTS idx_response_history_rated_examples
    ON response_history (organization_id, tool, format, rating)
    WHERE rating IS NOT NULL;

-- Auth middleware: composite index for user→org membership lookup
-- The PK is (user_id, organization_id) which already covers this, but
-- adding an explicit index ensures the LIMIT 1 query is optimal
CREATE INDEX IF NOT EXISTS idx_org_memberships_user_lookup
    ON organization_memberships (user_id);

-- Usage logs: partial index for monthly count queries
-- Covers: WHERE organization_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)
CREATE INDEX IF NOT EXISTS idx_usage_logs_org_created
    ON usage_logs (organization_id, created_at DESC);
