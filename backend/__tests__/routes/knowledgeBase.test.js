/**
 * Tests for knowledge base routes.
 * CRUD operations for custom knowledge entries.
 */

jest.mock('../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/services/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../src/services/auditLog', () => ({ logAction: jest.fn() }));

jest.mock('../../src/middleware/auth', () => ({
    authenticate: (req, res, next) => {
        req.userId = req._testUserId || 'user-1';
        req.user = req._testUser || { id: 'user-1', is_super_admin: false, first_name: 'Test' };
        req.organizationId = req._testNoOrg ? null : (req._testOrgId || 'org-1');
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

jest.mock('../../src/services/cache', () => ({ cache: { invalidatePrefix: jest.fn() }, TTL: {} }));
jest.mock('../../src/services/chunkingService', () => ({
    chunkAndStore: jest.fn().mockResolvedValue({}),
    rechunkAllEntries: jest.fn().mockResolvedValue({ processed: 5, totalChunks: 20 })
}));
jest.mock('mammoth', () => ({ convertToHtml: jest.fn() }));
jest.mock('multer', () => {
    const m = jest.fn(() => ({ single: jest.fn(() => (req, res, next) => next()) }));
    m.memoryStorage = jest.fn();
    return m;
});
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
        if (req.headers['x-test-no-org'] === 'true') req._testNoOrg = true;
        next();
    });
    app.use(routePath, routeModule);
    return app;
}

describe('Knowledge Base Routes', () => {
    let app;

    beforeEach(() => {
        app = buildApp('/api/knowledge-base', require('../../src/routes/knowledgeBase'));
        pool.query.mockReset();
    });

    // ── GET /api/knowledge-base ────────────────────────────────────────

    describe('GET /api/knowledge-base', () => {
        it('returns 400 when no organization found', async () => {
            // The mock auth always provides org-1 as fallback, so we test via the
            // x-test-no-org header + middleware override set up in buildApp.
            const res = await request(app)
                .get('/api/knowledge-base')
                .set('x-test-no-org', 'true');

            expect(res.status).toBe(400);
        });

        it('returns paginated entries list', async () => {
            // COUNT query
            pool.query.mockResolvedValueOnce({ rows: [{ count: '2' }] });
            // SELECT entries
            pool.query.mockResolvedValueOnce({
                rows: [
                    { id: 'kb-1', title: 'Entry 1', content: 'Content 1', category: 'faqs' },
                    { id: 'kb-2', title: 'Entry 2', content: 'Content 2', category: 'general' }
                ]
            });

            const res = await request(app)
                .get('/api/knowledge-base');

            expect(res.status).toBe(200);
            expect(res.body.entries).toHaveLength(2);
            expect(res.body.pagination).toBeTruthy();
            expect(res.body.pagination.total).toBe(2);
        });

        it('supports type filter', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'kb-1', title: 'Support Entry', kb_type: 'support' }]
            });

            const res = await request(app)
                .get('/api/knowledge-base?type=support');

            expect(res.status).toBe(200);
            expect(res.body.entries).toHaveLength(1);
        });
    });

    // ── GET /api/knowledge-base/search ─────────────────────────────────

    describe('GET /api/knowledge-base/search', () => {
        it('returns filtered entries with search query', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'kb-1', title: 'Lottery Rules', content: 'Rules content' }]
            });

            const res = await request(app)
                .get('/api/knowledge-base/search?q=lottery');

            expect(res.status).toBe(200);
            expect(res.body.entries).toHaveLength(1);
            expect(res.body.pagination).toBeTruthy();
        });
    });

    // ── POST /api/knowledge-base ───────────────────────────────────────

    describe('POST /api/knowledge-base', () => {
        it('returns 400 when title is missing', async () => {
            const res = await request(app)
                .post('/api/knowledge-base')
                .send({ content: 'Some content', category: 'faqs' });

            expect(res.status).toBe(400);
        });

        it('creates entry with combined tags', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'mock-uuid', title: 'New Entry', content: 'Content', category: 'faqs', tags: ['keyword:test'], kb_type: 'support' }]
            });

            const res = await request(app)
                .post('/api/knowledge-base')
                .send({
                    title: 'New Entry',
                    content: 'Content',
                    category: 'faqs',
                    keywords: ['test'],
                    lottery: 'lotto649'
                });

            expect(res.status).toBe(201);
            expect(res.body.entry).toBeTruthy();
        });

        it('returns 201 with created entry', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'mock-uuid', title: 'Entry', content: 'Body', category: 'general', tags: [], kb_type: 'support' }]
            });

            const res = await request(app)
                .post('/api/knowledge-base')
                .send({ title: 'Entry', content: 'Body', category: 'general' });

            expect(res.status).toBe(201);
            expect(res.body.entry.id).toBe('mock-uuid');
        });
    });

    // ── GET /api/knowledge-base/:id ────────────────────────────────────

    describe('GET /api/knowledge-base/:id', () => {
        it('returns entry by ID', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'kb-1', title: 'Found Entry', content: 'Content' }]
            });

            const res = await request(app)
                .get('/api/knowledge-base/kb-1');

            expect(res.status).toBe(200);
            expect(res.body.entry.id).toBe('kb-1');
        });

        it('returns 404 when not found', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .get('/api/knowledge-base/nonexistent');

            expect(res.status).toBe(404);
        });
    });

    // ── PUT /api/knowledge-base/:id ────────────────────────────────────

    describe('PUT /api/knowledge-base/:id', () => {
        it('updates entry successfully', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'kb-1', title: 'Updated', content: 'Updated content', category: 'faqs' }]
            });

            const res = await request(app)
                .put('/api/knowledge-base/kb-1')
                .send({ title: 'Updated', content: 'Updated content' });

            expect(res.status).toBe(200);
            expect(res.body.entry.title).toBe('Updated');
        });

        it('returns 404 when not found', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .put('/api/knowledge-base/nonexistent')
                .send({ title: 'Updated' });

            expect(res.status).toBe(404);
        });
    });

    // ── DELETE /api/knowledge-base/:id ──────────────────────────────────

    describe('DELETE /api/knowledge-base/:id', () => {
        it('deletes entry successfully', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'kb-1', title: 'Deleted Entry' }]
            });

            const res = await request(app)
                .delete('/api/knowledge-base/kb-1');

            expect(res.status).toBe(200);
            expect(res.body.message).toMatch(/deleted/i);
        });

        it('returns 404 when not found', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .delete('/api/knowledge-base/nonexistent');

            expect(res.status).toBe(404);
        });
    });

    // ── POST /api/knowledge-base/import ────────────────────────────────

    describe('POST /api/knowledge-base/import', () => {
        it('imports multiple entries', async () => {
            // First entry INSERT
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'mock-uuid', title: 'Entry 1', content: 'C1', category: 'faqs' }]
            });
            // Second entry INSERT
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'mock-uuid', title: 'Entry 2', content: 'C2', category: 'general' }]
            });

            const res = await request(app)
                .post('/api/knowledge-base/import')
                .send({
                    entries: [
                        { title: 'Entry 1', content: 'C1', category: 'faqs' },
                        { title: 'Entry 2', content: 'C2', category: 'general' }
                    ]
                });

            expect(res.status).toBe(200);
            expect(res.body.imported).toBe(2);
            expect(res.body.errors).toBe(0);
        });

        it('handles entries with missing fields', async () => {
            const res = await request(app)
                .post('/api/knowledge-base/import')
                .send({
                    entries: [
                        { title: 'No Content' },
                        { content: 'No Title', category: 'faqs' }
                    ]
                });

            expect(res.status).toBe(200);
            expect(res.body.imported).toBe(0);
            expect(res.body.errors).toBe(2);
        });
    });

    // ── POST /api/knowledge-base/rechunk ───────────────────────────────

    describe('POST /api/knowledge-base/rechunk', () => {
        it('triggers rechunking', async () => {
            const res = await request(app)
                .post('/api/knowledge-base/rechunk');

            expect(res.status).toBe(200);
            expect(res.body.message).toMatch(/re-chunked/i);
            expect(res.body.processed).toBe(5);
            expect(res.body.totalChunks).toBe(20);
        });
    });
});
