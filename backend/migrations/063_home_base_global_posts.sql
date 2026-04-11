-- Migration 063: Add global post support for Super Admin announcements
-- Global posts (is_global = true) appear in every organization's Home Base feed.
-- Only super admins can create global posts. organization_id is nullable for them.

ALTER TABLE home_base_posts ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT false;

-- Allow organization_id to be NULL for global posts
ALTER TABLE home_base_posts ALTER COLUMN organization_id DROP NOT NULL;

-- Index for efficient fetching of global posts alongside org posts
CREATE INDEX IF NOT EXISTS idx_home_base_posts_global ON home_base_posts (is_global) WHERE is_global = true;
