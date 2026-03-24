/**
 * Tests for authentication routes.
 * Mocks Google/Microsoft OAuth libraries and database pool.
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

const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
    OAuth2Client: jest.fn().mockImplementation(() => ({
        verifyIdToken: mockVerifyIdToken
    }))
}));

const mockAcquireTokenByCode = jest.fn();
jest.mock('@azure/msal-node', () => ({
    ConfidentialClientApplication: jest.fn().mockImplementation(() => ({
        acquireTokenByCode: mockAcquireTokenByCode
    }))
}));

jest.mock('jsonwebtoken', () => ({
    sign: jest.fn(() => 'mock-jwt-token'),
    verify: jest.fn()
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

describe('Auth Routes', () => {
    let app;

    beforeEach(() => {
        app = buildApp('/api/auth', require('../../src/routes/auth'));
        pool.query.mockReset();
        mockVerifyIdToken.mockReset();
        mockAcquireTokenByCode.mockReset();
        global.fetch = jest.fn();
    });

    afterEach(() => {
        delete global.fetch;
    });

    // ── POST /api/auth/google ──────────────────────────────────────────

    describe('POST /api/auth/google', () => {
        it('returns 401 when no credential or accessToken provided', async () => {
            const res = await request(app)
                .post('/api/auth/google')
                .send({});
            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/credential.*required|required/i);
        });

        it('creates new user when Google credential is valid', async () => {
            mockVerifyIdToken.mockResolvedValueOnce({
                getPayload: () => ({
                    email: 'new@example.com',
                    name: 'New User',
                    sub: 'google-123',
                    picture: 'https://pic.example.com/photo.jpg'
                })
            });

            // SELECT user by email/google_id -> not found
            pool.query.mockResolvedValueOnce({ rows: [] });
            // INSERT new user
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'mock-uuid', email: 'new@example.com', first_name: 'New', last_name: 'User', picture: 'https://pic.example.com/photo.jpg', is_super_admin: false }]
            });
            // Check pending invitations -> none
            pool.query.mockResolvedValueOnce({ rows: [] });
            // Get user's organization -> none
            pool.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .post('/api/auth/google')
                .send({ credential: 'valid-google-token' });

            expect(res.status).toBe(200);
            expect(res.body.token).toBe('mock-jwt-token');
            expect(res.body.isNewUser).toBe(true);
            expect(res.body.needsOrganization).toBe(true);
        });

        it('returns existing user when they already exist', async () => {
            mockVerifyIdToken.mockResolvedValueOnce({
                getPayload: () => ({
                    email: 'existing@example.com',
                    name: 'Existing User',
                    sub: 'google-456',
                    picture: 'https://pic.example.com/photo.jpg'
                })
            });

            // SELECT user -> found
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'existing-id', email: 'existing@example.com', first_name: 'Existing', last_name: 'User', picture: null, is_super_admin: false }]
            });
            // UPDATE existing user
            pool.query.mockResolvedValueOnce({ rowCount: 1 });
            // Get user's organization
            pool.query.mockResolvedValueOnce({ rows: [{ id: 'org-1', name: 'Test Org', role: 'member' }] });

            const res = await request(app)
                .post('/api/auth/google')
                .send({ credential: 'valid-google-token' });

            expect(res.status).toBe(200);
            expect(res.body.isNewUser).toBe(false);
            expect(res.body.needsOrganization).toBe(false);
            expect(res.body.organization).toBeTruthy();
        });

        it('auto-joins organization from pending invitation', async () => {
            mockVerifyIdToken.mockResolvedValueOnce({
                getPayload: () => ({
                    email: 'invited@example.com',
                    name: 'Invited User',
                    sub: 'google-789',
                    picture: null
                })
            });

            // SELECT user -> not found
            pool.query.mockResolvedValueOnce({ rows: [] });
            // INSERT new user
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'mock-uuid', email: 'invited@example.com', first_name: 'Invited', last_name: 'User', picture: null, is_super_admin: false }]
            });
            // Check pending invitations -> found one
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'invite-1', organization_id: 'org-2', role: 'member', invited_by: 'user-owner', created_at: new Date() }]
            });
            // INSERT organization_memberships
            pool.query.mockResolvedValueOnce({ rowCount: 1 });
            // DELETE invitation
            pool.query.mockResolvedValueOnce({ rowCount: 1 });
            // Get user's organization
            pool.query.mockResolvedValueOnce({ rows: [{ id: 'org-2', name: 'Invited Org', role: 'member' }] });

            const res = await request(app)
                .post('/api/auth/google')
                .send({ credential: 'valid-google-token' });

            expect(res.status).toBe(200);
            expect(res.body.isNewUser).toBe(true);
            expect(res.body.needsOrganization).toBe(false);
        });

        it('returns 401 when Google token verification fails', async () => {
            mockVerifyIdToken.mockRejectedValueOnce(new Error('Invalid token'));

            const res = await request(app)
                .post('/api/auth/google')
                .send({ credential: 'invalid-token' });

            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/invalid/i);
        });
    });

    // ── POST /api/auth/microsoft ───────────────────────────────────────

    describe('POST /api/auth/microsoft', () => {
        it('returns 400 when no accessToken or code provided', async () => {
            const res = await request(app)
                .post('/api/auth/microsoft')
                .send({});
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/access token|authorization code|required/i);
        });

        it('creates new user with Microsoft accessToken', async () => {
            // Mock Graph API call for /me
            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    mail: 'ms@example.com',
                    displayName: 'MS User',
                    id: 'ms-123'
                })
            });
            // Mock photo fetch (not found)
            global.fetch.mockResolvedValueOnce({ ok: false });

            // SELECT user -> not found
            pool.query.mockResolvedValueOnce({ rows: [] });
            // INSERT new user
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'mock-uuid', email: 'ms@example.com', first_name: 'MS', last_name: 'User', picture: null, is_super_admin: false }]
            });
            // Check pending invitations -> none
            pool.query.mockResolvedValueOnce({ rows: [] });
            // Get user's organization -> none
            pool.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .post('/api/auth/microsoft')
                .send({ accessToken: 'valid-ms-token' });

            expect(res.status).toBe(200);
            expect(res.body.token).toBe('mock-jwt-token');
            expect(res.body.isNewUser).toBe(true);
        });

        it('returns 401 when Microsoft token is invalid', async () => {
            global.fetch.mockResolvedValueOnce({ ok: false });

            const res = await request(app)
                .post('/api/auth/microsoft')
                .send({ accessToken: 'invalid-token' });

            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/invalid/i);
        });
    });

    // ── GET /api/auth/me ───────────────────────────────────────────────

    describe('GET /api/auth/me', () => {
        it('returns current user and organization', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'org-1', name: 'Test Org', role: 'owner' }]
            });

            const res = await request(app)
                .get('/api/auth/me');

            expect(res.status).toBe(200);
            expect(res.body.user).toBeTruthy();
            expect(res.body.user.id).toBe('user-1');
            expect(res.body.organization).toBeTruthy();
            expect(res.body.needsOrganization).toBe(false);
        });
    });

    // ── POST /api/auth/create-organization ─────────────────────────────

    describe('POST /api/auth/create-organization', () => {
        it('returns 400 when name is missing', async () => {
            const res = await request(app)
                .post('/api/auth/create-organization')
                .send({});
            expect(res.status).toBe(400);
        });

        it('creates org and adds user as owner', async () => {
            // Check existing memberships -> none
            pool.query.mockResolvedValueOnce({ rows: [] });
            // INSERT organization
            pool.query.mockResolvedValueOnce({ rowCount: 1 });
            // INSERT membership
            pool.query.mockResolvedValueOnce({ rowCount: 1 });
            // seedOrgStarterContent: INSERT templates from system library
            pool.query.mockResolvedValueOnce({ rowCount: 5 });
            // seedOrgStarterContent: INSERT starter response rules
            pool.query.mockResolvedValueOnce({ rowCount: 2 });
            // SELECT created org
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'mock-uuid', name: 'New Org', slug: 'new-org', subscription_status: 'trial' }]
            });

            const res = await request(app)
                .post('/api/auth/create-organization')
                .send({ name: 'New Org' });

            expect(res.status).toBe(201);
            expect(res.body.organization).toBeTruthy();
            expect(res.body.organization.role).toBe('owner');
        });

        it('returns 400 if user already has an org', async () => {
            // Check existing memberships -> found
            pool.query.mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] });

            const res = await request(app)
                .post('/api/auth/create-organization')
                .send({ name: 'Another Org' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/already/i);
        });
    });
});
