-- One-time reset: clear org memberships for fresh onboarding
-- Users and their data (response history, favorites, etc.) are preserved
-- On next login, users will see the org setup screen
-- Uses a tracking table so this only runs exactly once

CREATE TABLE IF NOT EXISTS _migration_flags (
    key TEXT PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '004_reset_orgs') THEN
        DELETE FROM organization_invitations;
        DELETE FROM organization_memberships;
        DELETE FROM organizations;
        INSERT INTO _migration_flags (key, applied_at) VALUES ('004_reset_orgs', NOW());
        RAISE NOTICE 'Organization reset complete - ready for fresh onboarding';
    ELSE
        RAISE NOTICE 'Skipping reset - already applied';
    END IF;
END $$;
