-- Add BUMP feed URL columns to organizations so each org can configure
-- their own XML feed endpoints for the Heartbeat dashboard.
-- Also add organization_id to velocity_snapshots for per-org data isolation.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '057_org_feed_urls') THEN

        -- BUMP feed URLs per organization
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bump_feed_url VARCHAR(500);
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bump_winners_feed_url VARCHAR(500);
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bump_sales_feed_url VARCHAR(500);

        -- Scope velocity snapshots by organization
        ALTER TABLE velocity_snapshots ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
        CREATE INDEX IF NOT EXISTS idx_velocity_snapshots_org_ts ON velocity_snapshots (organization_id, ts DESC);

        INSERT INTO _migration_flags (key, applied_at) VALUES ('057_org_feed_urls', NOW());
        RAISE NOTICE 'Organization feed URL columns and velocity_snapshots org_id added';

    ELSE
        RAISE NOTICE 'Skipping 057 - already applied';
    END IF;
END $$;

-- Backfill: assign existing velocity_snapshots to Thunder Bay org and set their feed URLs
DO $$
DECLARE
    v_org_id UUID;
BEGIN
    SELECT id INTO v_org_id FROM organizations
    WHERE name ILIKE '%Thunder Bay Regional Health Sciences%'
    LIMIT 1;

    IF v_org_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM _migration_flags WHERE key = '057_tb_feed_backfill'
    ) THEN
        -- Set Thunder Bay's feed URLs
        UPDATE organizations SET
            bump_feed_url = 'https://tbh.ca-api.bumpcbnraffle.net/api/feeds/dak',
            bump_winners_feed_url = 'https://tbh.ca-api.bumpcbnraffle.net/api/feeds/winners',
            bump_sales_feed_url = 'https://tbh.ca-api.bumpcbnraffle.net/api/feeds/event-details'
        WHERE id = v_org_id;

        -- Assign all existing snapshots to Thunder Bay
        UPDATE velocity_snapshots SET organization_id = v_org_id
        WHERE organization_id IS NULL;

        INSERT INTO _migration_flags (key, applied_at) VALUES ('057_tb_feed_backfill', NOW());
        RAISE NOTICE 'Thunder Bay feed URLs and snapshot backfill complete';
    END IF;
END $$;
