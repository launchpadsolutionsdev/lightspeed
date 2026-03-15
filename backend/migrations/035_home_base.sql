-- Migration 035: Home Base — Team Bulletin Board
-- Posts and comments tables for the Home Base feature

CREATE TABLE IF NOT EXISTS home_base_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    category VARCHAR(20) DEFAULT 'general' CHECK (category IN ('urgent', 'fyi', 'draw_update', 'campaign', 'general')),
    pinned BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_home_base_posts_org ON home_base_posts(organization_id);
CREATE INDEX IF NOT EXISTS idx_home_base_posts_org_created ON home_base_posts(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_home_base_posts_org_category ON home_base_posts(organization_id, category);
CREATE INDEX IF NOT EXISTS idx_home_base_posts_org_pinned ON home_base_posts(organization_id, pinned) WHERE pinned = true;

CREATE TABLE IF NOT EXISTS home_base_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES home_base_posts(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_home_base_comments_post ON home_base_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_home_base_comments_post_created ON home_base_comments(post_id, created_at);
