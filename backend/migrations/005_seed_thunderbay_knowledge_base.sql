-- Seed Thunder Bay Regional Health Sciences Foundation org-specific knowledge base entries
-- These entries are only inserted if the TBRHSF organization exists in the database
-- They supplement the generic hardcoded KB with org-specific details

DO $$
DECLARE
    v_org_id UUID;
BEGIN
    -- Find the Thunder Bay org
    SELECT id INTO v_org_id FROM organizations
    WHERE name ILIKE '%Thunder Bay Regional Health Sciences%'
    LIMIT 1;

    -- Only seed if the org exists and hasn't been seeded yet
    IF v_org_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM _migration_flags WHERE key = '005_seed_tb_kb'
    ) THEN

        -- ===== 50/50 LOTTERY SPECIFIC ENTRIES =====

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Thunder Bay 50/50 - Website and Purchase Info',
         'Our lottery website is www.thunderbay5050.ca where customers can purchase tickets online. Tickets can also be purchased at the Thunder Bay 50/50 store inside Intercity Shopping Centre. Account management is at https://account.tbay5050draw.ca',
         'general',
         ARRAY['lottery:5050', 'keyword:website', 'keyword:purchase', 'keyword:store', 'keyword:intercity', 'keyword:buy tickets', 'keyword:online']);

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Thunder Bay 50/50 - Draw Schedule',
         'Our draws happen throughout the month with multiple Early Bird draws plus the Grand Prize draw at the end of each month. All draws take place at 11:00 AM, and the deadline to purchase tickets is 11:59 PM the night before. For the full schedule visit www.thunderbay5050.ca.',
         'general',
         ARRAY['lottery:5050', 'keyword:draw', 'keyword:schedule', 'keyword:when', 'keyword:early bird', 'keyword:grand prize', 'keyword:time', 'keyword:deadline']);

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Thunder Bay 50/50 - Ticket Pricing',
         'A $20 ticket gets you 30 numbers in every draw - that includes all the Early Birds AND the Grand Prize. Tickets start at $10.',
         'general',
         ARRAY['lottery:5050', 'keyword:price', 'keyword:cost', 'keyword:how much', 'keyword:ticket price', 'keyword:numbers', 'keyword:$20', 'keyword:$10']);

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Thunder Bay 50/50 - Support Contact Info',
         'For customer support, email info@thunderbay5050.ca. For Facebook comments, always direct customers to email for account-related issues: "Please email us at info@thunderbay5050.ca and our team will assist you as soon as possible." Never handle sensitive account matters on public social media.',
         'general',
         ARRAY['lottery:5050', 'keyword:email', 'keyword:contact', 'keyword:support', 'keyword:help', 'keyword:facebook', 'keyword:social media']);

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Thunder Bay 50/50 - Organization Mission',
         'The Thunder Bay Regional Health Sciences Foundation raises funds to support Thunder Bay Regional Health Sciences Centre, Northwestern Ontario''s largest hospital. Lottery proceeds help provide vital equipment, programs, and services that make a real difference in our community. Every ticket purchased helps fund life-saving healthcare equipment.',
         'general',
         ARRAY['lottery:5050', 'keyword:mission', 'keyword:purpose', 'keyword:funds', 'keyword:hospital', 'keyword:healthcare', 'keyword:impact', 'keyword:where does money go', 'keyword:proceeds']);

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Thunder Bay 50/50 - Mobile App Info',
         'We don''t have a dedicated mobile app, but www.thunderbay5050.ca is fully mobile-responsive and works great on smartphones and tablets. Customers can add the website to their home screen for quick access.',
         'general',
         ARRAY['lottery:5050', 'keyword:mobile', 'keyword:app', 'keyword:phone', 'keyword:android', 'keyword:iphone', 'keyword:tablet']);

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Thunder Bay 50/50 - Subscription Setup',
         'To subscribe, go to www.thunderbay5050.ca and select your ticket package. During checkout, there is a checkbox option at the bottom of the page just above the "Buy Tickets" button. Selecting this signs you up for a subscription. Manage subscriptions at https://account.tbay5050draw.ca.',
         'general',
         ARRAY['lottery:5050', 'keyword:subscribe', 'keyword:subscription', 'keyword:how to subscribe', 'keyword:automatic', 'keyword:recurring']);

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Thunder Bay 50/50 - EastLink Internet Issue',
         'EastLink internet customers may experience location blocking issues because EastLink IP addresses sometimes register as being outside of Ontario. The solution is to contact EastLink directly at 1-888-345-1111 and ask them to correct this. Alternatively, customers can use mobile data or a different internet connection.',
         'general',
         ARRAY['lottery:5050', 'keyword:eastlink', 'keyword:east link', 'keyword:internet', 'keyword:location', 'keyword:blocked']);

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Thunder Bay 50/50 - Licence Information',
         'Our lottery is licensed by the Alcohol and Gaming Commission of Ontario (AGCO). Licence #RAF1296922. The lottery supports the Thunder Bay Regional Health Sciences Foundation, a registered charitable organization. All draws use AGCO-approved electronic raffle systems.',
         'general',
         ARRAY['lottery:5050', 'keyword:licence', 'keyword:license', 'keyword:AGCO', 'keyword:legitimate', 'keyword:legal', 'keyword:regulated']);

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Thunder Bay 50/50 - Eligibility',
         'To purchase tickets you must: be 18 years of age or older, be physically located in Ontario at the time of purchase, and not be an employee or immediate family member of the Thunder Bay Regional Health Sciences Foundation or the lottery operator.',
         'general',
         ARRAY['lottery:5050', 'keyword:eligibility', 'keyword:who can play', 'keyword:age', 'keyword:requirement', 'keyword:18']);

        -- ===== CATCH THE ACE SPECIFIC ENTRIES =====

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Catch the Ace - Website and Info',
         'The Thunder Bay Catch The Ace lottery website is www.thunderbaycatchtheace.ca. It is a weekly progressive lottery that supports the Our Hearts at Home Campaign to bring Cardiovascular Surgery to Northwestern Ontario. We''ve awarded over $500,000 in prizes.',
         'general',
         ARRAY['lottery:cta', 'keyword:catch the ace', 'keyword:website', 'keyword:hearts', 'keyword:cardiovascular']);

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Catch the Ace - Weekly Draw Schedule',
         'Our weekly Catch the Ace draw takes place at 11:00 AM. The deadline to purchase tickets is 11:59 PM the night before each draw. You can watch the draw live on our website or social media channels. The winning ticket number and revealed card are posted on our website shortly after.',
         'general',
         ARRAY['lottery:cta', 'keyword:draw', 'keyword:when', 'keyword:schedule', 'keyword:time', 'keyword:weekly']);

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Catch the Ace - Subscription Management',
         'For Catch the Ace subscriptions, visit www.thunderbaycatchtheace.ca and click "Manage Subscriptions" at the top of the page. You can also manage at https://account.tbay5050draw.ca.',
         'general',
         ARRAY['lottery:cta', 'keyword:subscription', 'keyword:manage', 'keyword:cancel', 'keyword:automatic']);

        -- ===== BRAND VOICE / COMMUNICATION STYLE =====

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Brand Voice and Terminology',
         'IMPORTANT TERMINOLOGY: Always use "Grand Prize" instead of "jackpot". Use "Deadline" instead of "ends". Use "Live" instead of "starts". Maximum 2 emojis per social post. All social posts MUST include licence disclaimer at end. Social media posts should use short paragraph form with line breaks.',
         'general',
         ARRAY['keyword:brand', 'keyword:voice', 'keyword:terminology', 'keyword:style', 'keyword:guidelines']);

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Social Media Required Line',
         'Every social media post MUST include this line: "Purchase tickets online at www.thunderbay5050.ca or at the Thunder Bay 50/50 store inside the Intercity Shopping Centre!" All social posts must end with the licence disclaimer: Licence #RAF1296922',
         'general',
         ARRAY['keyword:social media', 'keyword:required', 'keyword:facebook', 'keyword:instagram', 'keyword:post']);

        INSERT INTO knowledge_base (organization_id, title, content, category, tags) VALUES
        (v_org_id,
         'Media Contact Information',
         'Media Contact: Torin Gunnell, Communications Officer, Thunder Bay Regional Health Sciences Foundation, tgunnell@tbrhsc.net. CEO/President: Glenn Craig, President & CEO of the Thunder Bay Regional Health Sciences Foundation.',
         'general',
         ARRAY['keyword:media', 'keyword:contact', 'keyword:press', 'keyword:release', 'keyword:torin', 'keyword:glenn']);

        INSERT INTO _migration_flags (key, applied_at) VALUES ('005_seed_tb_kb', NOW());
        RAISE NOTICE 'Thunder Bay knowledge base entries seeded successfully';

    ELSE
        IF v_org_id IS NULL THEN
            RAISE NOTICE 'Skipping TB KB seed - Thunder Bay org not found yet';
        ELSE
            RAISE NOTICE 'Skipping TB KB seed - already applied';
        END IF;
    END IF;
END $$;
