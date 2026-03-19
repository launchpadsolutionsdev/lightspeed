/**
 * Tests for Home Base routes.
 * Categories, posts, and related CRUD operations.
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

jest.mock('../../src/services/cache', () => ({
    cache: { get: jest.fn(), set: jest.fn(), invalidatePrefix: jest.fn() },
    TTL: { HOME_BASE: 60000 }
}));
jest.mock('../../src/services/chunkingService', () => ({ chunkAndStore: jest.fn().mockResolvedValue({}) }));
jest.mock('../../src/services/embeddingService', () => ({ embedQuery: jest.fn(), formatForPgvector: jest.fn() }));
jest.mock('multer', () => {
    const m = jest.fn(() => ({
        single: jest.fn(() => (req, res, next) => next()),
        array: jest.fn(() => (req, res, next) => next())
    }));
    m.memoryStorage = jest.fn();
    return m;
});

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

describe('Home Base Routes', () => {
    let app;

    beforeEach(() => {
        app = buildApp('/api/home-base', require('../../src/routes/homeBase'));
        pool.query.mockReset();
    });

    // ── GET /api/home-base/categories ──────────────────────────────────

    describe('GET /api/home-base/categories', () => {
        it('returns categories list', async () => {
            // seedDefaultCategories: check existing count
            pool.query.mockResolvedValueOnce({ rows: [{ count: 5 }] });
            // getOrgCategories: fetch categories
            pool.query.mockResolvedValueOnce({
                rows: [
                    { slug: 'general', label: 'General', color: '#6B7280', sort_order: 0, is_default: true },
                    { slug: 'urgent', label: 'Urgent', color: '#DC2626', sort_order: 1, is_default: false }
                ]
            });

            const res = await request(app)
                .get('/api/home-base/categories');

            expect(res.status).toBe(200);
            expect(res.body.categories).toBeInstanceOf(Array);
            expect(res.body.categories.length).toBeGreaterThanOrEqual(2);
        });
    });

    // ── GET /api/home-base/posts ───────────────────────────────────────

    describe('GET /api/home-base/posts', () => {
        it('returns paginated posts', async () => {
            // getValidCategorySlugs -> getOrgCategories
            pool.query.mockResolvedValueOnce({
                rows: [{ slug: 'general' }, { slug: 'urgent' }]
            });
            // SELECT posts
            pool.query.mockResolvedValueOnce({
                rows: [
                    {
                        id: 1, body: 'Hello team', category: 'general', pinned: false,
                        pin_order: 0, created_at: '2025-01-01', author_id: 'user-1',
                        first_name: 'Test', last_name: 'User', comment_count: 0,
                        attachment_count: 0, requires_ack: false
                    }
                ]
            });
            // Batch load reactions
            pool.query.mockResolvedValueOnce({ rows: [] });
            // Batch load attachments
            pool.query.mockResolvedValueOnce({ rows: [] });
            // Batch load view counts
            pool.query.mockResolvedValueOnce({ rows: [] });
            // Batch load bookmarks
            pool.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .get('/api/home-base/posts');

            expect(res.status).toBe(200);
            expect(res.body.posts).toBeInstanceOf(Array);
            expect(res.body.posts).toHaveLength(1);
            expect(res.body.posts[0].body).toBe('Hello team');
        });
    });

    // ── POST /api/home-base/posts ──────────────────────────────────────

    describe('POST /api/home-base/posts', () => {
        it('creates a post', async () => {
            // getValidCategorySlugs -> getOrgCategories
            pool.query.mockResolvedValueOnce({
                rows: [{ slug: 'general' }, { slug: 'urgent' }]
            });
            // INSERT post
            pool.query.mockResolvedValueOnce({
                rows: [{
                    id: 1, organization_id: 'org-1', author_id: 'user-1',
                    body: 'New post content', category: 'general', pinned: false,
                    requires_ack: false, is_draft: false
                }]
            });
            // SELECT author info
            pool.query.mockResolvedValueOnce({
                rows: [{ first_name: 'Test', last_name: 'User' }]
            });
            // logActivity (fire-and-forget)
            pool.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .post('/api/home-base/posts')
                .send({ body: 'New post content', category: 'general' });

            expect(res.status).toBe(201);
            expect(res.body.post).toBeTruthy();
            expect(res.body.post.body).toBe('New post content');
        });
    });

    // ── DELETE /api/home-base/posts/:id ─────────────────────────────────

    describe('DELETE /api/home-base/posts/:id', () => {
        it('returns 404 when not found', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .delete('/api/home-base/posts/999');

            expect(res.status).toBe(404);
        });

        it('deletes post', async () => {
            // SELECT post to check authorship
            pool.query.mockResolvedValueOnce({
                rows: [{ author_id: 'user-1' }]
            });
            // isAdmin check (since we also check admin)
            pool.query.mockResolvedValueOnce({
                rows: [{ role: 'member' }]
            });
            // UPDATE archived = true
            pool.query.mockResolvedValueOnce({ rowCount: 1 });

            const res = await request(app)
                .delete('/api/home-base/posts/1');

            expect(res.status).toBe(200);
            expect(res.body.message).toMatch(/deleted/i);
        });
    });
});
