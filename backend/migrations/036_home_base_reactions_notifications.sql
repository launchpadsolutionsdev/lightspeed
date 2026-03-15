-- Migration 036: Home Base — Reactions, Notifications, and Full-Text Search
-- Chunk 1: Core engagement features

-- Reactions (emoji reactions on posts)
CREATE TABLE IF NOT EXISTS home_base_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES home_base_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(10) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(post_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_hb_reactions_post ON home_base_reactions(post_id);

-- Notifications (mentions, replies, etc.)
CREATE TABLE IF NOT EXISTS home_base_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('mention', 'reply')),
    post_id UUID REFERENCES home_base_posts(id) ON DELETE CASCADE,
    comment_id UUID REFERENCES home_base_comments(id) ON DELETE CASCADE,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hb_notif_recipient ON home_base_notifications(recipient_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hb_notif_org ON home_base_notifications(organization_id);

-- Full-text search on posts
ALTER TABLE home_base_posts ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS idx_hb_posts_search ON home_base_posts USING gin(search_vector);

-- Trigger to auto-update search_vector on insert/update
CREATE OR REPLACE FUNCTION hb_posts_search_trigger() RETURNS trigger AS $$
BEGIN
    NEW.search_vector := to_tsvector('english', COALESCE(NEW.body, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hb_posts_search_update ON home_base_posts;
CREATE TRIGGER hb_posts_search_update
    BEFORE INSERT OR UPDATE OF body ON home_base_posts
    FOR EACH ROW EXECUTE FUNCTION hb_posts_search_trigger();

-- Backfill existing posts
UPDATE home_base_posts SET search_vector = to_tsvector('english', COALESCE(body, ''))
WHERE search_vector IS NULL;
