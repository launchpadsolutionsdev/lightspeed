/**
 * Tests for compliance routes.
 * Compliance assistant: conversations, jurisdictions, admin KB management.
 */

jest.mock('../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/services/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../src/services/auditLog', () => ({ logAction: jest.fn() }));

jest.mock('../../src/middleware/auth', () => ({
    authenticate: (req, res, next) => {
        req.userId = req._testUserId || 'user-1';
        req.user = req._testUser || { id: 'user-1', is_super_admin: false, first_name: 'Test' };
        req.organizationId = req._testOrgId || 'org-1';
        next();
    },
    requireSuperAdmin: (req, res, next) => {
        if (req.user && req.user.is_super_admin) return next();
        return res.status(403).json({ error: 'Forbidden' });
    },
    requireOrganization: (req, res, next) => next(),
    checkUsageLimit: (req, res, next) => next(),
    checkAIRateLimit: (req, res, next) => next()
}));

jest.mock('../../src/services/claude', () => ({
    streamResponse: jest.fn()
}));

jest.mock('../../src/services/compliancePromptBuilder', () => ({
    buildComplianceSystemPrompt: jest.fn(() => 'mock-system-prompt'),
    buildDisclaimer: jest.fn(() => 'mock-disclaimer'),
    buildStaleWarning: jest.fn(() => null),
    buildWelcomeMessage: jest.fn(() => 'Welcome message'),
    parseCitations: jest.fn(() => []),
    MANDATORY_REMINDER: 'mock reminder'
}));

const request = require('supertest');
const express = require('express');
const pool = require('../../config/database');

function buildApp(routePath, routeModule) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        if (req.headers['x-test-user-id']) req._testUserId = req.headers['x-test-user-id'];
        if (req.headers['x-test-org-id']) req._testOrgId = req.headers['x-test-org-id'];
        if (req.headers['x-test-super-admin'] === 'true') {
            req._testUser = { id: req._testUserId || 'user-1', is_super_admin: true, first_name: 'Admin' };
        }
        next();
    });
    app.use(routePath, routeModule);
    return app;
}

