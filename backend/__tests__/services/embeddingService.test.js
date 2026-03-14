const { formatForPgvector } = require('../../src/services/embeddingService');

describe('embeddingService', () => {
    describe('formatForPgvector', () => {
        it('formats a simple vector', () => {
            const embedding = [0.1, 0.2, 0.3];
            expect(formatForPgvector(embedding)).toBe('[0.1,0.2,0.3]');
        });

        it('formats a single-element vector', () => {
            expect(formatForPgvector([1.0])).toBe('[1]');
        });

        it('handles negative values', () => {
            const embedding = [-0.5, 0.3, -0.1];
            expect(formatForPgvector(embedding)).toBe('[-0.5,0.3,-0.1]');
        });

        it('handles empty vector', () => {
            expect(formatForPgvector([])).toBe('[]');
        });
    });
});
