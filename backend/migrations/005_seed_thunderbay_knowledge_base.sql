-- Migration 005: (historical) TBRHSF knowledge base seed.
--
-- The TBRHSF-specific content originally inserted here has been moved
-- out of the generalized product into a runtime seeder gated by the
-- SEED_TBRHSF environment variable. See:
--   backend/src/services/tbrhsfSeeder.js
--   backend/data/tbrhsf-seed.json
--
-- This migration is kept as a no-op placeholder so the filename
-- sequence stays intact and the _migration_flags row (if present from
-- a previous run) remains consistent. It does not modify schema or
-- data.

DO $$ BEGIN
    RAISE NOTICE 'Migration 005: no-op (TBRHSF seed moved to runtime seeder)';
END $$;
