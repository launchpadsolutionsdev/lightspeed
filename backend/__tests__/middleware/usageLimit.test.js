/**
 * Tests for checkUsageLimit middleware.
 * Mocks the database pool to test subscription tier logic without a real DB.
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

jest.mock('../../src/services/cache', () => ({
    cache: { get: jest.fn(), set: jest.fn() },
    TTL: { AUTH_ORG: 300 }
}));

const pool = require('../../config/database');
const { checkUsageLimit } = require('../../src/middleware/auth');

describe('checkUsageLimit', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            userId: 'user-1',
            user: { is_super_admin: false }
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        next = jest.fn();
        pool.query.mockReset();
    });

    it('bypasses limits for super admins', async () => {
        req.user.is_super_admin = true;
        await checkUsageLimit(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns 403 when user has no organization', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        await checkUsageLimit(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
        expect(next).not.toHaveBeenCalled();
    });

    it('blocks cancelled subscriptions', async () => {
        pool.query.mockResolvedValueOnce({
            rows: [{ subscription_status: 'cancelled', trial_ends_at: null, organization_id: 'org-1' }]
        });
        await checkUsageLimit(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SUBSCRIPTION_CANCELLED' }));
    });

    it('allows expired trials (trial check temporarily disabled)', async () => {
        const pastDate = new Date(Date.now() - 86400000).toISOString(); // yesterday
        pool.query
            .mockResolvedValueOnce({
                rows: [{ subscription_status: 'trial', trial_ends_at: pastDate, organization_id: 'org-1' }]
            })
            .mockResolvedValueOnce({ rows: [{ count: '50' }] }); // under 100 limit
        await checkUsageLimit(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    it('allows active trial under limit', async () => {
        const futureDate = new Date(Date.now() + 86400000 * 7).toISOString();
        pool.query
            .mockResolvedValueOnce({
                rows: [{ subscription_status: 'trial', trial_ends_at: futureDate, organization_id: 'org-1' }]
            })
            .mockResolvedValueOnce({ rows: [{ count: '50' }] }); // under 100 limit
        await checkUsageLimit(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    it('blocks trial at the limit', async () => {
        const futureDate = new Date(Date.now() + 86400000 * 7).toISOString();
        pool.query
            .mockResolvedValueOnce({
                rows: [{ subscription_status: 'trial', trial_ends_at: futureDate, organization_id: 'org-1' }]
            })
            .mockResolvedValueOnce({ rows: [{ count: '100' }] }); // at 100 limit
        await checkUsageLimit(req, res, next);
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'USAGE_LIMIT_REACHED' }));
    });

    it('allows active subscription under limit', async () => {
        pool.query
            .mockResolvedValueOnce({
                rows: [{ subscription_status: 'active', trial_ends_at: null, organization_id: 'org-1' }]
            })
            .mockResolvedValueOnce({ rows: [{ count: '200' }] }); // under 500 limit
        await checkUsageLimit(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    it('blocks active subscription at the limit', async () => {
        pool.query
            .mockResolvedValueOnce({
                rows: [{ subscription_status: 'active', trial_ends_at: null, organization_id: 'org-1' }]
            })
            .mockResolvedValueOnce({ rows: [{ count: '500' }] }); // at 500 limit
        await checkUsageLimit(req, res, next);
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'USAGE_LIMIT_REACHED',
            limit: 500
        }));
    });

    it('uses lower limit for past_due status', async () => {
        pool.query
            .mockResolvedValueOnce({
                rows: [{ subscription_status: 'past_due', trial_ends_at: null, organization_id: 'org-1' }]
            })
            .mockResolvedValueOnce({ rows: [{ count: '50' }] }); // at 50 limit
        await checkUsageLimit(req, res, next);
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    });

    it('blocks unknown subscription statuses', async () => {
        pool.query.mockResolvedValueOnce({
            rows: [{ subscription_status: 'unknown_status', trial_ends_at: null, organization_id: 'org-1' }]
        });
        await checkUsageLimit(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SUBSCRIPTION_INVALID' }));
    });

    it('returns 503 on database errors', async () => {
        pool.query.mockRejectedValueOnce(new Error('DB connection failed'));
        await checkUsageLimit(req, res, next);
        expect(res.status).toHaveBeenCalledWith(503);
    });
});
