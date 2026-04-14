/**
 * Tests for superAdminBootstrap — env-driven super-admin grants.
 */

jest.mock('../../config/database', () => ({
    query: jest.fn()
}));
jest.mock('../../src/services/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

const pool = require('../../config/database');
const { runSuperAdminBootstrap, _parseEmails } = require('../../src/services/superAdminBootstrap');

describe('_parseEmails', () => {
    test('returns empty array for empty / missing input', () => {
        expect(_parseEmails('')).toEqual([]);
        expect(_parseEmails(undefined)).toEqual([]);
        expect(_parseEmails(null)).toEqual([]);
    });

    test('splits and lowercases', () => {
        expect(_parseEmails('Foo@Example.COM, bar@example.com')).toEqual([
            'foo@example.com',
            'bar@example.com'
        ]);
    });

    test('filters entries without @', () => {
        expect(_parseEmails('foo@example.com, not-an-email, bar@example.com')).toEqual([
            'foo@example.com',
            'bar@example.com'
        ]);
    });

    test('trims whitespace', () => {
        expect(_parseEmails('  a@b.com ,c@d.com  ')).toEqual(['a@b.com', 'c@d.com']);
    });
});

describe('runSuperAdminBootstrap', () => {
    const originalEnv = process.env.SUPER_ADMINS;

    beforeEach(() => {
        pool.query.mockReset();
    });

    afterEach(() => {
        if (originalEnv === undefined) delete process.env.SUPER_ADMINS;
        else process.env.SUPER_ADMINS = originalEnv;
    });

    test('no-ops when SUPER_ADMINS is unset', async () => {
        delete process.env.SUPER_ADMINS;
        await runSuperAdminBootstrap();
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('issues one upsert per email', async () => {
        process.env.SUPER_ADMINS = 'alice@example.com, bob@example.com';
        pool.query.mockResolvedValue({});
        await runSuperAdminBootstrap();
        expect(pool.query).toHaveBeenCalledTimes(2);
        expect(pool.query.mock.calls[0][1]).toEqual(['alice@example.com']);
        expect(pool.query.mock.calls[1][1]).toEqual(['bob@example.com']);
    });

    test('continues past individual failures', async () => {
        process.env.SUPER_ADMINS = 'alice@example.com, bob@example.com';
        pool.query
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({});
        await runSuperAdminBootstrap();
        expect(pool.query).toHaveBeenCalledTimes(2);
    });
});
