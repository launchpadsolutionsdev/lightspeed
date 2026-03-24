-- Backfill: ensure all existing organizations have starter templates and response rules.
-- Previously only Thunder Bay was seeded via org-specific migrations.
-- This brings all existing orgs up to parity for multi-tenant readiness.

-- Copy system templates to any org that has zero templates
DO $$
DECLARE
    v_org RECORD;
    v_count INTEGER;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '058_seed_all_orgs_templates') THEN

        FOR v_org IN SELECT id FROM organizations LOOP
            SELECT COUNT(*) INTO v_count FROM content_templates WHERE organization_id = v_org.id;
            IF v_count = 0 THEN
                INSERT INTO content_templates (organization_id, template_type, name, subject, headline, content, metadata, sort_order)
                SELECT v_org.id, template_type, name, subject, headline, content, metadata, sort_order
                FROM content_templates
                WHERE organization_id IS NULL;

                RAISE NOTICE 'Seeded templates for org %', v_org.id;
            END IF;
        END LOOP;

        INSERT INTO _migration_flags (key, applied_at) VALUES ('058_seed_all_orgs_templates', NOW());
        RAISE NOTICE 'All orgs seeded with starter templates';

    ELSE
        RAISE NOTICE 'Skipping 058 templates - already applied';
    END IF;
END $$;

-- Seed starter response rules for any org that has zero rules
DO $$
DECLARE
    v_org RECORD;
    v_count INTEGER;
    v_user_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '058_seed_all_orgs_rules') THEN

        FOR v_org IN SELECT id FROM organizations LOOP
            SELECT COUNT(*) INTO v_count FROM response_rules WHERE organization_id = v_org.id;
            IF v_count = 0 THEN
                -- Get any member to attribute the rules to
                SELECT om.user_id INTO v_user_id
                FROM organization_memberships om
                WHERE om.organization_id = v_org.id
                LIMIT 1;

                INSERT INTO response_rules (organization_id, rule_text, rule_type, is_active, sort_order, created_by) VALUES
                (v_org.id,
                 'Never tell the customer to "feel free to reach out," "contact us at," or suggest emailing us — they are already emailing us and would simply reply to continue the conversation.',
                 'never', TRUE, 1, v_user_id),
                (v_org.id,
                 'Start every email response with "Hi there," on the first line, followed by "Thank you for reaching out." on the next line.',
                 'always', TRUE, 2, v_user_id);

                RAISE NOTICE 'Seeded response rules for org %', v_org.id;
            END IF;
        END LOOP;

        INSERT INTO _migration_flags (key, applied_at) VALUES ('058_seed_all_orgs_rules', NOW());
        RAISE NOTICE 'All orgs seeded with starter response rules';

    ELSE
        RAISE NOTICE 'Skipping 058 rules - already applied';
    END IF;
END $$;
