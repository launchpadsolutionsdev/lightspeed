const {
    buildComplianceSystemPrompt,
    buildDisclaimer,
    buildStaleWarning,
    buildWelcomeMessage,
    parseCitations,
    MANDATORY_REMINDER
} = require('../../src/services/compliancePromptBuilder');

describe('compliancePromptBuilder', () => {
    describe('MANDATORY_REMINDER', () => {
        it('is a non-empty string', () => {
            expect(typeof MANDATORY_REMINDER).toBe('string');
            expect(MANDATORY_REMINDER.length).toBeGreaterThan(0);
        });

        it('mentions Lightspeed and regulatory body', () => {
            expect(MANDATORY_REMINDER).toContain('Lightspeed');
            expect(MANDATORY_REMINDER).toContain('regulatory body');
        });
    });

    describe('buildComplianceSystemPrompt', () => {
        const baseOptions = {
            jurisdictionName: 'Ontario',
            regulatoryBody: 'Alcohol and Gaming Commission of Ontario',
            regulatoryUrl: 'https://agco.ca',
            knowledgeEntries: [
                {
                    id: 'uuid-001',
                    title: 'Raffle License Requirements',
                    category: 'Licensing',
                    source_name: 'AGCO Guidelines',
                    source_section: 'Section 4.1',
                    source_url: 'https://agco.ca/raffle',
                    last_verified_date: '2025-12-01',
                    original_text: 'All raffle operators must hold a valid license.',
                    content: 'Raffle licensing content'
                }
            ]
        };

        it('includes jurisdiction name', () => {
            const result = buildComplianceSystemPrompt(baseOptions);
            expect(result).toContain('Ontario');
        });

        it('includes regulatory body', () => {
            const result = buildComplianceSystemPrompt(baseOptions);
            expect(result).toContain('Alcohol and Gaming Commission of Ontario');
        });

        it('includes KB content with entry ID', () => {
            const result = buildComplianceSystemPrompt(baseOptions);
            expect(result).toContain('uuid-001');
            expect(result).toContain('Raffle License Requirements');
        });

        it('includes original_text when available', () => {
            const result = buildComplianceSystemPrompt(baseOptions);
            expect(result).toContain('All raffle operators must hold a valid license.');
        });

        it('falls back to content when original_text is absent', () => {
            const options = {
                ...baseOptions,
                knowledgeEntries: [{
                    id: 'uuid-002',
                    title: 'Test Entry',
                    category: 'General',
                    content: 'Fallback content here'
                }]
            };
            const result = buildComplianceSystemPrompt(options);
            expect(result).toContain('Fallback content here');
        });

        it('includes critical rules', () => {
            const result = buildComplianceSystemPrompt(baseOptions);
            expect(result).toContain('CRITICAL RULES');
            expect(result).toContain('You ONLY answer questions based on the knowledge base');
            expect(result).toContain('You NEVER make up');
        });

        it('includes source metadata', () => {
            const result = buildComplianceSystemPrompt(baseOptions);
            expect(result).toContain('Source: AGCO Guidelines');
            expect(result).toContain('Section: Section 4.1');
            expect(result).toContain('URL: https://agco.ca/raffle');
            expect(result).toContain('Last Verified: 2025-12-01');
        });

        it('includes MANDATORY_REMINDER at the end', () => {
            const result = buildComplianceSystemPrompt(baseOptions);
            expect(result).toContain(MANDATORY_REMINDER);
        });

        it('handles empty knowledgeEntries', () => {
            const options = { ...baseOptions, knowledgeEntries: [] };
            const result = buildComplianceSystemPrompt(options);
            expect(result).toContain('No knowledge base entries are available');
        });
    });

    describe('buildDisclaimer', () => {
        it('includes regulatory body', () => {
            const result = buildDisclaimer('AGCO', 'https://agco.ca', '2025-12-01');
            expect(result).toContain('AGCO');
        });

        it('includes latest verified date', () => {
            const result = buildDisclaimer('AGCO', 'https://agco.ca', '2025-12-01');
            expect(result).toContain('2025-12-01');
        });

        it('includes regulatory URL', () => {
            const result = buildDisclaimer('AGCO', 'https://agco.ca', '2025-12-01');
            expect(result).toContain('https://agco.ca');
        });

        it('handles missing latestVerifiedDate', () => {
            const result = buildDisclaimer('AGCO', 'https://agco.ca', null);
            expect(result).toContain('the most recent verification');
        });
    });

    describe('buildStaleWarning', () => {
        it('returns null for empty entries', () => {
            expect(buildStaleWarning([], 'AGCO')).toBeNull();
        });

        it('returns null for null entries', () => {
            expect(buildStaleWarning(null, 'AGCO')).toBeNull();
        });

        it('returns null for fresh entries (within 90 days)', () => {
            const now = new Date();
            const recentDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
            const entries = [{ last_verified_date: recentDate.toISOString() }];
            expect(buildStaleWarning(entries, 'AGCO')).toBeNull();
        });

        it('returns warning for entries >90 days old', () => {
            const staleDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000); // 120 days ago
            const entries = [{ last_verified_date: staleDate.toISOString() }];
            const result = buildStaleWarning(entries, 'AGCO');
            expect(result).not.toBeNull();
            expect(result).toContain('AGCO');
        });

        it('includes days count in warning', () => {
            const staleDate = new Date(Date.now() - 150 * 24 * 60 * 60 * 1000); // 150 days ago
            const entries = [{ last_verified_date: staleDate.toISOString() }];
            const result = buildStaleWarning(entries, 'AGCO');
            expect(result).toContain('150');
        });

        it('treats entries with no last_verified_date as stale', () => {
            const entries = [{ title: 'No date entry' }];
            const result = buildStaleWarning(entries, 'AGCO');
            expect(result).not.toBeNull();
        });

        it('reports based on oldest stale entry', () => {
            const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
            const newerDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
            const entries = [
                { last_verified_date: newerDate.toISOString() },
                { last_verified_date: oldDate.toISOString() }
            ];
            const result = buildStaleWarning(entries, 'AGCO');
            expect(result).toContain('200');
        });
    });

    describe('buildWelcomeMessage', () => {
        it('includes jurisdiction', () => {
            const result = buildWelcomeMessage('Ontario', 'AGCO', 'https://agco.ca', '2025-12-01');
            expect(result).toContain('Ontario');
        });

        it('includes regulatory body', () => {
            const result = buildWelcomeMessage('Ontario', 'AGCO', 'https://agco.ca', '2025-12-01');
            expect(result).toContain('AGCO');
        });

        it('includes latest verified date', () => {
            const result = buildWelcomeMessage('Ontario', 'AGCO', 'https://agco.ca', '2025-12-01');
            expect(result).toContain('2025-12-01');
        });

        it('handles missing latestVerifiedDate', () => {
            const result = buildWelcomeMessage('Ontario', 'AGCO', 'https://agco.ca', null);
            expect(result).toContain('N/A');
        });

        it('includes regulatory URL', () => {
            const result = buildWelcomeMessage('Ontario', 'AGCO', 'https://agco.ca', '2025-12-01');
            expect(result).toContain('https://agco.ca');
        });
    });

    describe('parseCitations', () => {
        it('extracts UUIDs from [Citation: uuid] patterns', () => {
            const text = 'Based on [Citation: abc-123-def] and [Citation: aab-456-ccd], we see...';
            const result = parseCitations(text);
            expect(result).toContain('abc-123-def');
            expect(result).toContain('aab-456-ccd');
        });

        it('handles case insensitivity', () => {
            const text = 'See [citation: abc-123] and [CITATION: def-456] for details.';
            const result = parseCitations(text);
            expect(result).toContain('abc-123');
            expect(result).toContain('def-456');
        });

        it('deduplicates citations', () => {
            const text = 'First [Citation: abc-123], again [Citation: abc-123], and [Citation: def-456].';
            const result = parseCitations(text);
            expect(result).toHaveLength(2);
            expect(result).toContain('abc-123');
            expect(result).toContain('def-456');
        });

        it('returns empty array for text with no citations', () => {
            const result = parseCitations('This text has no citations at all.');
            expect(result).toEqual([]);
        });

        it('handles UUIDs with standard format', () => {
            const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
            const text = `According to [Citation: ${uuid}], the rule applies.`;
            const result = parseCitations(text);
            expect(result).toContain(uuid);
        });

        it('handles extra whitespace after colon', () => {
            const text = 'See [Citation:  abc-123] for details.';
            // The regex uses \s* after the colon so extra space is fine
            const result = parseCitations(text);
            expect(result).toContain('abc-123');
        });
    });
});
