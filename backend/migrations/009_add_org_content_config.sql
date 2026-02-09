-- Add organization content configuration fields
-- These support per-org draw times, brand terminology, social media required line, and email add-ons
-- Part of the tenant isolation work (Steps 3-5)

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '009_org_content_config') THEN

        -- Default draw time (e.g., "11:00 AM")
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_draw_time VARCHAR(50);

        -- Ticket purchase deadline time (e.g., "11:59 PM")
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ticket_deadline_time VARCHAR(50);

        -- Custom social media required line (replaces hardcoded DRAFT_KNOWLEDGE_BASE line)
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS social_required_line TEXT;

        -- Brand terminology rules as structured JSON
        -- e.g., {"correct": ["Grand Prize", "Deadline"], "incorrect": ["jackpot", "ends"], "notes": ["NEVER use 'jackpot'"]}
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_terminology JSONB;

        -- Email add-on snippets as structured JSON
        -- e.g., {"subscriptions": "Did you know you can subscribe...", "rewardsPlus": "Join Rewards+...", "catchTheAce": "The CTA is LIVE..."}
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email_addons JSONB;

        INSERT INTO _migration_flags (key, applied_at) VALUES ('009_org_content_config', NOW());
        RAISE NOTICE 'Organization content config fields added successfully';

    ELSE
        RAISE NOTICE 'Skipping 009 - already applied';
    END IF;
END $$;

-- Backfill Thunder Bay org with their specific content config
DO $$
DECLARE
    v_org_id UUID;
BEGIN
    SELECT id INTO v_org_id FROM organizations
    WHERE name ILIKE '%Thunder Bay Regional Health Sciences%'
    LIMIT 1;

    IF v_org_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM _migration_flags WHERE key = '009_tb_content_backfill'
    ) THEN
        UPDATE organizations SET
            default_draw_time = '11:00 AM',
            ticket_deadline_time = '11:59 PM',
            social_required_line = 'Purchase tickets online at www.thunderbay5050.ca or at the Thunder Bay 50/50 store inside Intercity Shopping Centre!',
            brand_terminology = '{"correct": ["Grand Prize", "Deadline", "Live"], "incorrect": ["jackpot", "ends", "starts"], "notes": ["NEVER use ''jackpot'' - always use ''Grand Prize''", "Use ''Deadline'' instead of ''ends''", "Use ''Live'' instead of ''starts''"]}',
            email_addons = '{"subscriptions": "Did you know you can subscribe to the Thunder Bay 50/50? Never miss a draw! Set up a monthly subscription and your tickets are automatically purchased each month. Visit www.thunderbay5050.ca to set up your subscription today!", "rewardsPlus": "Join Rewards+ and earn points with every ticket purchase! Redeem your points for bonus entries, exclusive merchandise, and more. Sign up at www.thunderbay5050.ca!", "catchTheAce": "The Thunder Bay Catch The Ace is LIVE! You LOVE the 50/50, so you might love our other raffles too! Catch The Ace is a weekly progressive lottery that supports the Our Hearts at Home Campaign. We''ve awarded over $500,000 in prizes so far, come see what the fun is all about at www.thunderbaycatchtheace.ca!"}'
        WHERE id = v_org_id;

        INSERT INTO _migration_flags (key, applied_at) VALUES ('009_tb_content_backfill', NOW());
        RAISE NOTICE 'Thunder Bay content config backfilled successfully';
    END IF;
END $$;
