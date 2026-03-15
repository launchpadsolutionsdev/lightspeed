-- Migration 040: Home Base — Digest Email Preferences & Activity Log

-- Digest email preferences per user
CREATE TABLE IF NOT EXISTS home_base_digest_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    frequency VARCHAR(10) NOT NULL DEFAULT 'off' CHECK (frequency IN ('off', 'daily', 'weekly')),
    last_sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_hb_digest_user ON home_base_digest_preferences(user_id);

-- Activity log for admin engagement stats
CREATE TABLE IF NOT EXISTS home_base_activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(20) NOT NULL CHECK (action IN ('post', 'comment', 'reaction', 'view', 'ack', 'bookmark')),
    post_id UUID REFERENCES home_base_posts(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hb_activity_org ON home_base_activity_log(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_hb_activity_user ON home_base_activity_log(user_id, created_at);