describe('Compliance Routes', () => {
    let app;

    beforeEach(() => {
        app = buildApp('/api/compliance', require('../../src/routes/compliance'));
        pool.query.mockReset();
    });

    // ── GET /api/compliance/conversations ───────────────────────────────

    describe('GET /api/compliance/conversations', () => {
        it('returns user conversations', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [
                    { id: 1, jurisdiction_code: 'ON', title: 'Test conv', jurisdiction_name: 'Ontario' }
                ]
            });

            const res = await request(app)
                .get('/api/compliance/conversations');

            expect(res.status).toBe(200);
            expect(res.body.conversations).toHaveLength(1);
            expect(res.body.conversations[0].jurisdiction_code).toBe('ON');
        });
    });

    // ── DELETE /api/compliance/conversations/:id ───────────────────────

    describe('DELETE /api/compliance/conversations/:id', () => {
        it('returns 404 for non-existent conversation', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .delete('/api/compliance/conversations/999');

            expect(res.status).toBe(404);
        });

        it('deletes conversation', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

            const res = await request(app)
                .delete('/api/compliance/conversations/1');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    // ── GET /api/compliance/jurisdictions ───────────────────────────────

    describe('GET /api/compliance/jurisdictions', () => {
        it('returns jurisdiction list', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [
                    { code: 'ON', name: 'Ontario', regulatory_body: 'AGCO', is_active: true, entry_count: 10 },
                    { code: 'BC', name: 'British Columbia', regulatory_body: 'GPEB', is_active: true, entry_count: 5 }
                ]
            });

            const res = await request(app)
                .get('/api/compliance/jurisdictions');

            expect(res.status).toBe(200);
            expect(res.body.jurisdictions).toHaveLength(2);
            expect(res.body.jurisdictions[0].code).toBe('ON');
        });
    });

    // ── GET /api/compliance/welcome ────────────────────────────────────

    describe('GET /api/compliance/welcome', () => {
        it('returns 400 when no jurisdiction_code', async () => {
            const res = await request(app)
                .get('/api/compliance/welcome');

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/jurisdiction_code.*required/i);
        });

        it('returns welcome message for valid jurisdiction', async () => {
            // Get jurisdiction
            pool.query.mockResolvedValueOnce({
                rows: [{ code: 'ON', name: 'Ontario', regulatory_body: 'AGCO', regulatory_url: 'https://agco.ca', is_active: true }]
            });
            // Get latest verified date
            pool.query.mockResolvedValueOnce({
                rows: [{ latest: '2025-01-15' }]
            });

            const res = await request(app)
                .get('/api/compliance/welcome?jurisdiction_code=ON');

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Welcome message');
            expect(res.body.jurisdiction.code).toBe('ON');
        });
    });

    // ── Admin endpoints ────────────────────────────────────────────────

    describe('GET /api/compliance/admin/entries', () => {
        it('returns 403 for non-admin', async () => {
            const res = await request(app)
                .get('/api/compliance/admin/entries');

            expect(res.status).toBe(403);
        });

        it('lists entries with pagination', async () => {
            // COUNT query
            pool.query.mockResolvedValueOnce({ rows: [{ count: '3' }] });
            // SELECT entries
            pool.query.mockResolvedValueOnce({
                rows: [
                    { id: 1, title: 'Entry 1', jurisdiction_code: 'ON', category: 'licensing' },
                    { id: 2, title: 'Entry 2', jurisdiction_code: 'ON', category: 'reporting' },
                    { id: 3, title: 'Entry 3', jurisdiction_code: 'BC', category: 'licensing' }
                ]
            });

            const res = await request(app)
                .get('/api/compliance/admin/entries')
                .set('x-test-super-admin', 'true');

            expect(res.status).toBe(200);
            expect(res.body.entries).toHaveLength(3);
            expect(res.body.pagination).toBeTruthy();
            expect(res.body.pagination.total).toBe(3);
        });
    });

    describe('POST /api/compliance/admin/entries', () => {
        it('returns 403 for non-admin', async () => {
            const res = await request(app)
                .post('/api/compliance/admin/entries')
                .send({ jurisdiction_code: 'ON', category: 'licensing', title: 'Test', content: 'Content' });

            expect(res.status).toBe(403);
        });

        it('creates new entry', async () => {
            // Get jurisdiction info
            pool.query.mockResolvedValueOnce({
                rows: [{ name: 'Ontario', regulatory_body: 'AGCO' }]
            });
            // INSERT entry
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 1, jurisdiction_code: 'ON', title: 'New Entry', category: 'licensing', content: 'Content' }]
            });
            // Update entry count
            pool.query.mockResolvedValueOnce({ rowCount: 1 });

            const res = await request(app)
                .post('/api/compliance/admin/entries')
                .set('x-test-super-admin', 'true')
                .send({
                    jurisdiction_code: 'ON',
                    category: 'licensing',
                    title: 'New Entry',
                    content: 'Content'
                });

            expect(res.status).toBe(201);
            expect(res.body.entry).toBeTruthy();
            expect(res.body.entry.title).toBe('New Entry');
        });
    });

    describe('DELETE /api/compliance/admin/entries/:id', () => {
        it('returns 403 for non-admin', async () => {
            const res = await request(app)
                .delete('/api/compliance/admin/entries/1');

            expect(res.status).toBe(403);
        });

        it('soft-deletes entry', async () => {
            // Soft-delete (UPDATE is_active = false)
            pool.query.mockResolvedValueOnce({
                rows: [{ jurisdiction_code: 'ON' }]
            });
            // Update entry count
            pool.query.mockResolvedValueOnce({ rowCount: 1 });

            const res = await request(app)
                .delete('/api/compliance/admin/entries/1')
                .set('x-test-super-admin', 'true');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });
});
