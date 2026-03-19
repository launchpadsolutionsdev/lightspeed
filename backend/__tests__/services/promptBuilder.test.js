jest.mock('../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/services/claude', () => ({ pickRelevantKnowledge: jest.fn(), tagMatchFallback: jest.fn() }));
jest.mock('../../src/services/shopify', () => ({ buildContextForInquiry: jest.fn() }));
jest.mock('../../src/services/cache', () => ({ cache: { get: jest.fn(), set: jest.fn(), invalidatePrefix: jest.fn() }, TTL: { RESPONSE_RULES: 300000 } }));
jest.mock('../../src/services/tokenCounter', () => ({ truncateEntriesToBudget: jest.fn(entries => entries) }));
jest.mock('../../src/services/conversationMemory', () => ({ getConversationMemory: jest.fn(), getCrossToolContext: jest.fn() }));
jest.mock('../../src/services/voiceFingerprint', () => ({ getVoiceProfileContext: jest.fn() }));
jest.mock('../../src/services/embeddingService', () => ({ embedQuery: jest.fn(), formatForPgvector: jest.fn() }));
jest.mock('../../src/services/systemPromptBuilder', () => ({ fetchRelevantCorrections: jest.fn(), buildCorrectionsContext: jest.fn(), buildCalendarContext: jest.fn() }));
jest.mock('../../src/services/budgetAllocator', () => ({ getBudgetAllocation: jest.fn(() => ({ budgets: { knowledgeBase: 25000, maxKbEntries: 8 } })) }));
jest.mock('../../src/services/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const pool = require('../../config/database');
const claudeService = require('../../src/services/claude');
const shopifyService = require('../../src/services/shopify');
const { cache, TTL } = require('../../src/services/cache');
const { getConversationMemory, getCrossToolContext } = require('../../src/services/conversationMemory');
const { getVoiceProfileContext } = require('../../src/services/voiceFingerprint');
const { fetchRelevantCorrections, buildCorrectionsContext, buildCalendarContext } = require('../../src/services/systemPromptBuilder');

const {
    buildEnhancedPrompt,
    injectResponseRules,
    injectKnowledgeBase,
    injectShopifyContext,
    TOOL_CONTEXT_CONFIG
} = require('../../src/services/promptBuilder');

describe('promptBuilder', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        cache.get.mockReturnValue(undefined);
        getConversationMemory.mockResolvedValue('');
        getCrossToolContext.mockResolvedValue('');
        getVoiceProfileContext.mockResolvedValue('');
        fetchRelevantCorrections.mockResolvedValue([]);
        buildCorrectionsContext.mockReturnValue('');
        buildCalendarContext.mockResolvedValue('');
    });

    describe('TOOL_CONTEXT_CONFIG', () => {
        it('has configuration for response_assistant', () => {
            expect(TOOL_CONTEXT_CONFIG.response_assistant).toBeDefined();
            expect(TOOL_CONTEXT_CONFIG.response_assistant.kb).toBe(true);
            expect(TOOL_CONTEXT_CONFIG.response_assistant.rules).toBe(true);
            expect(TOOL_CONTEXT_CONFIG.response_assistant.shopify).toBe(true);
        });

        it('has configuration for list_normalizer with all false', () => {
            const config = TOOL_CONTEXT_CONFIG.list_normalizer;
            expect(config).toBeDefined();
            expect(config.kb).toBe(false);
            expect(config.rules).toBe(false);
            expect(config.shopify).toBe(false);
            expect(config.calendar).toBe(false);
            expect(config.memory).toBe(false);
            expect(config.crossTool).toBe(false);
            expect(config.voice).toBe(false);
            expect(config.corrections).toBe(false);
        });

        it('has configuration for insights_engine with light KB', () => {
            expect(TOOL_CONTEXT_CONFIG.insights_engine.kb).toBe('light');
            expect(TOOL_CONTEXT_CONFIG.insights_engine.rules).toBe(false);
            expect(TOOL_CONTEXT_CONFIG.insights_engine.shopify).toBe(false);
        });

        it('has all expected tool keys', () => {
            expect(Object.keys(TOOL_CONTEXT_CONFIG)).toEqual(
                expect.arrayContaining(['response_assistant', 'ask_lightspeed', 'draft_assistant', 'insights_engine', 'list_normalizer'])
            );
        });
    });

    describe('injectResponseRules', () => {
        it('fetches rules from DB and formats with type labels', async () => {
            pool.query.mockResolvedValue({
                rows: [
                    { rule_text: 'Always greet the customer', rule_type: 'always' },
                    { rule_text: 'Never discuss competitors', rule_type: 'never' },
                    { rule_text: 'Use bullet points', rule_type: 'formatting' }
                ]
            });

            const system = 'Base system prompt.\n\nKnowledge base:\nSome KB content';
            const result = await injectResponseRules(system, 'org-123');

            expect(result).toContain('[ALWAYS] Always greet the customer');
            expect(result).toContain('[NEVER] Never discuss competitors');
            expect(result).toContain('[FORMATTING] Use bullet points');
            expect(result).toContain('ORGANIZATION RESPONSE RULES');
        });

        it('inserts rules before KB marker', async () => {
            pool.query.mockResolvedValue({
                rows: [{ rule_text: 'Be friendly', rule_type: 'general' }]
            });

            const system = 'System prompt.\n\nKnowledge base:\nKB content here';
            const result = await injectResponseRules(system, 'org-123');

            const rulesPos = result.indexOf('ORGANIZATION RESPONSE RULES');
            const kbPos = result.indexOf('Knowledge base:');
            expect(rulesPos).toBeLessThan(kbPos);
        });

        it('returns unchanged system on empty rules', async () => {
            pool.query.mockResolvedValue({ rows: [] });

            const system = 'Base system prompt.';
            const result = await injectResponseRules(system, 'org-123');

            expect(result).toBe(system);
        });

        it('caches rules after DB fetch', async () => {
            pool.query.mockResolvedValue({
                rows: [{ rule_text: 'Rule 1', rule_type: 'general' }]
            });

            await injectResponseRules('System', 'org-456');

            expect(cache.set).toHaveBeenCalledWith(
                'rules:org-456',
                expect.any(Array),
                TTL.RESPONSE_RULES
            );
        });

        it('uses cached rules when available', async () => {
            cache.get.mockReturnValue([{ rule_text: 'Cached rule', rule_type: 'always' }]);

            const result = await injectResponseRules('System prompt.', 'org-789');

            expect(pool.query).not.toHaveBeenCalled();
            expect(result).toContain('[ALWAYS] Cached rule');
        });

        it('appends rules when no KB marker exists', async () => {
            pool.query.mockResolvedValue({
                rows: [{ rule_text: 'Append rule', rule_type: 'general' }]
            });

            const system = 'System prompt without KB marker.';
            const result = await injectResponseRules(system, 'org-123');

            expect(result).toContain('System prompt without KB marker.');
            expect(result).toContain('ORGANIZATION RESPONSE RULES');
            expect(result).toContain('[RULE] Append rule');
        });

        it('returns original system on error', async () => {
            pool.query.mockRejectedValue(new Error('DB down'));

            const system = 'Base system prompt.';
            const result = await injectResponseRules(system, 'org-123');

            expect(result).toBe(system);
        });
    });

    describe('buildEnhancedPrompt', () => {
        it('orchestrates all layers for response_assistant', async () => {
            // Mock DB for rules
            pool.query.mockResolvedValue({ rows: [] });
            // Mock empty KB results so injectKnowledgeBase returns early
            getConversationMemory.mockResolvedValue('\n\nMEMORY CONTEXT');
            getCrossToolContext.mockResolvedValue('\n\nCROSS TOOL CONTEXT');
            getVoiceProfileContext.mockResolvedValue('\n\nVOICE PROFILE');
            fetchRelevantCorrections.mockResolvedValue([{ id: 1 }]);
            buildCorrectionsContext.mockReturnValue('\n\nCORRECTIONS');

            const result = await buildEnhancedPrompt('Base prompt', 'How do I return?', 'org-1', {
                tool: 'response_assistant',
                userId: 'user-1',
                kb_type: 'support'
            });

            expect(result.system).toContain('Base prompt');
            expect(result.system).toContain('MEMORY CONTEXT');
            expect(result.system).toContain('CROSS TOOL CONTEXT');
            expect(result.system).toContain('VOICE PROFILE');
            expect(result.system).toContain('CORRECTIONS');
            expect(result.contextSummary).toBeDefined();
        });

        it('respects list_normalizer config (all false)', async () => {
            const result = await buildEnhancedPrompt('Base prompt', 'normalize this', 'org-1', {
                tool: 'list_normalizer',
                userId: 'user-1'
            });

            // None of the context layers should have been called
            expect(pool.query).not.toHaveBeenCalled();
            expect(getConversationMemory).not.toHaveBeenCalled();
            expect(getCrossToolContext).not.toHaveBeenCalled();
            expect(getVoiceProfileContext).not.toHaveBeenCalled();
            expect(fetchRelevantCorrections).not.toHaveBeenCalled();
            expect(result.system).toBe('Base prompt');
        });

        it('defaults to response_assistant config when tool is unknown', async () => {
            pool.query.mockResolvedValue({ rows: [] });
            getConversationMemory.mockResolvedValue('');
            getCrossToolContext.mockResolvedValue('');
            getVoiceProfileContext.mockResolvedValue('');

            await buildEnhancedPrompt('Base', 'test', 'org-1', {
                tool: 'unknown_tool',
                userId: 'user-1'
            });

            // Should use response_assistant config which has rules: true,
            // so pool.query should be called for rules
            expect(pool.query).toHaveBeenCalled();
        });

        it('returns referencedKbEntries array', async () => {
            pool.query.mockResolvedValue({ rows: [] });

            const result = await buildEnhancedPrompt('Base', 'test', 'org-1', {
                tool: 'list_normalizer'
            });

            expect(result.referencedKbEntries).toEqual([]);
        });

        it('returns contextSummary object', async () => {
            pool.query.mockResolvedValue({ rows: [] });

            const result = await buildEnhancedPrompt('Base', 'test', 'org-1', {
                tool: 'list_normalizer'
            });

            expect(result.contextSummary).toEqual({
                rules: 0, kb: 0, shopify: false, memory: 0, crossTool: 0, voice: false, corrections: 0, calendar: false
            });
        });

        it('skips memory and crossTool when userId is not provided', async () => {
            pool.query.mockResolvedValue({ rows: [] });

            await buildEnhancedPrompt('Base', 'test', 'org-1', {
                tool: 'response_assistant'
                // no userId
            });

            expect(getConversationMemory).not.toHaveBeenCalled();
            expect(getCrossToolContext).not.toHaveBeenCalled();
        });

        it('handles null baseSystem', async () => {
            pool.query.mockResolvedValue({ rows: [] });

            const result = await buildEnhancedPrompt(null, 'test', 'org-1', {
                tool: 'list_normalizer'
            });

            expect(result.system).toBe('');
        });
    });
});
