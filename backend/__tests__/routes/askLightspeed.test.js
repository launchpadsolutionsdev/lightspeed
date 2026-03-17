/**
 * Ask Lightspeed Agentic Tests
 *
 * Tests for:
 * 1. alsNeedsAgenticMode() — frontend routing logic (extracted for testability)
 * 2. Tool executor functions — backend tool handlers
 * 3. Duplicate detection — calendar duplicate checking
 * 4. Confirmation flow — write action confirmation/cancellation
 */

// ─── 1. alsNeedsAgenticMode() — Agentic Routing Detection ───────────
//
// This function lives in frontend/app.js but we replicate it here for
// testability. If the implementation changes, update this copy too.

function alsNeedsAgenticMode(message) {
    if (!message) return false;
    const lower = message.toLowerCase();

    const patterns = [
        'add to runway', 'add to calendar', 'create event', 'schedule event', 'add event',
        'put on runway', 'put on calendar', 'add to the calendar', 'add to the runway',
        'what\'s on runway', 'what\'s scheduled', 'upcoming draws', 'upcoming events',
        'check the calendar', 'check runway', 'on the runway', 'on runway',
        'remember that', 'remember this', 'save to kb', 'save to knowledge base',
        'add to knowledge base', 'add to the knowledge base', 'our policy is', 'store this',
        'knowledge base entry', 'kb entry', 'save this to', 'add this to kb',
        'draft me', 'draft a', 'draft an', 'write me a', 'compose a', 'compose an',
        'write an email', 'write a response', 'write a post', 'draft email', 'draft response',
        'what did i write', 'what did we write', 'find my past', 'search my history',
        'previous response', 'past responses', 'what did i say about',
        'analyze this data', 'run insights', 'run analysis', 'analyze the data',
        'generate insights', 'data analysis'
    ];
    if (patterns.some(p => lower.includes(p))) return true;

    const regexPatterns = [
        // Calendar
        /add\b.*\b(?:to|on)\s+(?:the\s+)?runway/,
        /add\b.*\b(?:to|on)\s+(?:the\s+)?calendar/,
        /(?:schedule|create|put)\b.*\b(?:on|to|in)\s+(?:the\s+)?runway/,
        /(?:schedule|create|put)\b.*\b(?:on|to|in)\s+(?:the\s+)?calendar/,
        /(?:add|schedule|create)\b.*\bdraw\b/,
        /\bdraw\b.*\b(?:to|on)\s+(?:the\s+)?runway/,
        // Knowledge Base
        /(?:create|add|save|make|write)\b.*\b(?:knowledge\s*base|kb)\b/,
        /(?:knowledge\s*base|kb)\b.*\b(?:entry|article|record|item)\b/,
        /(?:save|store|add)\b.*\bfor\s+future\s+reference\b/,
    ];
    return regexPatterns.some(r => r.test(lower));
}

