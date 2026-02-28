-- Response Rules: persistent org-level instructions for the AI assistants.
-- Each rule is a single directive (e.g., "Never say X", "Always start with Y")
-- that gets injected into every system prompt for the Response Assistant.

CREATE TABLE IF NOT EXISTS response_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rule_text TEXT NOT NULL,
    rule_type VARCHAR(20) NOT NULL DEFAULT 'general'
        CHECK (rule_type IN ('always', 'never', 'formatting', 'general')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookup by org (the main access pattern)
CREATE INDEX IF NOT EXISTS idx_response_rules_org
    ON response_rules (organization_id, sort_order)
    WHERE is_active = TRUE;

-- Seed Thunder Bay with starter rules
DO $$
DECLARE
    v_org_id UUID;
    v_user_id UUID;
BEGIN
    SELECT id INTO v_org_id FROM organizations
    WHERE name ILIKE '%Thunder Bay Regional Health Sciences%'
    LIMIT 1;

    IF v_org_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM _migration_flags WHERE key = '021_seed_tb_response_rules'
    ) THEN
        -- Get an admin user to attribute the rules to
        SELECT om.user_id INTO v_user_id
        FROM organization_memberships om
        WHERE om.organization_id = v_org_id
        LIMIT 1;

        INSERT INTO response_rules (organization_id, rule_text, rule_type, is_active, sort_order, created_by) VALUES
        (v_org_id,
         'Never tell the customer to "feel free to reach out," "contact us at," or suggest emailing us — they are already emailing us and would simply reply to continue the conversation.',
         'never', TRUE, 1, v_user_id),
        (v_org_id,
         'Start every email response with "Hi there," on the first line, followed by "Thank you for reaching out." on the next line.',
         'always', TRUE, 2, v_user_id);

        INSERT INTO _migration_flags (key) VALUES ('021_seed_tb_response_rules')
        ON CONFLICT (key) DO NOTHING;

        RAISE NOTICE 'Thunder Bay response rules seeded';
    END IF;
END $$;
