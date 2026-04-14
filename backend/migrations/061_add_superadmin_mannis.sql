-- Migration 061: (historical) Super-admin grant.
--
-- Previously hardcoded a specific personal email address as a super
-- admin and org owner. That grant has been migrated to the runtime
-- bootstrap (backend/src/services/superAdminBootstrap.js, driven by
-- the SUPER_ADMINS environment variable).
--
-- This migration is kept as a no-op so the filename sequence stays
-- intact. The user already granted in production by the original
-- version of this migration retains their super_admin flag (it was
-- applied unconditionally to the existing row) and their org
-- membership — no data change is needed for the existing deployment.

DO $$ BEGIN
    RAISE NOTICE 'Migration 061: no-op (super-admin grant moved to SUPER_ADMINS env bootstrap)';
END $$;
