-- Migration 009: Organization content configuration (schema only).
--
-- The TBRHSF-specific content backfill previously in this migration
-- has been moved to the runtime seeder (backend/src/services/
-- tbrhsfSeeder.js, gated by SEED_TBRHSF=true). This migration now
-- only creates the generic columns.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '009_org_content_config') THEN

        -- Default draw time (e.g., "11:00 AM")
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_draw_time VARCHAR(50);

        -- Ticket purchase deadline time (e.g., "11:59 PM")
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ticket_deadline_time VARCHAR(50);

        -- Custom social media required line
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS social_required_line TEXT;

        -- Brand terminology rules as structured JSON
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_terminology JSONB;

        -- Email add-on snippets as structured JSON
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email_addons JSONB;

        INSERT INTO _migration_flags (key) VALUES ('009_org_content_config');
        RAISE NOTICE 'Migration 009: organization content config columns added';

    ELSE
        RAISE NOTICE 'Migration 009: already applied';
    END IF;
END $$;
