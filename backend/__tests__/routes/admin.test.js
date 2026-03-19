/**
 * Tests for admin routes.
 * All admin routes require authenticate + requireSuperAdmin.
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

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

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

describe('Admin Routes', () => {
    let app;

    beforeEach(() => {
        app = buildApp('/api/admin', require('../../src/routes/admin'));
        pool.query.mockReset();
    });

    // ── GET /api/admin/dashboard ───────────────────────────────────────

    describe('GET /api/admin/dashboard', () => {
        it('returns 403 for non-super-admin', async () => {
            const res = await request(app)
                .get('/api/admin/dashboard');
            expect(res.status).toBe(403);
        });

        it('returns dashboard data with all sections', async () => {
            // Mock the ~20 sequential pool.query calls made by the dashboard endpoint
            const countRow = (count) => ({ rows: [{ count: String(count) }] });

            pool.query
                // overview counts
                .mockResolvedValueOnce(countRow(100))  // user count
                .mockResolvedValueOnce(countRow(10))   // org count
                .mockResolvedValueOnce(countRow(5))    // new users today
                .mockResolvedValueOnce(countRow(3))    // new orgs this week
                .mockResolvedValueOnce(countRow(42))   // active users 7 days
                .mockResolvedValueOnce(countRow(12))   // active users today
                .mockResolvedValueOnce(countRow(500))  // total requests 30 days
                .mockResolvedValueOnce(countRow(20))   // requests today
                // perf metrics
                .mockResolvedValueOnce({ rows: [{ avg_response_time: '250.5', success_rate: '98' }] })
                // tool usage
                .mockResolvedValueOnce({ rows: [{ tool: 'chat', count: '200', tokens: '50000' }] })
                // daily activity
                .mockResolvedValueOnce({ rows: [{ date: '2025-01-01', requests: '30', users: '5' }] })
                // subscription stats
                .mockResolvedValueOnce(countRow(5))   // trial
                .mockResolvedValueOnce(countRow(3))   // active
                .mockResolvedValueOnce(countRow(1))   // cancelled
                // response quality
                .mockResolvedValueOnce({ rows: [{ total_responses: '200', responses_today: '10', rated: '50', positive: '45', negative: '5', avg_response_time_ms: '300', avg_word_count: '150' }] })
                // kb overview
                .mockResolvedValueOnce({ rows: [{ total_entries: '30', auto_corrections: '5', orgs_with_kb: '8' }] })
                .mockResolvedValueOnce({ rows: [{ category: 'faqs', count: '15' }] })
                // content stats
                .mockResolvedValueOnce(countRow(25))  // conversations
                .mockResolvedValueOnce(countRow(10))  // shared prompts
                .mockResolvedValueOnce({ rows: [{ title: 'Top Prompt', usage_count: 5 }] });

            const res = await request(app)
                .get('/api/admin/dashboard')
                .set('x-test-super-admin', 'true');

            expect(res.status).toBe(200);
            expect(res.body.overview).toBeTruthy();
            expect(res.body.overview.totalUsers).toBe(100);
            expect(res.body.overview.totalOrganizations).toBe(10);
            expect(res.body.subscriptions).toBeTruthy();
            expect(res.body.toolUsage).toBeInstanceOf(Array);
        });
    });

    // ── GET /api/admin/users ───────────────────────────────────────────

    describe('GET /api/admin/users', () => {
        it('returns paginated user list', async () => {
            pool.query
                .mockResolvedValueOnce({
                    rows: [{ id: 'u1', email: 'a@b.com', first_name: 'A', last_name: 'B', is_super_admin: false }]
                })
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });

            const res = await request(app)
                .get('/api/admin/users')
                .set('x-test-super-admin', 'true');

            expect(res.status).toBe(200);
            expect(res.body.users).toBeInstanceOf(Array);
            expect(res.body.total).toBe(1);
        });

        it('supports search parameter', async () => {
            pool.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            const res = await request(app)
                .get('/api/admin/users?search=test')
                .set('x-test-super-admin', 'true');

            expect(res.status).toBe(200);
            expect(res.body.users).toEqual([]);
            expect(res.body.total).toBe(0);
        });
    });

    // ── PATCH /api/admin/users/:userId/super-admin ─────────────────────

    describe('PATCH /api/admin/users/:userId/super-admin', () => {
        it('returns 400 when trying to change own status', async () => {
            const res = await request(app)
                .patch('/api/admin/users/user-1/super-admin')
                .set('x-test-super-admin', 'true')
                .send({ isSuperAdmin: true });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/own/i);
        });

        it('updates super admin status', async () => {
            pool.query.mockResolvedValueOnce({ rowCount: 1 });

            const res = await request(app)
                .patch('/api/admin/users/other-user/super-admin')
                .set('x-test-super-admin', 'true')
                .send({ isSuperAdmin: true });

            expect(res.status).toBe(200);
            expect(res.body.message).toMatch(/updated/i);
        });
    });

    // ── DELETE /api/admin/users/:userId ─────────────────────────────────

    describe('DELETE /api/admin/users/:userId', () => {
        it('returns 400 when trying to delete self', async () => {
            const res = await request(app)
                .delete('/api/admin/users/user-1')
                .set('x-test-super-admin', 'true');

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/own|yourself/i);
        });

        it('returns 404 when user not found', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .delete('/api/admin/users/nonexistent')
                .set('x-test-super-admin', 'true');

            expect(res.status).toBe(404);
        });

        it('returns 400 when deleting a super admin', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'other-admin', email: 'admin@test.com', first_name: 'A', last_name: 'B', is_super_admin: true }]
            });

            const res = await request(app)
                .delete('/api/admin/users/other-admin')
                .set('x-test-super-admin', 'true');

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/super admin/i);
        });

        it('deletes regular user successfully', async () => {
            // Get user details
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'regular-user', email: 'reg@test.com', first_name: 'R', last_name: 'U', is_super_admin: false }]
            });
            // Nullify soft references (4 queries)
            pool.query.mockResolvedValueOnce({ rowCount: 0 });
            pool.query.mockResolvedValueOnce({ rowCount: 0 });
            pool.query.mockResolvedValueOnce({ rowCount: 0 });
            pool.query.mockResolvedValueOnce({ rowCount: 0 });
            // DELETE user
            pool.query.mockResolvedValueOnce({ rowCount: 1 });

            const res = await request(app)
                .delete('/api/admin/users/regular-user')
                .set('x-test-super-admin', 'true');

            expect(res.status).toBe(200);
            expect(res.body.message).toMatch(/deleted/i);
        });
    });

    // ── POST /api/admin/organizations ──────────────────────────────────

    describe('POST /api/admin/organizations', () => {
        it('returns 400 when name is empty', async () => {
            const res = await request(app)
                .post('/api/admin/organizations')
                .set('x-test-super-admin', 'true')
                .send({ name: '' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/name.*required/i);
        });

        it('creates organization successfully', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'mock-uuid', name: 'New Org', slug: 'new-org', subscription_status: 'trial' }]
            });

            const res = await request(app)
                .post('/api/admin/organizations')
                .set('x-test-super-admin', 'true')
                .send({ name: 'New Org' });

            expect(res.status).toBe(201);
            expect(res.body.organization).toBeTruthy();
            expect(res.body.organization.name).toBe('New Org');
        });
    });

    // ── DELETE /api/admin/organizations/:orgId ─────────────────────────

    describe('DELETE /api/admin/organizations/:orgId', () => {
        it('returns 404 when org not found', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .delete('/api/admin/organizations/nonexistent')
                .set('x-test-super-admin', 'true');

            expect(res.status).toBe(404);
        });

        it('returns 400 when org has active Stripe subscription', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'org-x', name: 'Paid Org', slug: 'paid', subscription_status: 'active', stripe_subscription_id: 'sub_123' }]
            });

            const res = await request(app)
                .delete('/api/admin/organizations/org-x')
                .set('x-test-super-admin', 'true');

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/stripe|subscription/i);
        });

        it('deletes org successfully', async () => {
            // Get org details
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'org-del', name: 'Del Org', slug: 'del', subscription_status: 'trial', stripe_subscription_id: null }]
            });
            // Get member count
            pool.query.mockResolvedValueOnce({ rows: [{ count: '2' }] });
            // DELETE org
            pool.query.mockResolvedValueOnce({ rowCount: 1 });

            const res = await request(app)
                .delete('/api/admin/organizations/org-del')
                .set('x-test-super-admin', 'true');

            expect(res.status).toBe(200);
            expect(res.body.message).toMatch(/deleted/i);
        });
    });
});
