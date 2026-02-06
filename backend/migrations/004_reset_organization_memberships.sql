-- One-time reset: clear org memberships for fresh onboarding
-- Users and their data (response history, favorites, etc.) are preserved
-- On next login, users will see the org setup screen
-- Safe to re-run: only executes if no org named 'Thunder Bay Regional Health Sciences Foundation' exists

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM organizations WHERE name ILIKE '%Thunder Bay Regional Health Sciences%') THEN
        DELETE FROM organization_invitations;
        DELETE FROM organization_memberships;
        DELETE FROM organizations;
        RAISE NOTICE 'Organization reset complete - ready for fresh onboarding';
    ELSE
        RAISE NOTICE 'Skipping reset - Thunder Bay org already exists';
    END IF;
END $$;