describe('alsNeedsAgenticMode — Agentic Routing Detection', () => {

    // ─── Null / empty input ──────────────────────────────────────────
    describe('returns false for empty/null input', () => {
        it('returns false for null', () => {
            expect(alsNeedsAgenticMode(null)).toBe(false);
        });
        it('returns false for undefined', () => {
            expect(alsNeedsAgenticMode(undefined)).toBe(false);
        });
        it('returns false for empty string', () => {
            expect(alsNeedsAgenticMode('')).toBe(false);
        });
    });

    // ─── Non-agentic messages (should NOT trigger) ───────────────────
    describe('returns false for non-agentic messages', () => {
        const nonAgenticMessages = [
            'What time does the office open?',
            'How do I reset my password?',
            'Tell me about AGCO regulations',
            'What is the refund policy?',
            'Hello, how are you?',
            'Can you explain lottery compliance?',
            'Who won the last draw?',
            'How many tickets were sold?',
            'What are the odds of winning?',
            'Thanks for your help!',
        ];

        nonAgenticMessages.forEach(msg => {
            it(`"${msg}" → false`, () => {
                expect(alsNeedsAgenticMode(msg)).toBe(false);
            });
        });
    });

    // ─── Calendar: create_runway_events ──────────────────────────────
    describe('Calendar — create events (triggers agentic)', () => {
        const calendarCreateMessages = [
            // Exact pattern matches
            'Add to Runway a draw for March 16',
            'Add to calendar: Draw #48 on June 15',
            'Create event for the next draw',
            'Schedule event on Runway for Friday',
            'Add event for the $2500 draw',
            'Put on Runway the draw schedule',
            'Put on calendar a reminder for the draw',
            'Add to the calendar a $5000 draw',
            'Add to the Runway our next draw',

            // THE BUG THAT WAS FIXED — words between "add" and "to runway"
            'Add a draw to Runway for March 16, $2500',
            'Add the $2500 draw to Runway',
            'Add a $5,000 jackpot draw to runway for next Friday',
            'Add our monthly draw to the runway',
            'Add the Early Bird draw to Runway for April 1',

            // Regex: schedule/create/put ... on/to/in runway
            'Schedule the next draw on Runway',
            'Schedule a $10,000 draw on the runway',
            'Create a draw event on Runway',
            'Put the March draw on Runway',
            'Put our next draw in the calendar',

            // Regex: add/schedule/create ... draw
            'Add a draw for next week',
            'Schedule a draw for March 20',
            'Create a new draw for April',

            // Regex: draw ... to/on runway
            'Draw #48 needs to go on Runway',
            'The $2500 draw should be on runway',

            // Mixed case
            'ADD A DRAW TO RUNWAY FOR MARCH 16',
            'Add A Draw To The Calendar',
        ];

        calendarCreateMessages.forEach(msg => {
            it(`"${msg}" → true`, () => {
                expect(alsNeedsAgenticMode(msg)).toBe(true);
            });
        });
    });

    // ─── Calendar: search_runway_events ──────────────────────────────
    describe('Calendar — search events (triggers agentic)', () => {
        const calendarSearchMessages = [
            "What's on Runway this week?",
            "What's scheduled for March?",
            'Show me the upcoming draws',
            'Any upcoming events this month?',
            'Check the calendar for next week',
            'Check Runway for draws',
            "What's on the runway for April?",
            'Is there anything on Runway tomorrow?',
        ];

        calendarSearchMessages.forEach(msg => {
            it(`"${msg}" → true`, () => {
                expect(alsNeedsAgenticMode(msg)).toBe(true);
            });
        });
    });

    // ─── Knowledge Base: save_to_knowledge_base ──────────────────────
    describe('Knowledge Base — save (triggers agentic)', () => {
        const kbSaveMessages = [
            'Remember that our office hours are 9-5',
            'Remember this: tickets expire after 30 days',
            'Save to KB: our refund policy is 14 days',
            'Save to Knowledge Base this new procedure',
            'Add to knowledge base our new FAQ',
            'Add to the knowledge base our eligibility rules',
            'Our policy is to refund within 7 business days',
            'Store this information for future reference',
            'Save this to the knowledge base',
            'Add this to KB please',

            // THE BUG THAT WAS REPORTED — "create a knowledge base entry"
            'Can you create a knowledge base entry? Hospital board members are not eligible',
            'Create a KB entry for our refund policy',
            'Make a knowledge base entry about ticket eligibility',
            'Write a KB entry about our office hours',
            'Save this for future reference: board members cannot win',
            'Add a knowledge base article about our lottery rules',
        ];

        kbSaveMessages.forEach(msg => {
            it(`"${msg}" → true`, () => {
                expect(alsNeedsAgenticMode(msg)).toBe(true);
            });
        });
    });

    // ─── Content Drafting: draft_content ─────────────────────────────
    describe('Content Drafting (triggers agentic)', () => {
        const draftMessages = [
            'Draft me an email to the winner',
            'Draft a response to this customer',
            'Draft an announcement about the new draw',
            'Write me a social media post about the jackpot',
            'Compose a thank you email',
            'Compose an announcement for the team',
            'Write an email to the ticket buyer',
            'Write a response to this complaint',
            'Write a post about our charity event',
            'Draft email to the vendor',
            'Draft response to the customer inquiry',
        ];

        draftMessages.forEach(msg => {
            it(`"${msg}" → true`, () => {
                expect(alsNeedsAgenticMode(msg)).toBe(true);
            });
        });
    });

    // ─── Response History: search_response_history ────────────────────
    describe('Response History — search (triggers agentic)', () => {
        const historyMessages = [
            'What did I write about the refund policy last week?',
            'What did we write to that customer?',
            'Find my past responses about draws',
            'Search my history for emails about winners',
            'Show me the previous response we sent',
            'Find past responses about ticket sales',
            'What did I say about the Early Bird deadline?',
        ];

        historyMessages.forEach(msg => {
            it(`"${msg}" → true`, () => {
                expect(alsNeedsAgenticMode(msg)).toBe(true);
            });
        });
    });

    // ─── Insights: run_insights_analysis ─────────────────────────────
    describe('Insights Analysis (triggers agentic)', () => {
        const insightsMessages = [
            'Analyze this data from our last campaign',
            'Run insights on the seller performance spreadsheet',
            'Run analysis on the customer list',
            'Analyze the data I just uploaded',
            'Generate insights from this report',
            'Can you do a data analysis on these numbers?',
        ];

        insightsMessages.forEach(msg => {
            it(`"${msg}" → true`, () => {
                expect(alsNeedsAgenticMode(msg)).toBe(true);
            });
        });
    });

    // ─── Edge cases ──────────────────────────────────────────────────
    describe('Edge cases', () => {
        it('handles message with lots of whitespace', () => {
            expect(alsNeedsAgenticMode('   add to runway   the draw   ')).toBe(true);
        });

        it('handles message with punctuation around keywords', () => {
            expect(alsNeedsAgenticMode('Can you add to runway? A draw for March 16.')).toBe(true);
        });

        it('handles multi-line messages', () => {
            expect(alsNeedsAgenticMode('Hey,\nCan you add a draw to runway?\nThanks')).toBe(true);
        });

        it('does NOT trigger on partial keyword overlap', () => {
            // "runway" alone shouldn't trigger (it's just mentioning the feature)
            expect(alsNeedsAgenticMode('How does Runway work?')).toBe(false);
        });

        it('does NOT trigger on "draw" alone without action verb', () => {
            expect(alsNeedsAgenticMode('When is the next draw?')).toBe(false);
        });

        it('handles the exact user message that caused the original bug', () => {
            expect(alsNeedsAgenticMode('add a draw to runway for March 16, $2500')).toBe(true);
        });
    });
});


