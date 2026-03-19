jest.mock('../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/services/logger', () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()
}));

const pool = require('../../config/database');
const log = require('../../src/services/logger');
const { logAction } = require('../../src/services/auditLog');

describe('auditLog', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pool.query.mockResolvedValue({});
    });

    describe('logAction', () => {
        it('calls pool.query with correct params', () => {
            logAction({
                orgId: 'org-1',
                userId: 'user-1',
                action: 'MEMBER_INVITED',
                resourceType: 'USER',
                resourceId: 'res-1',
                changes: { role: 'admin' },
                req: { headers: { 'x-forwarded-for': '1.2.3.4' }, ip: '5.6.7.8' }
            });

            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO audit_logs'),
                ['org-1', 'user-1', 'MEMBER_INVITED', 'USER', 'res-1', JSON.stringify({ role: 'admin' }), '1.2.3.4']
            );
        });

        it('handles null orgId, userId, and resourceId', () => {
            logAction({
                action: 'SYSTEM_ACTION',
                resourceType: 'ORGANIZATION'
            });

            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO audit_logs'),
                [null, null, 'SYSTEM_ACTION', 'ORGANIZATION', null, null, null]
            );
        });

        it('stringifies changes object', () => {
            const changes = { before: 'old', after: 'new' };
            logAction({
                orgId: 'org-1',
                userId: 'user-1',
                action: 'KB_ENTRY_UPDATED',
                resourceType: 'KNOWLEDGE_BASE',
                changes
            });

            const args = pool.query.mock.calls[0][1];
            expect(args[5]).toBe(JSON.stringify(changes));
        });

        it('passes null for changes when not provided', () => {
            logAction({
                orgId: 'org-1',
                userId: 'user-1',
                action: 'KB_ENTRY_DELETED',
                resourceType: 'KNOWLEDGE_BASE'
            });

            const args = pool.query.mock.calls[0][1];
            expect(args[5]).toBeNull();
        });

        it('extracts IP from x-forwarded-for header (first value)', () => {
            logAction({
                action: 'LOGIN',
                resourceType: 'USER',
                req: { headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2, 10.0.0.3' }, ip: '127.0.0.1' }
            });

            const args = pool.query.mock.calls[0][1];
            expect(args[6]).toBe('10.0.0.1');
        });

        it('falls back to req.ip when x-forwarded-for is absent', () => {
            logAction({
                action: 'LOGIN',
                resourceType: 'USER',
                req: { headers: {}, ip: '192.168.1.1' }
            });

            const args = pool.query.mock.calls[0][1];
            expect(args[6]).toBe('192.168.1.1');
        });

        it('handles null req gracefully', () => {
            logAction({
                action: 'SYSTEM_EVENT',
                resourceType: 'ORGANIZATION',
                req: null
            });

            const args = pool.query.mock.calls[0][1];
            expect(args[6]).toBeNull();
        });

        it('handles missing req (undefined)', () => {
            logAction({
                action: 'SYSTEM_EVENT',
                resourceType: 'ORGANIZATION'
            });

            const args = pool.query.mock.calls[0][1];
            expect(args[6]).toBeNull();
        });

        it('logs error on query failure (fire-and-forget)', async () => {
            pool.query.mockRejectedValue(new Error('Connection refused'));

            logAction({
                action: 'FAIL_ACTION',
                resourceType: 'USER'
            });

            // Allow the promise rejection to be handled
            await new Promise(resolve => setImmediate(resolve));

            expect(log.error).toHaveBeenCalledWith(
                '[AUDIT] Failed to write audit log',
                { error: 'Connection refused' }
            );
        });
    });
});
