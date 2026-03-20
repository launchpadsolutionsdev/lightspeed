jest.mock('../../src/services/logger', () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()
}));

const log = require('../../src/services/logger');

describe('claude service', () => {
    let generateResponse, generateWithKnowledge, pickRelevantKnowledge, pickRelevantRatedExamples, tagMatchFallback;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.ANTHROPIC_API_KEY = 'test-key';
        // Reset module so ANTHROPIC_API_KEY is re-read
        jest.resetModules();
        jest.mock('../../src/services/logger', () => ({
            debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()
        }));
        const claude = require('../../src/services/claude');
        generateResponse = claude.generateResponse;
        generateWithKnowledge = claude.generateWithKnowledge;
        pickRelevantKnowledge = claude.pickRelevantKnowledge;
        pickRelevantRatedExamples = claude.pickRelevantRatedExamples;
        tagMatchFallback = claude.tagMatchFallback;
        global.fetch = jest.fn();
    });

    afterEach(() => {
        delete global.fetch;
    });

    describe('tagMatchFallback', () => {
        const entries = [
            { title: 'Lottery Ticket Prices', tags: ['keyword:lottery', 'keyword:prices'], content: 'Price info' },
            { title: 'Return Policy', tags: ['keyword:returns'], content: 'Return info' },
            { title: 'Daily Draw Rules', tags: ['lottery:daily-draw'], content: 'Rules info' }
        ];

        it('scores entries by tag substring matching and returns top maxEntries', () => {
            const result = tagMatchFallback('lottery ticket pricing', entries, 2);
            expect(result).toHaveLength(2);
            // Lottery-related entries should score higher
            expect(result[0].title).toBe('Lottery Ticket Prices');
        });

        it('gives 3 points for direct substring match', () => {
            // "lottery" appears in inquiry and matches tag value "lottery"
            const result = tagMatchFallback('lottery', entries, 3);
            // Lottery Ticket Prices has tag keyword:lottery => value "lottery" is in inquiry => +3
            // Daily Draw Rules has tag lottery:daily-draw => value "daily-draw" not in "lottery"
            expect(result[0].title).toBe('Lottery Ticket Prices');
        });

        it('gives 1 point per token overlap', () => {
            // "draw" should match token in "daily-draw" tag value
            const result = tagMatchFallback('daily draw schedule', entries, 3);
            expect(result[0].title).toBe('Daily Draw Rules');
        });

        it('gives 1 point per title keyword match', () => {
            // "policy" matches in title "Return Policy"
            const result = tagMatchFallback('return policy question', entries, 3);
            expect(result[0].title).toBe('Return Policy');
        });

        it('sorts by score descending', () => {
            const result = tagMatchFallback('lottery ticket pricing', entries, 3);
            // First entry should have highest combined score
            expect(result[0].title).toBe('Lottery Ticket Prices');
        });

        it('returns top maxEntries entries', () => {
            const result = tagMatchFallback('something', entries, 1);
            expect(result).toHaveLength(1);
        });

        it('handles entries with no tags', () => {
            const noTagEntries = [
                { title: 'No Tags Entry', tags: [], content: 'Content' },
                { title: 'Lottery Info', tags: ['keyword:lottery'], content: 'Lottery content' }
            ];
            const result = tagMatchFallback('lottery', noTagEntries, 2);
            expect(result).toHaveLength(2);
            expect(result[0].title).toBe('Lottery Info');
        });

        it('handles entries with undefined tags', () => {
            const undefinedTagEntries = [
                { title: 'Test Entry', content: 'Content' }
            ];
            const result = tagMatchFallback('test', undefinedTagEntries, 1);
            expect(result).toHaveLength(1);
        });
    });

    describe('generateResponse', () => {
        it('throws if no API key', async () => {
            delete process.env.ANTHROPIC_API_KEY;
            jest.resetModules();
            jest.mock('../../src/services/logger', () => ({
                debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()
            }));
            const { generateResponse: genNoKey } = require('../../src/services/claude');
            global.fetch = jest.fn();

            await expect(genNoKey({ messages: [], system: 'test' }))
                .rejects.toThrow('ANTHROPIC_API_KEY not configured');
        });

        it('calls fetch with correct body and headers', async () => {
            const mockResponse = { id: 'msg_123', content: [{ text: 'Hello' }] };
            global.fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockResponse)
            });

            const messages = [{ role: 'user', content: 'Hi' }];
            const result = await generateResponse({ messages, system: 'Be helpful', max_tokens: 500 });

            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.anthropic.com/v1/messages',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'x-api-key': 'test-key',
                        'anthropic-version': '2023-06-01'
                    })
                })
            );

            const body = JSON.parse(global.fetch.mock.calls[0][1].body);
            expect(body.messages).toEqual(messages);
            expect(body.max_tokens).toBe(500);
            expect(body.system).toEqual([{
                type: 'text',
                text: 'Be helpful',
                cache_control: { type: 'ephemeral' }
            }]);
            expect(result).toEqual(mockResponse);
        });

        it('returns parsed JSON response', async () => {
            const mockResponse = { id: 'msg_456', content: [{ text: 'Response' }] };
            global.fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockResponse)
            });

            const result = await generateResponse({ messages: [{ role: 'user', content: 'Test' }] });
            expect(result).toEqual(mockResponse);
        });

        it('handles API errors (non-ok response)', async () => {
            global.fetch.mockResolvedValue({
                ok: false,
                status: 429,
                json: jest.fn().mockResolvedValue({ error: { message: 'Rate limited' } })
            });

            await expect(generateResponse({ messages: [{ role: 'user', content: 'Test' }] }))
                .rejects.toThrow('Rate limited');
        });

        it('handles API error with no message', async () => {
            global.fetch.mockResolvedValue({
                ok: false,
                status: 500,
                json: jest.fn().mockResolvedValue({})
            });

            await expect(generateResponse({ messages: [{ role: 'user', content: 'Test' }] }))
                .rejects.toThrow('API request failed with status 500');
        });

        it('includes tools in body when provided', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ id: 'msg_789' })
            });

            const tools = [{ name: 'get_weather', description: 'Get weather', input_schema: {} }];
            await generateResponse({ messages: [{ role: 'user', content: 'Test' }], tools });

            const body = JSON.parse(global.fetch.mock.calls[0][1].body);
            // Last tool gets cache_control appended for prompt caching
            expect(body.tools).toEqual([
                { ...tools[0], cache_control: { type: 'ephemeral' } }
            ]);
        });

        it('does not include tools key when tools is empty', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ id: 'msg_abc' })
            });

            await generateResponse({ messages: [{ role: 'user', content: 'Test' }], tools: [] });

            const body = JSON.parse(global.fetch.mock.calls[0][1].body);
            expect(body.tools).toBeUndefined();
        });

        it('uses default model when none specified', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ id: 'msg_def' })
            });

            await generateResponse({ messages: [{ role: 'user', content: 'Test' }] });

            const body = JSON.parse(global.fetch.mock.calls[0][1].body);
            expect(body.model).toBeDefined();
        });

        it('uses provided model override', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ id: 'msg_ghi' })
            });

            await generateResponse({ messages: [{ role: 'user', content: 'Test' }], model: 'claude-opus-4' });

            const body = JSON.parse(global.fetch.mock.calls[0][1].body);
            expect(body.model).toBe('claude-opus-4');
        });
    });

    describe('pickRelevantKnowledge', () => {
        const entries = [
            { title: 'Entry 1', category: 'FAQ', tags: ['keyword:test'], content: 'Content 1' },
            { title: 'Entry 2', category: 'FAQ', tags: ['keyword:other'], content: 'Content 2' },
            { title: 'Entry 3', category: 'FAQ', tags: ['keyword:more'], content: 'Content 3' }
        ];

        it('returns empty array for empty entries', async () => {
            const result = await pickRelevantKnowledge('test', [], 5);
            expect(result).toEqual([]);
        });

        it('returns empty array for null entries', async () => {
            const result = await pickRelevantKnowledge('test', null, 5);
            expect(result).toEqual([]);
        });

        it('returns all entries if count <= maxEntries', async () => {
            const result = await pickRelevantKnowledge('test', entries, 5);
            expect(result).toEqual(entries);
        });

        it('calls Haiku API and parses index array response', async () => {
            const manyEntries = Array.from({ length: 10 }, (_, i) => ({
                title: `Entry ${i}`, category: 'FAQ', tags: [], content: `Content ${i}`
            }));

            global.fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    content: [{ text: '[0, 2, 5]' }]
                })
            });

            const result = await pickRelevantKnowledge('test inquiry', manyEntries, 3);
            expect(result).toHaveLength(3);
            expect(result[0]).toEqual(manyEntries[0]);
            expect(result[1]).toEqual(manyEntries[2]);
            expect(result[2]).toEqual(manyEntries[5]);
        });

        it('falls back to tagMatchFallback on API failure', async () => {
            const manyEntries = Array.from({ length: 10 }, (_, i) => ({
                title: `Entry ${i}`, category: 'FAQ', tags: ['keyword:test'], content: `Content ${i}`
            }));

            global.fetch.mockResolvedValue({ ok: false, status: 500 });

            const result = await pickRelevantKnowledge('test', manyEntries, 3);
            expect(result).toHaveLength(3);
        });

        it('falls back on unexpected format (no JSON array)', async () => {
            const manyEntries = Array.from({ length: 10 }, (_, i) => ({
                title: `Entry ${i}`, category: 'FAQ', tags: ['keyword:test'], content: `Content ${i}`
            }));

            global.fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    content: [{ text: 'I think entries 0 and 2 are relevant' }]
                })
            });

            const result = await pickRelevantKnowledge('test', manyEntries, 3);
            // Should fall back to tagMatchFallback
            expect(result).toHaveLength(3);
        });

        it('falls back when fetch throws an error', async () => {
            const manyEntries = Array.from({ length: 10 }, (_, i) => ({
                title: `Entry ${i}`, category: 'FAQ', tags: ['keyword:test'], content: `Content ${i}`
            }));

            global.fetch.mockRejectedValue(new Error('Network error'));

            const result = await pickRelevantKnowledge('test', manyEntries, 3);
            expect(result).toHaveLength(3);
        });
    });

    describe('pickRelevantRatedExamples', () => {
        it('returns examples directly if pool is small enough', async () => {
            const positive = [{ inquiry: 'Q1', response: 'A1' }];
            const negative = [{ inquiry: 'Q2', response: 'A2' }];

            const result = await pickRelevantRatedExamples('test', positive, negative, 5, 3);
            expect(result.positive).toEqual(positive);
            expect(result.negative).toEqual(negative);
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('returns empty arrays if no examples', async () => {
            const result = await pickRelevantRatedExamples('test', [], [], 5, 3);
            expect(result.positive).toEqual([]);
            expect(result.negative).toEqual([]);
        });

        it('calls Haiku API for relevance picking when pool exceeds limits', async () => {
            const positive = Array.from({ length: 8 }, (_, i) => ({ inquiry: `Pos Q${i}`, response: `Pos A${i}` }));
            const negative = Array.from({ length: 5 }, (_, i) => ({ inquiry: `Neg Q${i}`, response: `Neg A${i}` }));

            // Positive indices are 0-7, negative indices are 8-12
            global.fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    content: [{ text: '[0, 2, 8, 10]' }]
                })
            });

            const result = await pickRelevantRatedExamples('test inquiry', positive, negative, 3, 2);
            expect(global.fetch).toHaveBeenCalled();
            // Should have picked positive indices 0, 2 and negative indices 8, 10
            expect(result.positive.length).toBeGreaterThan(0);
            expect(result.negative.length).toBeGreaterThan(0);
        });

        it('falls back to most recent on API failure', async () => {
            const positive = Array.from({ length: 8 }, (_, i) => ({ inquiry: `Pos Q${i}`, response: `Pos A${i}` }));
            const negative = Array.from({ length: 5 }, (_, i) => ({ inquiry: `Neg Q${i}`, response: `Neg A${i}` }));

            global.fetch.mockResolvedValue({ ok: false, status: 500 });

            const result = await pickRelevantRatedExamples('test', positive, negative, 3, 2);
            expect(result.positive).toHaveLength(3);
            expect(result.negative).toHaveLength(2);
            expect(result.positive).toEqual(positive.slice(0, 3));
            expect(result.negative).toEqual(negative.slice(0, 2));
        });

        it('falls back to most recent on fetch error', async () => {
            const positive = Array.from({ length: 8 }, (_, i) => ({ inquiry: `Pos Q${i}`, response: `Pos A${i}` }));
            const negative = Array.from({ length: 5 }, (_, i) => ({ inquiry: `Neg Q${i}`, response: `Neg A${i}` }));

            global.fetch.mockRejectedValue(new Error('Network error'));

            const result = await pickRelevantRatedExamples('test', positive, negative, 3, 2);
            expect(result.positive).toEqual(positive.slice(0, 3));
            expect(result.negative).toEqual(negative.slice(0, 2));
        });

        it('falls back on unexpected format', async () => {
            const positive = Array.from({ length: 8 }, (_, i) => ({ inquiry: `Pos Q${i}`, response: `Pos A${i}` }));
            const negative = Array.from({ length: 5 }, (_, i) => ({ inquiry: `Neg Q${i}`, response: `Neg A${i}` }));

            global.fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    content: [{ text: 'No relevant examples found' }]
                })
            });

            const result = await pickRelevantRatedExamples('test', positive, negative, 3, 2);
            expect(result.positive).toEqual(positive.slice(0, 3));
            expect(result.negative).toEqual(negative.slice(0, 2));
        });
    });
});
