/**
 * Tests for the per-user AI rate limiter in auth middleware.
 * Does not test JWT/DB-dependent middleware (those need integration tests).
 */

// We need to test checkAIRateLimit which is exported from auth.js
// but it depends on the module-level state. We test it by importing directly.
const { checkAIRateLimit } = require('../../src/middleware/auth');

describe('checkAIRateLimit', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            userId: 'test-user-123',
            user: { is_super_admin: false }
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        next = jest.fn();
    });

    it('allows requests under the limit', () => {
        // Use a unique user ID to avoid interference from other tests
        req.userId = `rate-limit-test-${Date.now()}-allow`;
        checkAIRateLimit(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    it('bypasses rate limit for super admins', () => {
        req.user.is_super_admin = true;
        req.userId = `rate-limit-test-${Date.now()}-admin`;

        // Call many times — should never be limited
        for (let i = 0; i < 20; i++) {
            next.mockClear();
            checkAIRateLimit(req, res, next);
            expect(next).toHaveBeenCalled();
        }
    });

    it('blocks requests over the limit', () => {
        const userId = `rate-limit-test-${Date.now()}-block`;
        req.userId = userId;

        // Send 11 requests (default limit is 10)
        for (let i = 0; i < 10; i++) {
            next.mockClear();
            res.status.mockClear();
            checkAIRateLimit(req, res, next);
        }

        // 11th should be blocked
        next.mockClear();
        checkAIRateLimit(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'AI_RATE_LIMIT' })
        );
    });
});
