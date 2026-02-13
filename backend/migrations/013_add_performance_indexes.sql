-- Add indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_response_history_org_created ON response_history(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_org ON knowledge_base(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_memberships_user ON organization_memberships(user_id);
