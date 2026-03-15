-- Migration 044: Home Base — Pin ordering

-- Add pin_order column for explicit ordering of pinned posts (lower = higher)
ALTER TABLE home_base_posts ADD COLUMN IF NOT EXISTS pin_order INT DEFAULT 0;

-- Backfill existing pinned posts with creation-order based pin_order
DO $$
BEGIN
    WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY created_at) AS rn
        FROM home_base_posts
        WHERE pinned = true
    )
    UPDATE home_base_posts p SET pin_order = ranked.rn
    FROM ranked WHERE p.id = ranked.id;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
