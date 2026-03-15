-- Migration 037: Home Base — Post editing, attachments, and soft-delete (archive)

-- Track edit history: edited_at timestamp + edited flag
ALTER TABLE home_base_posts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE;

-- Soft-delete: archived posts are hidden from the feed but recoverable
ALTER TABLE home_base_posts ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;
ALTER TABLE home_base_posts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE home_base_posts ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_hb_posts_archived ON home_base_posts(organization_id, archived);

-- Attachments table (files stored as bytea, max ~5MB each)
CREATE TABLE IF NOT EXISTS home_base_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES home_base_posts(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    file_data BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hb_attachments_post ON home_base_attachments(post_id);