// ─── 2. Backend Tool Executors ───────────────────────────────────────
//
// These tests mock the database pool and claude service to test the
// tool executor functions in isolation.

const pool = require('../../config/database');

// Mock database
jest.mock('../../config/database', () => ({
    query: jest.fn()
}));

// Mock auth middleware — passthrough that sets userId/orgId
jest.mock('../../src/middleware/auth', () => ({
    authenticate: (req, _res, next) => {
        req.userId = 1;
        req.organizationId = 'org-uuid-123';
        req.organizationName = 'Test Lottery Org';
        next();
    },
    checkUsageLimit: (_req, _res, next) => next()
}));

// Mock claude service
jest.mock('../../src/services/claude', () => ({
    generateResponse: jest.fn(),
    pickRelevantKnowledge: jest.fn(),
    tagMatchFallback: jest.fn()
}));

// Mock promptBuilder
jest.mock('../../src/services/promptBuilder', () => ({
    buildEnhancedPrompt: jest.fn().mockResolvedValue({ system: 'test system', referencedKbEntries: [], contextSummary: {} })
}));

// Mock systemPromptBuilder
jest.mock('../../src/services/systemPromptBuilder', () => ({
    buildResponseAssistantPrompt: jest.fn().mockResolvedValue({ systemPrompt: 'test', userPrompt: 'test', maxTokens: 1024 }),
    buildCalendarContext: jest.fn()
}));

const supertest = require('supertest');
const express = require('express');

// We need to require the route AFTER mocking dependencies
let askLightspeedRouter;
let app;

beforeAll(() => {
    askLightspeedRouter = require('../../src/routes/askLightspeed');
    app = express();
    app.use(express.json());
    app.use('/api/ask-lightspeed', askLightspeedRouter);
});

beforeEach(() => {
    jest.clearAllMocks();
});

