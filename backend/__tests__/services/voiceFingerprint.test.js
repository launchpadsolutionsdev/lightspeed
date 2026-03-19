// Set env BEFORE requiring the module so the module-level const captures it
process.env.ANTHROPIC_API_KEY = 'test-key';

jest.mock('../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/services/cache', () => ({ cache: { get: jest.fn(), set: jest.fn() }, TTL: {} }));
jest.mock('../../src/services/logger', () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()
}));

const pool = require('../../config/database');
const { cache } = require('../../src/services/cache');
const { getVoiceProfile, getVoiceProfileContext, buildVoiceProfile } = require('../../src/services/voiceFingerprint');

describe('voiceFingerprint', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.ANTHROPIC_API_KEY = 'test-key';
        global.fetch = jest.fn();
    });

    afterEach(() => {
        delete global.fetch;
    });

    describe('getVoiceProfile', () => {
        it('returns cached profile if available', async () => {
            cache.get.mockReturnValue('Cached voice profile text');

            const result = await getVoiceProfile('org-1', 'general');
            expect(result).toBe('Cached voice profile text');
            expect(pool.query).not.toHaveBeenCalled();
        });

        it('queries DB when not cached', async () => {
            cache.get.mockReturnValue(undefined);
            pool.query.mockResolvedValue({
                rows: [{ profile_text: 'DB voice profile', tool: 'general' }]
            });

            const result = await getVoiceProfile('org-1', 'general');
            expect(result).toBe('DB voice profile');
            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT profile_text'),
                ['org-1', 'general']
            );
        });

        it('caches DB result', async () => {
            cache.get.mockReturnValue(undefined);
            pool.query.mockResolvedValue({
                rows: [{ profile_text: 'Profile to cache', tool: 'general' }]
            });

            await getVoiceProfile('org-1', 'general');
            expect(cache.set).toHaveBeenCalledWith(
                'voice:org-1:general',
                'Profile to cache',
                expect.any(Number)
            );
        });

        it('returns null when no profile found', async () => {
            cache.get.mockReturnValue(undefined);
            pool.query.mockResolvedValue({ rows: [] });

            const result = await getVoiceProfile('org-1', 'general');
            expect(result).toBeNull();
        });

        it('returns null on error', async () => {
            cache.get.mockReturnValue(undefined);
            pool.query.mockRejectedValue(new Error('DB error'));

            const result = await getVoiceProfile('org-1', 'general');
            expect(result).toBeNull();
        });
    });

    describe('getVoiceProfileContext', () => {
        it('returns empty string when no profile', async () => {
            cache.get.mockReturnValue(undefined);
            pool.query.mockResolvedValue({ rows: [] });

            const result = await getVoiceProfileContext('org-1', 'general');
            expect(result).toBe('');
        });

        it('returns formatted context block with correct label for draft_assistant', async () => {
            cache.get.mockReturnValue('Writing style: formal, concise');

            const result = await getVoiceProfileContext('org-1', 'draft_assistant');
            expect(result).toContain('WRITING VOICE PROFILE');
            expect(result).toContain('content writing style');
            expect(result).toContain('Writing style: formal, concise');
        });

        it('returns formatted context block with default label for other tools', async () => {
            cache.get.mockReturnValue('Communication style: warm, professional');

            const result = await getVoiceProfileContext('org-1', 'response_assistant');
            expect(result).toContain('VOICE PROFILE');
            expect(result).toContain('communication style');
            expect(result).toContain('Communication style: warm, professional');
        });

        it('returns formatted context block for general tool', async () => {
            cache.get.mockReturnValue('General style guide');

            const result = await getVoiceProfileContext('org-1', 'general');
            expect(result).toContain('VOICE PROFILE');
            expect(result).toContain('General style guide');
        });
    });

    describe('buildVoiceProfile', () => {
        it('returns null if fewer than 5 positive examples', async () => {
            pool.query.mockResolvedValue({
                rows: [
                    { inquiry: 'Q1', response: 'A1', format: 'email', tone: 'professional' },
                    { inquiry: 'Q2', response: 'A2', format: 'email', tone: 'casual' }
                ]
            });

            const result = await buildVoiceProfile('org-1', 'general');
            expect(result).toBeNull();
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('calls Anthropic API with examples', async () => {
            const rows = Array.from({ length: 10 }, (_, i) => ({
                inquiry: `Question ${i}`,
                response: `Response ${i}`,
                format: 'general',
                tone: 'default'
            }));
            pool.query
                .mockResolvedValueOnce({ rows }) // First call: fetch examples
                .mockResolvedValueOnce({ rows: [] }); // Second call: upsert

            global.fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    content: [{ text: '- Warm and friendly tone\n- Uses emojis sparingly' }]
                })
            });

            const result = await buildVoiceProfile('org-1', 'general');

            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.anthropic.com/v1/messages',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'x-api-key': 'test-key'
                    })
                })
            );
            expect(result).toBe('- Warm and friendly tone\n- Uses emojis sparingly');
        });

        it('saves profile to DB', async () => {
            const rows = Array.from({ length: 10 }, (_, i) => ({
                inquiry: `Q${i}`, response: `A${i}`, format: 'general', tone: 'default'
            }));
            pool.query
                .mockResolvedValueOnce({ rows })
                .mockResolvedValueOnce({ rows: [] });

            global.fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    content: [{ text: 'Profile text' }]
                })
            });

            await buildVoiceProfile('org-1', 'general');

            expect(pool.query).toHaveBeenCalledTimes(2);
            const upsertCall = pool.query.mock.calls[1];
            expect(upsertCall[0]).toContain('INSERT INTO voice_profiles');
            expect(upsertCall[1]).toContain('org-1');
            expect(upsertCall[1]).toContain('Profile text');
        });

        it('returns null on API failure', async () => {
            const rows = Array.from({ length: 10 }, (_, i) => ({
                inquiry: `Q${i}`, response: `A${i}`, format: 'general', tone: 'default'
            }));
            pool.query.mockResolvedValue({ rows });

            global.fetch.mockResolvedValue({
                ok: false,
                status: 500,
                json: jest.fn().mockResolvedValue({ error: { message: 'Server error' } })
            });

            const result = await buildVoiceProfile('org-1', 'general');
            expect(result).toBeNull();
        });

        it('returns null on fetch exception', async () => {
            const rows = Array.from({ length: 10 }, (_, i) => ({
                inquiry: `Q${i}`, response: `A${i}`, format: 'general', tone: 'default'
            }));
            pool.query.mockResolvedValue({ rows });

            global.fetch.mockRejectedValue(new Error('Network error'));

            const result = await buildVoiceProfile('org-1', 'general');
            expect(result).toBeNull();
        });

        it('caches the new profile after saving', async () => {
            const rows = Array.from({ length: 10 }, (_, i) => ({
                inquiry: `Q${i}`, response: `A${i}`, format: 'general', tone: 'default'
            }));
            pool.query
                .mockResolvedValueOnce({ rows })
                .mockResolvedValueOnce({ rows: [] });

            global.fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    content: [{ text: 'New profile' }]
                })
            });

            await buildVoiceProfile('org-1', 'general');

            expect(cache.set).toHaveBeenCalledWith(
                'voice:org-1:general',
                'New profile',
                expect.any(Number)
            );
        });
    });
});
