-- Migration: Add data retention settings to organizations
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '060_data_retention_settings') THEN

        -- Add retention settings columns to organizations
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_response_history_days INTEGER DEFAULT 365;
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_audit_logs_days INTEGER DEFAULT 730;
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_conversations_days INTEGER DEFAULT 180;
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_usage_logs_days INTEGER DEFAULT 365;

        -- Index on created_at for efficient cleanup queries
        CREATE INDEX IF NOT EXISTS idx_response_history_created_at ON response_history (created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at);
        CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations (created_at);
        CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs (created_at);

        INSERT INTO _migration_flags (key, applied_at) VALUES ('060_data_retention_settings', NOW());
    END IF;
END $$;
