-- Migration 039: Home Base — Post Views (Read Receipts / "Seen by") and Bookmarks

-- Post views / read receipts
CREATE TABLE IF NOT EXISTS home_base_post_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES home_base_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_hb_post_views_post ON home_base_post_views(post_id);
CREATE INDEX IF NOT EXISTS idx_hb_post_views_user ON home_base_post_views(user_id);

-- Bookmarks / Save for later
CREATE TABLE IF NOT EXISTS home_base_bookmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES home_base_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_hb_bookmarks_user ON home_base_bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_hb_bookmarks_post ON home_base_bookmarks(post_id);
