-- Create content_templates table for per-org draft examples and system template library
-- organization_id = NULL means it's a system/library template available for import
-- organization_id = UUID means it's an org-specific template used by their Draft Assistant

CREATE TABLE IF NOT EXISTS content_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    template_type VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    subject VARCHAR(500),
    headline VARCHAR(500),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for org-specific templates
CREATE INDEX IF NOT EXISTS idx_content_templates_org ON content_templates(organization_id);
-- Index for system templates (used in template library browse)
CREATE INDEX IF NOT EXISTS idx_content_templates_system ON content_templates(template_type) WHERE organization_id IS NULL;
-- Index for org + type combo (used in buildEnhancedSystemPrompt)
CREATE INDEX IF NOT EXISTS idx_content_templates_org_type ON content_templates(organization_id, template_type) WHERE is_active = TRUE;

-- Seed system templates from the former hardcoded DRAFT_KNOWLEDGE_BASE
-- These are available for any org to import into their own template set

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '010_seed_system_templates') THEN

        -- ===== SOCIAL MEDIA EXAMPLES =====
        INSERT INTO content_templates (organization_id, template_type, name, content, metadata, sort_order) VALUES
        (NULL, 'social', 'General Promotion', E'This week''s Early Birds are LIVE, and there''s a whole lotta loot up for grabs \U0001F4B0\n\nMonday, Tuesday and Thursday you can win $5,000. Wednesday''s prize is $10,000!\n\nA $20 ticket gets you 30 numbers in every draw – that''s the Early Birds AND the Grand Prize on [Draw Date].\n\nGet tickets: [Organization Website]\n\nLicence #[Licence Number]', '{"type": "General Promotion"}', 1),

        (NULL, 'social', 'Winner Announcement', E'A BIG congratulations to [Winner First Name], our $5,000 Early Bird #1 winner! \U0001F389\n\nGet your tickets at [Organization Website] for chances at our remaining Early Birds and the Grand Prize draw on [Draw Date].\n\nLicence #[Licence Number]', '{"type": "Winner Announcement"}', 2),

        (NULL, 'social', 'Draw Reminder', E'There are only 2 days left to get your [Organization Name] [Month] tickets for tomorrow''s Grand Prize draw.\n\nThis is the last day to get your tickets in time for tomorrow''s Grand Prize.\n\nThe Grand Prize is currently sitting at $[Amount], guaranteed to be AT LEAST $[Guaranteed Minimum].\n\n$20 = 30 chances to win!\n\nGet tickets: [Organization Website]\n\nLicence #[Licence Number]', '{"type": "Draw Reminder"}', 3),

        (NULL, 'social', 'Early Bird Focus', E'This week''s Early Bird schedule is LIVE \U0001F389\n\nWed, [Date]: Early Bird #1 – $10,000\nThu, [Date]: Early Birds #2-6 – 5 x $5,000 prizes\nFri, [Date]: Early Birds #7-9 – 3 x $10,000 prizes\nSat, [Date]: Early Bird #10 – $25,000!\n\nGet your [Month] tickets now at [Organization Website] for your shot at over $100,000 in Early Bird prizes PLUS the Grand Prize on [Grand Prize Date].\n\nLicence #[Licence Number]', '{"type": "Early Bird Focus"}', 4),

        (NULL, 'social', 'Milestone/Record', E'\U0001F6A8 [Organization Name] RECORD ALERT \U0001F6A8\n\nThe Grand Prize has hit $[Milestone Amount] – a new record!\n\nThere''s still time to get your tickets before [Day]''s deadline.\n\nGet tickets: [Organization Website]\n\nLicence #[Licence Number]', '{"type": "Milestone/Record"}', 5);

        -- ===== EMAIL: NEW DRAW ANNOUNCEMENT =====
        INSERT INTO content_templates (organization_id, template_type, name, subject, content, metadata, sort_order) VALUES
        (NULL, 'email-new-draw', 'New Draw Launch (Excitement)', '[Month] Draw is LIVE – Over $100K in Early Birds!', E'The [Organization Name] [Month] draw is officially LIVE! \U0001F389\n\nThis month features over $100,000 in Early Bird prizes leading up to the Grand Prize draw on [Grand Prize Date].\n\nEarly Bird Schedule:\n• [Day, Date]: $10,000\n• [Day, Date]: 5 x $5,000\n• [Day, Date]: 3 x $10,000\n• [Day, Date]: $25,000\n\nThe Grand Prize is guaranteed to be at least $[Guaranteed Minimum] (50% of ticket sales).\n\nGet your [Month] tickets now at [Organization Website]\n\nGood luck!', '{}', 1),

        (NULL, 'email-new-draw', 'New Draw Launch (First Early Bird)', '[Month] Draw Now Open – First Early Bird [Day]!', E'The [Month] [Organization Name] draw is now open!\n\nOur first Early Bird draw is this [Day], [Date] for $10,000.\n\nThis month we have 15 Early Bird draws totaling over $100,000 in prizes, plus the Grand Prize draw on [Grand Prize Date].\n\nA $20 ticket gets you 30 numbers in every single draw – that''s all the Early Birds AND the Grand Prize.\n\nGet your tickets: [Organization Website]', '{}', 2),

        (NULL, 'email-new-draw', 'New Year New Draw', 'New Year, New Draw – January 50/50 is LIVE', E'Happy New Year! The January [Organization Name] draw is officially open.\n\nStart the year with a chance to win big! Our Early Bird draws begin next week with prizes ranging from $5,000 to $25,000.\n\nThe Grand Prize draw is January [Date], with a guaranteed minimum of $[Guaranteed Minimum].\n\nGet your January tickets at [Organization Website]', '{}', 3);

        -- ===== EMAIL: DRAW REMINDER =====
        INSERT INTO content_templates (organization_id, template_type, name, subject, content, metadata, sort_order) VALUES
        (NULL, 'email-reminder', 'Grand Prize Countdown', E'\u23F0 2 Days Left – Grand Prize Draw [Day]', E'There are only 2 days left to get your [Organization Name] tickets!\n\nThe Grand Prize draw is this [Day] at [Draw Time]. The prize is currently over $[Current Amount] and growing.\n\nDon''t miss your chance – get your tickets before the deadline:\n[Organization Website]', '{}', 1),

        (NULL, 'email-reminder', 'Big Early Bird Tomorrow', E'Tomorrow''s Early Bird: $25,000!', E'Tomorrow is our biggest Early Bird of the month – $25,000!\n\nMake sure you have your tickets before tomorrow''s draw at [Draw Time].\n\nA $20 ticket gets you 30 chances to win.\n\nGet tickets: [Organization Website]', '{}', 2),

        (NULL, 'email-reminder', 'Final Week Reminder', 'Last Week for [Month] Tickets', E'This is the final week to get your [Month] [Organization Name] tickets.\n\nWe still have 3 Early Bird draws remaining this week, plus the Grand Prize draw on [Day].\n\nCurrent Grand Prize: $[Current Amount]+\n\nGet your tickets: [Organization Website]', '{}', 3);

        -- ===== EMAIL: WINNERS =====
        INSERT INTO content_templates (organization_id, template_type, name, subject, content, metadata, sort_order) VALUES
        (NULL, 'email-winners', 'Grand Prize Winner', 'Congratulations to Our Grand Prize Winner!', E'We have a winner! \U0001F389\n\nCongratulations to [Winner First Name] from [Winner City], who won $[Prize Amount] in our [Month] Grand Prize draw!\n\nThank you to everyone who participated. Your support helps fund [organization''s cause/mission].\n\nThe [Next Month] draw is now open – get your tickets at [Organization Website]', '{}', 1),

        (NULL, 'email-winners', 'Early Bird Winner', 'Early Bird Winner: $10,000!', E'Congratulations to [Winner First Name], our $10,000 Early Bird winner!\n\nThere are still more Early Birds to come this month, plus the Grand Prize draw on [Grand Prize Date].\n\nGet your tickets for your chance to win: [Organization Website]', '{}', 2),

        (NULL, 'email-winners', 'Record-Breaking Winner', '[Month] Grand Prize: $[Prize Amount] Winner!', E'RECORD-BREAKING NEWS! \U0001F389\n\nCongratulations to [Winner First Name] from [Winner City], who just won $[Prize Amount] – our biggest Grand Prize EVER!\n\nThis incredible prize was made possible by supporters like you. Thank you for playing and supporting [organization''s cause] in our community.\n\nThe [Next Month] draw is now open. Could you be our next big winner?\n\nGet tickets: [Organization Website]', '{}', 3);

        -- ===== EMAIL: IMPACT SUNDAY =====
        INSERT INTO content_templates (organization_id, template_type, name, subject, content, metadata, sort_order) VALUES
        (NULL, 'email-impact', 'Impact Story', 'Your Impact: [Impact Headline]', E'Every [Organization Name] ticket helps fund [organization''s cause/mission].\n\nThanks to your support, [Organization Name] recently funded [specific impact item or initiative] that will [describe benefit to community].\n\nThis will serve [number of beneficiaries or scope of impact] in our community every year.\n\nThank you for playing and making a difference.', '{}', 1);

        -- ===== EMAIL: LAST CHANCE =====
        INSERT INTO content_templates (organization_id, template_type, name, subject, content, metadata, sort_order) VALUES
        (NULL, 'email-last-chance', 'Final Hours', E'\U0001F6A8 FINAL HOURS – Grand Prize Draw Tomorrow', E'This is it – your last chance to get [Organization Name] tickets!\n\nThe Grand Prize draw is TOMORROW at [Draw Time].\n\nCurrent Grand Prize: $[Current Amount]\n\nTicket sales close tonight at [Sales Close Time].\n\nGet your tickets NOW: [Organization Website]', '{}', 1),

        (NULL, 'email-last-chance', 'Hours Left', E'\u23F0 Hours Left – Don''t Miss the Grand Prize', E'FINAL REMINDER: Ticket sales close TONIGHT!\n\nThe Grand Prize has hit $[Current Amount] – our biggest ever!\n\nTomorrow''s winner could be you, but only if you get your tickets before midnight.\n\n[Organization Website]', '{}', 2),

        (NULL, 'email-last-chance', 'Last Call', 'Last Call for [Month] Tickets', E'This is your last chance to get [Month] [Organization Name] tickets.\n\nSales close tonight at [Sales Close Time]. The Grand Prize draw is tomorrow at [Draw Time].\n\nDon''t miss out: [Organization Website]', '{}', 3);

        -- ===== MEDIA RELEASES =====
        INSERT INTO content_templates (organization_id, template_type, name, headline, content, metadata, sort_order) VALUES
        (NULL, 'media-release', 'Grand Prize Winner (Record)', 'Record-Breaking [Month] 50/50 Delivers $[Prize Amount] Win for [Winner City] Resident', E'FOR IMMEDIATE RELEASE\n\n[CITY], ON – [Organization Name] has announced that [Winner Full Name] of [Winner City] is the winner of the [Month] Grand Prize – a record-breaking $[Prize Amount].\n\n"This is an extraordinary moment for our 50/50 program," said [CEO/President Name], [CEO/President Title] of [Organization Name]. "This win represents the largest prize in our history, and it''s a testament to the incredible support we receive from communities across Ontario."\n\nThe [Month] draw saw unprecedented participation, with ticket sales reaching new heights.\n\n"I still can''t believe it," said the winner. "I''ve been playing for a while, but I never imagined winning something like this."\n\nThe next draw is now open, with tickets available at [Organization Website].\n\n-30-\n\nMedia Contact:\n[Media Contact Name]\n[Organization Name]\n[Media Contact Email]', '{"type": "Grand Prize Winner Announcement"}', 1),

        (NULL, 'media-release', 'Grand Prize Winner (Standard)', '[Winner City] Resident Wins Over $[Prize Amount] in [Month] Draw', E'FOR IMMEDIATE RELEASE\n\n[CITY], ON – [Winner Full Name] of [Winner City], Ontario is the lucky winner of the [Month] Grand Prize, taking home an incredible $[Prize Amount].\n\n"We are thrilled to congratulate the winner on this life-changing win," said [CEO/President Name], [CEO/President Title] of [Organization Name]. "Their support, along with thousands of others who purchased tickets, is helping us fund [organization''s cause/mission]."\n\nThe winner purchased their winning ticket online at [Organization Website]. The [Month] draw saw strong participation from supporters across Ontario.\n\nThe next draw is now open, with tickets available at [Organization Website].\n\n-30-\n\nMedia Contact:\n[Media Contact Name]\n[Organization Name]\n[Media Contact Email]', '{"type": "Grand Prize Winner Announcement"}', 2),

        (NULL, 'media-release', 'Program/Store Announcement', '[Program Name] Secures Long-Term Home at [Location Name]', E'FOR IMMEDIATE RELEASE\n\n[CITY], ON – [Organization Name] is pleased to announce that the in-person ticket location has secured a long-term home at [Location Name].\n\n"This is a significant milestone for our program," said [CEO/President Name], [CEO/President Title] of [Organization Name]. "Having a permanent presence gives our supporters a convenient location to purchase tickets and learn about the impact of their support."\n\nThe location offers in-person ticket sales during regular hours. Staff and volunteers are on hand to assist customers.\n\nTickets are available in-person or online at [Organization Website].\n\n-30-\n\nMedia Contact:\n[Media Contact Name]\n[Organization Name]\n[Media Contact Email]', '{"type": "Program/Store Announcement"}', 3),

        (NULL, 'media-release', 'Foundation Impact Announcement', '[Organization Name] Makes Largest Gift in Its History to Support [Cause Area]', E'FOR IMMEDIATE RELEASE\n\n[CITY], ON – [Organization Name] has announced a historic $[Gift Amount] grant to [Beneficiary Organization/Program] – the largest single gift in the organization''s history.\n\n"This represents a transformational investment in our community," said [CEO/President Name], [CEO/President Title] of [Organization Name]. "This funding will support areas that will benefit our community for years to come."\n\nThe grant was made possible through various fundraising programs, including the highly successful lottery, donor contributions, and investment returns.\n\n-30-\n\nMedia Contact:\n[Media Contact Name]\n[Organization Name]\n[Media Contact Email]', '{"type": "Foundation Impact Announcement"}', 4),

        (NULL, 'media-release', 'Media Advisory - Milestone', 'MEDIA ADVISORY: Grand Prize Exceeds $[Amount] Guarantee in Record Time', E'MEDIA ADVISORY\nFOR IMMEDIATE RELEASE\n\n[CITY], ON – The [Month] Grand Prize has exceeded its $[Guarantee Amount] guarantee in record time, with ticket sales continuing to climb.\n\nWHAT: Grand Prize milestone announcement\n\nDETAILS:\n• The Grand Prize has surpassed $[Guarantee Amount] with days still remaining before the draw\n• This marks the fastest the program has reached this milestone\n• Final prize amount will be determined by total ticket sales (50% of proceeds)\n\nDRAW DATE: [Date] at [Draw Time]\n\nWHERE TO PURCHASE: [Organization Website] or at [In-Person Ticket Location]\n\nQUOTE: "The response from our supporters has been incredible," said [CEO/President Name], [CEO/President Title] of [Organization Name]. "We''re on track for one of our biggest Grand Prizes ever."\n\n-30-\n\nMedia Contact:\n[Media Contact Name]\n[Organization Name]\n[Media Contact Email]', '{"type": "Media Advisory"}', 5);

        -- ===== SOCIAL ADS =====
        INSERT INTO content_templates (organization_id, template_type, name, headline, content, metadata, sort_order) VALUES
        (NULL, 'social-ads', 'Value Proposition', '30 Chances to Win for Just $20', E'Support [cause area]. Win big.\n\n$20 = 30 numbers in EVERY draw this month.\n\nThat''s Early Birds AND the Grand Prize.\n\nGet tickets: [Organization Website]\n\nLicence #[Licence Number]', '{"type": "Value Proposition"}', 1),

        (NULL, 'social-ads', 'Grand Prize Focus', 'Grand Prize Over $[Current Amount]', E'The [Organization Name] Grand Prize is over $[Current Amount].\n\nCould you be our next big winner?\n\nTickets from $10 at [Organization Website]\n\nLicence #[Licence Number]', '{"type": "Grand Prize Focus"}', 2),

        (NULL, 'social-ads', 'Early Bird Focus', '$25,000 Early Bird This [Day]', E'This [Day]: $25,000 Early Bird draw!\n\nEvery ticket this month includes chances at ALL Early Birds plus the Grand Prize.\n\n[Organization Website]\n\nLicence #[Licence Number]', '{"type": "Early Bird Focus"}', 3),

        (NULL, 'social-ads', 'Impact Message', 'Win Big. Support [Cause Area].', E'Every [Organization Name] ticket supports [organization''s cause/mission].\n\nPlus, you could win the Grand Prize!\n\nTickets: [Organization Website]\n\nLicence #[Licence Number]', '{"type": "Impact Message"}', 4),

        (NULL, 'social-ads', 'Urgency/Deadline', 'Last Chance – Draw Tomorrow!', E'\u23F0 Ticket sales close TONIGHT!\n\nThe Grand Prize draw is tomorrow. Don''t miss your chance.\n\nGet tickets NOW: [Organization Website]\n\nLicence #[Licence Number]', '{"type": "Urgency/Deadline"}', 5);

        INSERT INTO _migration_flags (key, applied_at) VALUES ('010_seed_system_templates', NOW());
        RAISE NOTICE 'Content templates table created and system templates seeded successfully';

    ELSE
        RAISE NOTICE 'Skipping 010 system template seed - already applied';
    END IF;
END $$;

-- Seed Thunder Bay org-specific templates (copies of system templates customized for TB)
DO $$
DECLARE
    v_org_id UUID;
BEGIN
    SELECT id INTO v_org_id FROM organizations
    WHERE name ILIKE '%Thunder Bay Regional Health Sciences%'
    LIMIT 1;

    IF v_org_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM _migration_flags WHERE key = '010_seed_tb_templates'
    ) THEN
        -- Copy all system templates to TB's org as their starting set
        INSERT INTO content_templates (organization_id, template_type, name, subject, headline, content, metadata, sort_order)
        SELECT v_org_id, template_type, name, subject, headline, content, metadata, sort_order
        FROM content_templates
        WHERE organization_id IS NULL;

        INSERT INTO _migration_flags (key, applied_at) VALUES ('010_seed_tb_templates', NOW());
        RAISE NOTICE 'Thunder Bay org templates seeded from system templates';
    END IF;
END $$;
