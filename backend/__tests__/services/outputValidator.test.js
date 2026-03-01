const { validateOutput } = require('../../src/services/outputValidator');

describe('outputValidator', () => {
    describe('validateOutput', () => {
        it('returns no warnings for clean responses', () => {
            const result = validateOutput('Thank you for reaching out! Your tickets have been sent to your email.');
            expect(result.warnings).toHaveLength(0);
        });

        it('returns no warnings for empty input', () => {
            expect(validateOutput('').warnings).toHaveLength(0);
            expect(validateOutput(null).warnings).toHaveLength(0);
            expect(validateOutput(undefined).warnings).toHaveLength(0);
        });

        it('detects system prompt leakage', () => {
            const text = 'Here is your response. ORGANIZATION RESPONSE RULES (you MUST follow these): Never say goodbye.';
            const result = validateOutput(text);
            expect(result.warnings.some(w => w.type === 'prompt_leakage')).toBe(true);
        });

        it('detects credit card numbers', () => {
            const text = 'Your payment of $50 was charged to card 4111-1111-1111-1111.';
            const result = validateOutput(text);
            expect(result.warnings.some(w => w.type === 'pii_detected')).toBe(true);
        });

        it('detects SSN patterns', () => {
            const text = 'Your SSN is 123-45-6789.';
            const result = validateOutput(text);
            expect(result.warnings.some(w => w.type === 'pii_detected')).toBe(true);
        });

        it('detects Canadian SIN patterns', () => {
            const text = 'Your SIN is 123 456 789.';
            const result = validateOutput(text);
            expect(result.warnings.some(w => w.type === 'pii_detected')).toBe(true);
        });

        it('flags unknown email addresses', () => {
            const text = 'Please email unknown@example.com for help.';
            const result = validateOutput(text, { orgEmails: ['support@org.com'] });
            expect(result.warnings.some(w => w.type === 'unknown_email')).toBe(true);
        });

        it('does not flag known org email addresses', () => {
            const text = 'Please email support@org.com for help.';
            const result = validateOutput(text, { orgEmails: ['support@org.com'] });
            expect(result.warnings.some(w => w.type === 'unknown_email')).toBe(false);
        });

        it('handles case-insensitive email matching', () => {
            const text = 'Email us at SUPPORT@org.com';
            const result = validateOutput(text, { orgEmails: ['support@ORG.com'] });
            expect(result.warnings.some(w => w.type === 'unknown_email')).toBe(false);
        });
    });
});
