-- Migration 042: Home Base — Custom Categories (DB-driven)

CREATE TABLE IF NOT EXISTS home_base_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    slug VARCHAR(40) NOT NULL,
    label VARCHAR(60) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#6B7280',
    sort_order INT NOT NULL DEFAULT 0,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_hb_categories_org ON home_base_categories(organization_id, sort_order);

-- Drop the CHECK constraint on category column so custom slugs are allowed.
-- The constraint name may vary; use DO block to find and drop it dynamically.
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'home_base_posts'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%category%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE home_base_posts DROP CONSTRAINT ' || constraint_name;
    END IF;
END
$$;

-- Widen the category column to support longer custom slugs
ALTER TABLE home_base_posts ALTER COLUMN category TYPE VARCHAR(40);
