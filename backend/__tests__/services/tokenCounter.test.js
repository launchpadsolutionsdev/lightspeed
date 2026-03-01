const { estimateTokens, checkTokenBudget, truncateEntriesToBudget } = require('../../src/services/tokenCounter');

describe('tokenCounter', () => {
    describe('estimateTokens', () => {
        it('returns 0 for empty input', () => {
            expect(estimateTokens('')).toBe(0);
            expect(estimateTokens(null)).toBe(0);
            expect(estimateTokens(undefined)).toBe(0);
        });

        it('estimates tokens as roughly chars/4', () => {
            const text = 'Hello, world!'; // 13 chars -> ~4 tokens
            const tokens = estimateTokens(text);
            expect(tokens).toBeGreaterThan(0);
            expect(tokens).toBe(Math.ceil(13 / 4));
        });

        it('handles long text', () => {
            const text = 'a'.repeat(4000); // 4000 chars -> ~1000 tokens
            expect(estimateTokens(text)).toBe(1000);
        });
    });

    describe('checkTokenBudget', () => {
        it('reports within budget for small prompts', () => {
            const result = checkTokenBudget({
                systemPrompt: 'You are a helpful assistant.',
                userPrompt: 'Hello!',
                maxOutputTokens: 1024
            });
            expect(result.withinBudget).toBe(true);
            expect(result.budgetRemaining).toBeGreaterThan(0);
        });

        it('reports over budget for very large prompts', () => {
            const hugePrompt = 'a'.repeat(800000); // ~200K tokens
            const result = checkTokenBudget({
                systemPrompt: hugePrompt,
                userPrompt: 'Hello!',
                maxOutputTokens: 1024
            });
            expect(result.withinBudget).toBe(false);
        });

        it('uses correct context window for known models', () => {
            const result = checkTokenBudget({
                systemPrompt: 'test',
                userPrompt: 'test',
                model: 'claude-sonnet-4-6'
            });
            expect(result.contextWindow).toBe(200000);
        });
    });

    describe('truncateEntriesToBudget', () => {
        it('returns all entries when within budget', () => {
            const entries = [
                { title: 'Entry 1', content: 'Short content' },
                { title: 'Entry 2', content: 'Also short' }
            ];
            const result = truncateEntriesToBudget(entries, 10000);
            expect(result).toHaveLength(2);
        });

        it('truncates individual long entries', () => {
            const longContent = 'a'.repeat(15000); // Exceeds 12K char limit
            const entries = [{ title: 'Long entry', content: longContent }];
            const result = truncateEntriesToBudget(entries, 50000);
            expect(result).toHaveLength(1);
            expect(result[0].content.length).toBeLessThan(longContent.length);
            expect(result[0].content).toContain('[...truncated]');
        });

        it('drops entries that exceed the total budget', () => {
            const entries = Array.from({ length: 20 }, (_, i) => ({
                title: `Entry ${i}`,
                content: 'a'.repeat(2000)
            }));
            const result = truncateEntriesToBudget(entries, 5000); // ~5K tokens = ~20K chars
            expect(result.length).toBeLessThan(20);
            expect(result.length).toBeGreaterThan(0);
        });

        it('handles empty entries array', () => {
            expect(truncateEntriesToBudget([], 10000)).toHaveLength(0);
        });
    });
});