describe('POST /api/ask-lightspeed/confirm-action — Create Runway Events', () => {
    it('creates events and returns success summary', async () => {
        const events = [
            { title: '$2,500 Draw', event_date: '2026-03-16', category: 'Draw', color: 'blue', all_day: true }
        ];

        // Mock org lookup
        pool.query.mockResolvedValueOnce({ rows: [{ organization_id: 'org-uuid-123' }] });

        // Mock event insert
        pool.query.mockResolvedValueOnce({
            rows: [{ id: 'evt-1', title: '$2,500 Draw', event_date: '2026-03-16', event_time: null, all_day: true, category: 'Draw', color: 'blue' }]
        });

        // Mock claude response for summary
        const claudeService = require('../../src/services/claude');
        claudeService.generateResponse.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'Created 1 event on Runway!' }],
            usage: { input_tokens: 100, output_tokens: 50 }
        });

        const res = await supertest(app)
            .post('/api/ask-lightspeed/confirm-action')
            .send({ action: 'create_runway_events', events })
            .expect(200);

        // SSE response — collect events
        const lines = res.text.split('\n').filter(l => l.startsWith('data: '));
        const sseEvents = lines.map(l => JSON.parse(l.slice(6)));

        // Should have status, text, events_created, done events
        const types = sseEvents.map(e => e.type);
        expect(types).toContain('status');
        expect(types).toContain('text');
        expect(types).toContain('events_created');
        expect(types).toContain('done');

        // Verify event was created in DB
        const insertCall = pool.query.mock.calls.find(c =>
            typeof c[0] === 'string' && c[0].includes('INSERT INTO calendar_events')
        );
        expect(insertCall).toBeTruthy();
        expect(insertCall[1]).toContain('$2,500 Draw');
        expect(insertCall[1]).toContain('2026-03-16');
    });

    it('validates color — defaults to blue for invalid colors', async () => {
        const events = [
            { title: 'Test Draw', event_date: '2026-04-01', color: 'rainbow' }
        ];

        pool.query.mockResolvedValueOnce({ rows: [{ organization_id: 'org-uuid-123' }] });
        pool.query.mockResolvedValueOnce({
            rows: [{ id: 'evt-1', title: 'Test Draw', event_date: '2026-04-01', all_day: true, category: 'Draw', color: 'blue' }]
        });

        const claudeService = require('../../src/services/claude');
        claudeService.generateResponse.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'Done!' }],
            usage: {}
        });

        await supertest(app)
            .post('/api/ask-lightspeed/confirm-action')
            .send({ action: 'create_runway_events', events })
            .expect(200);

        const insertCall = pool.query.mock.calls.find(c =>
            typeof c[0] === 'string' && c[0].includes('INSERT INTO calendar_events')
        );
        // Color param should be 'blue' (default), not 'rainbow'
        expect(insertCall[1]).toContain('blue');
        expect(insertCall[1]).not.toContain('rainbow');
    });

    it('creates multiple events in one request', async () => {
        const events = [
            { title: 'Draw #1', event_date: '2026-03-16', category: 'Draw' },
            { title: 'Draw #2', event_date: '2026-03-23', category: 'Draw' },
            { title: 'Draw #3', event_date: '2026-03-30', category: 'Draw' },
        ];

        pool.query.mockResolvedValueOnce({ rows: [{ organization_id: 'org-uuid-123' }] });
        // 3 inserts
        for (let i = 0; i < 3; i++) {
            pool.query.mockResolvedValueOnce({
                rows: [{ id: `evt-${i}`, title: events[i].title, event_date: events[i].event_date, all_day: true, category: 'Draw', color: 'blue' }]
            });
        }

        const claudeService = require('../../src/services/claude');
        claudeService.generateResponse.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'Created 3 events!' }],
            usage: {}
        });

        const res = await supertest(app)
            .post('/api/ask-lightspeed/confirm-action')
            .send({ action: 'create_runway_events', events })
            .expect(200);

        const lines = res.text.split('\n').filter(l => l.startsWith('data: '));
        const sseEvents = lines.map(l => JSON.parse(l.slice(6)));
        const createdEvent = sseEvents.find(e => e.type === 'events_created');
        expect(createdEvent.count).toBe(3);
    });

    it('rejects invalid action type', async () => {
        const res = await supertest(app)
            .post('/api/ask-lightspeed/confirm-action')
            .send({ action: 'delete_everything', events: [] })
            .expect(200);

        const lines = res.text.split('\n').filter(l => l.startsWith('data: '));
        const sseEvents = lines.map(l => JSON.parse(l.slice(6)));
        expect(sseEvents.some(e => e.type === 'error')).toBe(true);
    });

    it('rejects missing events array', async () => {
        const res = await supertest(app)
            .post('/api/ask-lightspeed/confirm-action')
            .send({ action: 'create_runway_events' })
            .expect(200);

        const lines = res.text.split('\n').filter(l => l.startsWith('data: '));
        const sseEvents = lines.map(l => JSON.parse(l.slice(6)));
        expect(sseEvents.some(e => e.type === 'error')).toBe(true);
    });
});

