-- Migration 006: Organization profile fields (schema only).
--
-- The TBRHSF-specific profile backfill previously in this migration
-- has been moved to the runtime seeder (backend/src/services/
-- tbrhsfSeeder.js, gated by SEED_TBRHSF=true). This migration now
-- only creates the generic columns.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '006_org_profile') THEN

        -- Website URL
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website_url VARCHAR(500);

        -- Licence/license number
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS licence_number VARCHAR(100);

        -- In-person ticket purchase location
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS store_location TEXT;

        -- Support email for customer inquiries
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS support_email VARCHAR(255);

        -- CEO/President name and title
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ceo_name VARCHAR(255);
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ceo_title VARCHAR(255);

        -- Media/press contact
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS media_contact_name VARCHAR(255);
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS media_contact_email VARCHAR(255);

        -- Catch the Ace website (if applicable)
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cta_website_url VARCHAR(500);

        -- Organization mission/description
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS mission TEXT;

        INSERT INTO _migration_flags (key) VALUES ('006_org_profile');
        RAISE NOTICE 'Migration 006: organization profile columns added';

    ELSE
        RAISE NOTICE 'Migration 006: already applied';
    END IF;
END $$;
