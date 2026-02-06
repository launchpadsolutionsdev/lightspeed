-- Add organization profile fields for auto-filling Draft Assistant placeholders
-- and enriching Response Assistant context with org-specific details

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '006_org_profile') THEN

        -- Website URL (e.g., www.thunderbay5050.ca)
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website_url VARCHAR(500);

        -- Licence/license number (e.g., RAF1296922)
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS licence_number VARCHAR(100);

        -- In-person ticket purchase location (e.g., Intercity Shopping Centre)
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

        INSERT INTO _migration_flags (key, applied_at) VALUES ('006_org_profile', NOW());
        RAISE NOTICE 'Organization profile fields added successfully';

    ELSE
        RAISE NOTICE 'Skipping 006 - already applied';
    END IF;
END $$;

-- Backfill Thunder Bay org profile if it exists and hasn't been backfilled
DO $$
DECLARE
    v_org_id UUID;
BEGIN
    SELECT id INTO v_org_id FROM organizations
    WHERE name ILIKE '%Thunder Bay Regional Health Sciences%'
    LIMIT 1;

    IF v_org_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM _migration_flags WHERE key = '006_tb_profile_backfill'
    ) THEN
        UPDATE organizations SET
            website_url = 'www.thunderbay5050.ca',
            licence_number = 'RAF1296922',
            store_location = 'Thunder Bay 50/50 store inside Intercity Shopping Centre',
            support_email = 'info@thunderbay5050.ca',
            ceo_name = 'Glenn Craig',
            ceo_title = 'President & CEO',
            media_contact_name = 'Torin Gunnell',
            media_contact_email = 'tgunnell@tbrhsc.net',
            cta_website_url = 'www.thunderbaycatchtheace.ca',
            mission = 'The Thunder Bay Regional Health Sciences Foundation raises funds to support Thunder Bay Regional Health Sciences Centre, Northwestern Ontario''s largest hospital. Lottery proceeds help provide vital equipment, programs, and services that make a real difference in our community.'
        WHERE id = v_org_id;

        INSERT INTO _migration_flags (key, applied_at) VALUES ('006_tb_profile_backfill', NOW());
        RAISE NOTICE 'Thunder Bay org profile backfilled successfully';
    END IF;
END $$;
