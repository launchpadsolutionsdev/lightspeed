-- Migration 038: Home Base — Acknowledgments, Post Templates, Scheduled Posts

-- Acknowledgment tracking for urgent posts
ALTER TABLE home_base_posts ADD COLUMN IF NOT EXISTS requires_ack BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS home_base_acknowledgments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES home_base_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_hb_ack_post ON home_base_acknowledgments(post_id);

-- Post templates (org-specific reusable post formats)
CREATE TABLE IF NOT EXISTS home_base_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    body TEXT NOT NULL,
    category VARCHAR(20) DEFAULT 'general' CHECK (category IN ('urgent', 'fyi', 'draw_update', 'campaign', 'general')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hb_templates_org ON home_base_templates(organization_id);

-- Scheduled posts
ALTER TABLE home_base_posts ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMP WITH TIME ZONE;
ALTER TABLE home_base_posts ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_hb_posts_scheduled ON home_base_posts(scheduled_for)
    WHERE scheduled_for IS NOT NULL AND is_draft = true;