describe('POST /api/ask-lightspeed/confirm-action — Save to Knowledge Base', () => {
    it('saves KB entry and returns success', async () => {
        const kbEntry = {
            title: 'Office Hours Policy',
            content: 'Our office hours are Monday to Friday, 9 AM to 5 PM.',
            category: 'policies',
            tags: ['office', 'hours']
        };

        pool.query.mockResolvedValueOnce({
            rows: [{ id: 'kb-1', title: 'Office Hours Policy', category: 'policies' }]
        });

        const res = await supertest(app)
            .post('/api/ask-lightspeed/confirm-action')
            .send({ action: 'save_to_knowledge_base', kbEntry })
            .expect(200);

        const lines = res.text.split('\n').filter(l => l.startsWith('data: '));
        const sseEvents = lines.map(l => JSON.parse(l.slice(6)));

        expect(sseEvents.some(e => e.type === 'text' && e.content.includes('Knowledge Base'))).toBe(true);
        expect(sseEvents.some(e => e.type === 'kb_saved')).toBe(true);
        expect(sseEvents.some(e => e.type === 'done')).toBe(true);

        // Verify insert was called
        const insertCall = pool.query.mock.calls.find(c =>
            typeof c[0] === 'string' && c[0].includes('INSERT INTO knowledge_base')
        );
        expect(insertCall).toBeTruthy();
        expect(insertCall[1]).toContain('Office Hours Policy');
    });
});

describe('POST /api/ask-lightspeed/cancel-action', () => {
    it('returns cancellation message', async () => {
        const res = await supertest(app)
            .post('/api/ask-lightspeed/cancel-action')
            .expect(200);

        expect(res.body.message).toBeTruthy();
        expect(res.body.message).toContain('didn\'t create');
    });
});


// ─── 3. Tool Definitions Validation ──────────────────────────────────

