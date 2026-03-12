/**
 * Tests for data deletion endpoints (PIPEDA/GDPR compliance).
 * Mocks the database pool and Stripe to test authorization and deletion logic.
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

jest.mock('../../src/services/auditLog', () => ({
    logAction: jest.fn()
}));

jest.mock('../../src/middleware/auth', () => ({
    authenticate: (req, res, next) => {
        req.userId = req._testUserId || 'user-1';
        req.user = req._testUser || { is_super_admin: false };
        next();
    }
}));

// Mock stripe
jest.mock('stripe', () => {
    return jest.fn(() => ({
        subscriptions: { cancel: jest.fn().mockResolvedValue({}) }
    }));
});

const request = require('supertest');
const express = require('express');
const pool = require('../../config/database');

// Build a minimal Express app with the export routes
function buildApp() {
    const app = express();
    app.use(express.json());
    // Inject test user ID via middleware
    app.use((req, res, next) => {
        if (req.headers['x-test-user-id']) req._testUserId = req.headers['x-test-user-id'];
        next();
    });
    app.use('/api/organizations', require('../../src/routes/export'));
    return app;
}

describe('DELETE /api/organizations/:orgId/data', () => {
    let app;

    beforeEach(() => {
        app = buildApp();
        pool.query.mockReset();
    });

    it('rejects without confirmation', async () => {
        const res = await request(app)
            .delete('/api/organizations/org-1/data')
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/confirmation/i);
    });

    it('rejects non-members', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] }); // membership check
        const res = await request(app)
            .delete('/api/organizations/org-1/data')
            .send({ confirm: 'DELETE' });
        expect(res.status).toBe(403);
    });

    it('rejects non-owners', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ role: 'admin' }] }); // membership check
        const res = await request(app)
            .delete('/api/organizations/org-1/data')
            .send({ confirm: 'DELETE' });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/owner/i);
    });

    it('deletes organization for owners with confirmation', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ role: 'owner' }] }) // membership check
            .mockResolvedValueOnce({ rows: [{ name: 'Test Org', stripe_subscription_id: null, stripe_customer_id: null }] }) // org details
            .mockResolvedValueOnce({ rowCount: 1 }); // DELETE org

        const res = await request(app)
            .delete('/api/organizations/org-1/data')
            .send({ confirm: 'DELETE' });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/permanently deleted/i);
    });

    it('returns 404 for non-existent org', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ role: 'owner' }] }) // membership check
            .mockResolvedValueOnce({ rows: [] }); // org not found
        const res = await request(app)
            .delete('/api/organizations/org-1/data')
            .send({ confirm: 'DELETE' });
        expect(res.status).toBe(404);
    });
});

describe('DELETE /api/organizations/:orgId/user-data', () => {
    let app;

    beforeEach(() => {
        app = buildApp();
        pool.query.mockReset();
    });

    it('allows users to delete their own data', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ role: 'member' }] }) // target membership check
            .mockResolvedValueOnce({ rowCount: 5 }) // anonymize response history
            .mockResolvedValueOnce({ rowCount: 2 }) // delete favorites
            .mockResolvedValueOnce({ rowCount: 1 }); // remove membership

        const res = await request(app)
            .delete('/api/organizations/org-1/user-data')
            .send({}); // no userId = self
        expect(res.status).toBe(200);
        expect(res.body.responses_anonymized).toBe(5);
    });

    it('rejects non-owners deleting other users data', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ role: 'member' }] }); // requester's membership
        const res = await request(app)
            .delete('/api/organizations/org-1/user-data')
            .send({ userId: 'other-user' });
        expect(res.status).toBe(403);
    });

    it('returns 404 for non-member target user', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] }); // target membership check
        const res = await request(app)
            .delete('/api/organizations/org-1/user-data')
            .send({}); // self-delete, but not a member
        expect(res.status).toBe(404);
    });
});
