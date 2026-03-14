const { classifyComplexity, getBudgetAllocation, BUDGET_PROFILES } = require('../../src/services/budgetAllocator');

describe('budgetAllocator', () => {
    describe('classifyComplexity', () => {
        it('returns simple for empty/null input', () => {
            expect(classifyComplexity('')).toBe('simple');
            expect(classifyComplexity(null)).toBe('simple');
            expect(classifyComplexity(undefined)).toBe('simple');
        });

        it('classifies greetings as simple', () => {
            expect(classifyComplexity('Hi there')).toBe('simple');
            expect(classifyComplexity('Hello')).toBe('simple');
            expect(classifyComplexity('Thanks!')).toBe('simple');
            expect(classifyComplexity('Good morning')).toBe('simple');
        });

        it('classifies basic questions as simple', () => {
            expect(classifyComplexity('What are your hours?')).toBe('simple');
            expect(classifyComplexity('What is your address?')).toBe('simple');
        });

        it('classifies standard questions as medium', () => {
            expect(classifyComplexity('How do I return a product I purchased last week?')).toBe('medium');
            expect(classifyComplexity('Can you tell me about the lottery ticket prices?')).toBe('medium');
        });

        it('classifies complaints as complex', () => {
            expect(classifyComplexity(
                'I am very frustrated because my order has not arrived and the tracking shows it was delivered but I never received it. This is unacceptable.'
            )).toBe('complex');
        });

        it('classifies multi-question inquiries as complex', () => {
            expect(classifyComplexity(
                'What is the refund policy? How long does shipping take? Can I exchange an item? What about international orders?'
            )).toBe('complex');
        });

        it('classifies long detailed messages as complex', () => {
            const longMessage = 'I need help with my account. '.repeat(10) +
                'Additionally, I have several issues that need to be addressed.';
            expect(classifyComplexity(longMessage)).toBe('complex');
        });

        it('classifies troubleshooting requests as complex', () => {
            expect(classifyComplexity(
                'My account is not working and I keep getting an error when I try to log in. Can you walk me through the steps to fix this?'
            )).toBe('complex');
        });
    });

    describe('getBudgetAllocation', () => {
        it('returns correct budget profile for simple inquiries', () => {
            const result = getBudgetAllocation('Hi');
            expect(result.complexity).toBe('simple');
            expect(result.budgets).toEqual(BUDGET_PROFILES.simple);
            expect(result.budgets.knowledgeBase).toBe(5000);
            expect(result.budgets.maxKbEntries).toBe(3);
        });

        it('returns correct budget profile for medium inquiries', () => {
            const result = getBudgetAllocation('How do I return a product?');
            expect(result.complexity).toBe('medium');
            expect(result.budgets).toEqual(BUDGET_PROFILES.medium);
            expect(result.budgets.knowledgeBase).toBe(25000);
            expect(result.budgets.maxKbEntries).toBe(8);
        });

        it('returns correct budget profile for complex inquiries', () => {
            const result = getBudgetAllocation(
                'I have a problem with my order. It was not delivered and the tracking is broken. I need a refund immediately. This is unacceptable service.'
            );
            expect(result.complexity).toBe('complex');
            expect(result.budgets).toEqual(BUDGET_PROFILES.complex);
            expect(result.budgets.knowledgeBase).toBe(50000);
            expect(result.budgets.maxKbEntries).toBe(15);
        });

        it('allocates more KB budget for complex than simple', () => {
            const simple = getBudgetAllocation('Hi').budgets;
            const medium = getBudgetAllocation('How do I return something?').budgets;
            const complex = getBudgetAllocation(
                'Multiple issues: refund not processed, order broken, need step-by-step instructions to resolve all of these problems.'
            ).budgets;

            expect(simple.knowledgeBase).toBeLessThan(medium.knowledgeBase);
            expect(medium.knowledgeBase).toBeLessThan(complex.knowledgeBase);
        });
    });
});