describe('Tool Definitions', () => {
    // Re-read the TOOLS array from the source to validate structure
    const fs = require('fs');
    const source = fs.readFileSync(require.resolve('../../src/routes/askLightspeed'), 'utf-8');

    it('defines create_runway_events tool', () => {
        expect(source).toContain("name: 'create_runway_events'");
    });

    it('defines search_runway_events tool', () => {
        expect(source).toContain("name: 'search_runway_events'");
    });

    it('defines search_knowledge_base tool', () => {
        expect(source).toContain("name: 'search_knowledge_base'");
    });

    it('defines draft_content tool', () => {
        expect(source).toContain("name: 'draft_content'");
    });

    it('defines save_to_knowledge_base tool', () => {
        expect(source).toContain("name: 'save_to_knowledge_base'");
    });

    it('defines search_response_history tool', () => {
        expect(source).toContain("name: 'search_response_history'");
    });

    it('defines run_insights_analysis tool', () => {
        expect(source).toContain("name: 'run_insights_analysis'");
    });

    it('defines search_home_base tool', () => {
        expect(source).toContain("name: 'search_home_base'");
    });

    it('has exactly 10 tools defined', () => {
        const toolCount = (source.match(/name: '/g) || []).length;
        // The TOOLS array should have 10 entries
        // (name: ' appears for each tool definition plus maybe elsewhere, so check the TOOLS array)
        expect(source).toContain('const TOOLS = [');
        // Count tool objects by looking for 'input_schema'
        const schemaCount = (source.match(/input_schema:/g) || []).length;
        expect(schemaCount).toBe(10);
    });

    it('requires confirmation for write tools (create_runway_events, save_to_knowledge_base)', () => {
        // The processResponse function should send 'confirm' events for write tools
        expect(source).toContain("type: 'confirm'");
        expect(source).toContain("action: 'create_runway_events'");
        expect(source).toContain("action: 'save_to_knowledge_base'");
    });

    it('executes read tools immediately without confirmation', () => {
        // search_runway_events, search_knowledge_base, draft_content should NOT send confirm
        // They should call their executor and loop back to Claude
        expect(source).toContain("'Searching Runway calendar...'");
        expect(source).toContain("'Searching Knowledge Base...'");
        expect(source).toContain("'Drafting content with brand voice...'");
        expect(source).toContain("'Searching past responses...'");
        expect(source).toContain("'Running insights analysis...'");
        expect(source).toContain("'Searching Home Base...'");
    });
});


// ─── 4. Agentic System Prompt Validation ─────────────────────────────

describe('Agentic System Prompt', () => {
    const fs = require('fs');
    const source = fs.readFileSync(require.resolve('../../src/routes/askLightspeed'), 'utf-8');

    it('mentions all tool names in the system prompt', () => {
        expect(source).toContain('search_runway_events');
        expect(source).toContain('create_runway_events');
        expect(source).toContain('search_knowledge_base');
        expect(source).toContain('save_to_knowledge_base');
        expect(source).toContain('draft_content');
        expect(source).toContain('search_response_history');
        expect(source).toContain('run_insights_analysis');
    });

    it('tells AI the system handles confirmation (not text-based)', () => {
        expect(source).toContain('confirmation dialog');
        expect(source).toContain('Do NOT ask for confirmation in text');
    });

    it('instructs AI to call write tools directly', () => {
        expect(source).toContain('Call this tool directly');
    });

    it('sets Draw as default category for draw events', () => {
        expect(source).toContain("'Draw'");
    });
});


// ─── 5. Frontend Non-Agentic Fallback Prompt ─────────────────────────

describe('Non-Agentic Fallback Prompt (frontend)', () => {
    const fs = require('fs');
    const frontendSource = fs.readFileSync(
        require('path').join(__dirname, '../../../frontend/app.js'),
        'utf-8'
    );

    it('tells the AI it CAN add events to Runway', () => {
        expect(frontendSource).toContain('you CAN do that');
    });

    it('tells the AI to NEVER say it cannot add events', () => {
        expect(frontendSource).toContain('Never tell the user you cannot add events to Runway');
    });

    it('suggests rephrasing with "add to Runway" if tools do not activate', () => {
        expect(frontendSource).toContain('add to Runway');
        expect(frontendSource).toContain('add to calendar');
    });

    it('lists Runway event creation as a capability', () => {
        expect(frontendSource).toContain('creates Runway calendar events');
    });
});


// ─── 6. Agentic Prompt — No Text Confirmation ───────────────────────

describe('Agentic prompts instruct direct tool calls (no text confirmation)', () => {
    const fs = require('fs');
    const frontendSource = fs.readFileSync(
        require('path').join(__dirname, '../../../frontend/app.js'),
        'utf-8'
    );
    const backendSource = fs.readFileSync(require.resolve('../../src/routes/askLightspeed'), 'utf-8');

    it('frontend agentic prompt says system handles confirmation', () => {
        expect(frontendSource).toContain('system shows a confirmation dialog');
    });

    it('frontend agentic prompt says do NOT ask in text', () => {
        expect(frontendSource).toContain('do NOT ask in text first');
    });

    it('backend tool description for create_runway_events says call directly', () => {
        expect(backendSource).toContain('Call this tool directly with the events');
        expect(backendSource).toContain('Do NOT ask for confirmation in text first; just call the tool');
    });

    it('backend tool description for save_to_knowledge_base says call directly', () => {
        expect(backendSource).toContain('Call this tool directly — the system will show the user a confirmation dialog before saving');
    });

    it('backend system prompt says call tool directly for write actions', () => {
        expect(backendSource).toContain('call the tool directly');
        expect(backendSource).toContain('Do NOT ask "shall I go ahead?"');
    });

    it('frontend tracks agentic conversation state', () => {
        expect(frontendSource).toContain('alsConversationUsedAgentic');
    });

    it('frontend uses agentic state in routing decision', () => {
        expect(frontendSource).toContain('|| alsConversationUsedAgentic');
    });

    it('frontend resets agentic state on new chat', () => {
        // Should appear in clearAlsChat
        expect(frontendSource).toContain('alsConversationUsedAgentic = false');
    });
});
