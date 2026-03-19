jest.mock('../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/services/logger', () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()
}));
jest.mock('../../src/services/embeddingService', () => ({
    embedQuery: jest.fn(),
    formatForPgvector: jest.fn()
}));

const pool = require('../../config/database');
const { getConversationMemory, getCrossToolContext } = require('../../src/services/conversationMemory');

describe('conversationMemory', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getConversationMemory', () => {
        it('returns empty string when no conversations found', async () => {
            pool.query.mockResolvedValue({ rows: [] });

            const result = await getConversationMemory('test inquiry', 'org-1', 'user-1');
            expect(result).toBe('');
        });

        it('formats conversation entries with date and title', async () => {
            pool.query.mockResolvedValue({
                rows: [{
                    id: 'conv-1',
                    title: 'Lottery ticket question',
                    summary: 'Discussed pricing for lottery tickets',
                    user_id: 'user-1',
                    updated_at: new Date('2025-06-15T10:00:00Z')
                }]
            });

            const result = await getConversationMemory('lottery', 'org-1', 'user-1');
            expect(result).toContain('CONVERSATION MEMORY');
            expect(result).toContain('2025-06-15');
            expect(result).toContain('Lottery ticket question');
        });

        it('includes "You" for own conversations', async () => {
            pool.query.mockResolvedValue({
                rows: [{
                    id: 'conv-1',
                    title: 'My conversation',
                    summary: 'Summary here',
                    user_id: 'user-1',
                    updated_at: new Date('2025-06-15T10:00:00Z')
                }]
            });

            const result = await getConversationMemory('test', 'org-1', 'user-1');
            expect(result).toContain('You discussed');
        });

        it('includes "A team member" for other users conversations', async () => {
            pool.query.mockResolvedValue({
                rows: [{
                    id: 'conv-1',
                    title: 'Other conversation',
                    summary: 'Summary here',
                    user_id: 'user-2',
                    updated_at: new Date('2025-06-15T10:00:00Z')
                }]
            });

            const result = await getConversationMemory('test', 'org-1', 'user-1');
            expect(result).toContain('A team member discussed');
        });

        it('truncates long summaries to 300 chars', async () => {
            const longSummary = 'A'.repeat(500);
            pool.query.mockResolvedValue({
                rows: [{
                    id: 'conv-1',
                    title: 'Long summary conversation',
                    summary: longSummary,
                    user_id: 'user-1',
                    updated_at: new Date('2025-06-15T10:00:00Z')
                }]
            });

            const result = await getConversationMemory('test', 'org-1', 'user-1');
            // Should contain truncated summary (300 chars) followed by ...
            expect(result).toContain('A'.repeat(300) + '...');
            expect(result).not.toContain('A'.repeat(301));
        });

        it('returns empty string on error', async () => {
            pool.query.mockRejectedValue(new Error('DB connection failed'));

            const result = await getConversationMemory('test', 'org-1', 'user-1');
            expect(result).toBe('');
        });

        it('handles conversations with no title', async () => {
            pool.query.mockResolvedValue({
                rows: [{
                    id: 'conv-1',
                    title: null,
                    summary: 'A summary',
                    user_id: 'user-1',
                    updated_at: new Date('2025-06-15T10:00:00Z')
                }]
            });

            const result = await getConversationMemory('test', 'org-1', 'user-1');
            expect(result).toContain('Untitled conversation');
        });

        it('handles conversations with no updated_at', async () => {
            pool.query.mockResolvedValue({
                rows: [{
                    id: 'conv-1',
                    title: 'Test',
                    summary: null,
                    user_id: 'user-1',
                    updated_at: null
                }]
            });

            const result = await getConversationMemory('test', 'org-1', 'user-1');
            expect(result).toContain('recently');
        });
    });

    describe('getCrossToolContext', () => {
        it('returns empty string when no recent activity', async () => {
            pool.query.mockResolvedValue({ rows: [] });

            const result = await getCrossToolContext('org-1', 'user-1', { tool: 'ask_lightspeed' });
            expect(result).toBe('');
        });

        it('formats activity entries with tool name, time ago, topic, output', async () => {
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            pool.query.mockResolvedValue({
                rows: [{
                    tool: 'draft_assistant',
                    inquiry: 'Write a promotional email',
                    response: 'Here is a draft email for your lottery promotion...',
                    format: 'email',
                    tone: 'professional',
                    content_type: 'email',
                    created_at: twoHoursAgo
                }]
            });

            const result = await getCrossToolContext('org-1', 'user-1', { tool: 'ask_lightspeed' });
            expect(result).toContain('RECENT ACTIVITY');
            expect(result).toContain('Draft Assistant');
            expect(result).toContain('2h ago');
            expect(result).toContain('Write a promotional email');
            expect(result).toContain('Here is a draft email');
        });

        it('excludes current tool from results', async () => {
            pool.query.mockResolvedValue({ rows: [] });

            await getCrossToolContext('org-1', 'user-1', { tool: 'draft_assistant' });

            expect(pool.query).toHaveBeenCalledWith(
                expect.any(String),
                ['org-1', 'user-1', 'draft_assistant']
            );
        });

        it('returns empty string on error', async () => {
            pool.query.mockRejectedValue(new Error('DB error'));

            const result = await getCrossToolContext('org-1', 'user-1', { tool: 'ask_lightspeed' });
            expect(result).toBe('');
        });

        it('shows "just now" for very recent activity', async () => {
            const justNow = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
            pool.query.mockResolvedValue({
                rows: [{
                    tool: 'response_assistant',
                    inquiry: 'Quick question',
                    response: 'Quick answer',
                    format: null,
                    tone: null,
                    content_type: null,
                    created_at: justNow
                }]
            });

            const result = await getCrossToolContext('org-1', 'user-1', { tool: 'ask_lightspeed' });
            expect(result).toContain('just now');
        });

        it('shows days for older activity', async () => {
            const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
            pool.query.mockResolvedValue({
                rows: [{
                    tool: 'insights_engine',
                    inquiry: 'Revenue analysis',
                    response: 'Revenue data shows...',
                    format: null,
                    tone: null,
                    content_type: 'report',
                    created_at: twoDaysAgo
                }]
            });

            const result = await getCrossToolContext('org-1', 'user-1', { tool: 'ask_lightspeed' });
            expect(result).toContain('2d ago');
        });

        it('includes content type tag when present', async () => {
            const recentTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
            pool.query.mockResolvedValue({
                rows: [{
                    tool: 'draft_assistant',
                    inquiry: 'Write social post',
                    response: 'Check out our lottery!',
                    format: 'social',
                    tone: 'casual',
                    content_type: 'social_post',
                    created_at: recentTime
                }]
            });

            const result = await getCrossToolContext('org-1', 'user-1', { tool: 'ask_lightspeed' });
            expect(result).toContain('(social_post)');
        });
    });
});
