-- Migration 041: Home Base — Comment Reactions & Quote-Reply

-- Comment reactions (same pattern as post reactions)
CREATE TABLE IF NOT EXISTS home_base_comment_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID NOT NULL REFERENCES home_base_comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(10) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(comment_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_hb_comment_reactions_comment ON home_base_comment_reactions(comment_id);

-- Quote-reply: optional reference to a parent comment being replied to
ALTER TABLE home_base_comments ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES home_base_comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hb_comments_reply_to ON home_base_comments(reply_to_id) WHERE reply_to_id IS NOT NULL;
