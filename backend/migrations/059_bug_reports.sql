-- Migration 059: Bug Reports table
-- Allows users to submit bug reports, feature requests, and questions

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_migration_flags') THEN
        CREATE TABLE _migration_flags (flag TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW());
    END IF;

    IF EXISTS (SELECT 1 FROM _migration_flags WHERE flag = '059_bug_reports') THEN
        RAISE NOTICE '059_bug_reports already applied — skipping';
        RETURN;
    END IF;

    CREATE TABLE IF NOT EXISTS bug_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        category VARCHAR(20) NOT NULL DEFAULT 'bug' CHECK (category IN ('bug', 'feature', 'question')),
        severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
        status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
        page_url TEXT,
        browser_info TEXT,
        admin_notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_bug_reports_user ON bug_reports(user_id);
    CREATE INDEX idx_bug_reports_org ON bug_reports(organization_id);
    CREATE INDEX idx_bug_reports_status ON bug_reports(status);
    CREATE INDEX idx_bug_reports_created ON bug_reports(created_at DESC);

    INSERT INTO _migration_flags (flag) VALUES ('059_bug_reports');
    RAISE NOTICE '059_bug_reports applied successfully';
END $$;
