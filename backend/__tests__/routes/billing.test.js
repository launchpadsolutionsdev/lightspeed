/**
 * Tests for billing routes (Stripe checkout, webhooks, subscription management).
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

const mockStripe = {
    webhooks: { constructEvent: jest.fn() },
    customers: { create: jest.fn() },
    checkout: { sessions: { create: jest.fn() } },
    billingPortal: { sessions: { create: jest.fn() } },
    subscriptions: { cancel: jest.fn() }
};
jest.mock('stripe', () => jest.fn(() => mockStripe));

const request = require('supertest');
const express = require('express');
const pool = require('../../config/database');

function buildApp(routePath, routeModule) {
    const app = express();
    // The webhook route needs raw body, but for testing we send JSON and mock constructEvent
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

describe('Billing Routes', () => {
    let app;

    beforeEach(() => {
        app = buildApp('/api/billing', require('../../src/routes/billing'));
        pool.query.mockReset();
        mockStripe.webhooks.constructEvent.mockReset();
        mockStripe.customers.create.mockReset();
        mockStripe.checkout.sessions.create.mockReset();
    });

    // ── POST /api/billing/webhook ──────────────────────────────────────

    describe('POST /api/billing/webhook', () => {
        it('returns 400 when signature verification fails', async () => {
            mockStripe.webhooks.constructEvent.mockImplementation(() => {
                throw new Error('Invalid signature');
            });

            const res = await request(app)
                .post('/api/billing/webhook')
                .set('stripe-signature', 'bad-sig')
                .send({});

            expect(res.status).toBe(400);
        });

        it('handles checkout.session.completed', async () => {
            mockStripe.webhooks.constructEvent.mockReturnValueOnce({
                type: 'checkout.session.completed',
                data: {
                    object: {
                        customer: 'cus_123',
                        subscription: 'sub_123',
                        metadata: { org_id: 'org-1', plan: 'monthly' }
                    }
                }
            });

            pool.query.mockResolvedValueOnce({ rowCount: 1 });

            const res = await request(app)
                .post('/api/billing/webhook')
                .set('stripe-signature', 'valid-sig')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.received).toBe(true);
            expect(pool.query).toHaveBeenCalled();
        });

        it('handles customer.subscription.updated', async () => {
            mockStripe.webhooks.constructEvent.mockReturnValueOnce({
                type: 'customer.subscription.updated',
                data: {
                    object: {
                        id: 'sub_123',
                        status: 'active',
                        current_period_end: 1700000000
                    }
                }
            });

            pool.query.mockResolvedValueOnce({ rowCount: 1 });

            const res = await request(app)
                .post('/api/billing/webhook')
                .set('stripe-signature', 'valid-sig')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.received).toBe(true);
        });

        it('handles customer.subscription.deleted', async () => {
            mockStripe.webhooks.constructEvent.mockReturnValueOnce({
                type: 'customer.subscription.deleted',
                data: {
                    object: { id: 'sub_123' }
                }
            });

            pool.query.mockResolvedValueOnce({ rowCount: 1 });

            const res = await request(app)
                .post('/api/billing/webhook')
                .set('stripe-signature', 'valid-sig')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.received).toBe(true);
        });

        it('handles invoice.payment_failed', async () => {
            mockStripe.webhooks.constructEvent.mockReturnValueOnce({
                type: 'invoice.payment_failed',
                data: {
                    object: { customer: 'cus_123' }
                }
            });

            pool.query.mockResolvedValueOnce({ rowCount: 1 });

            const res = await request(app)
                .post('/api/billing/webhook')
                .set('stripe-signature', 'valid-sig')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.received).toBe(true);
        });

        it('handles invoice.paid', async () => {
            mockStripe.webhooks.constructEvent.mockReturnValueOnce({
                type: 'invoice.paid',
                data: {
                    object: {
                        customer: 'cus_123',
                        lines: { data: [{ period: { end: 1700000000 } }] }
                    }
                }
            });

            pool.query.mockResolvedValueOnce({ rowCount: 1 });

            const res = await request(app)
                .post('/api/billing/webhook')
                .set('stripe-signature', 'valid-sig')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.received).toBe(true);
        });
    });

    // ── POST /api/billing/create-checkout-session ──────────────────────

    describe('POST /api/billing/create-checkout-session', () => {
        it('returns 400 for invalid plan', async () => {
            const res = await request(app)
                .post('/api/billing/create-checkout-session')
                .send({ plan: 'invalid' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/invalid plan/i);
        });

        it('returns 404 when no org found', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .post('/api/billing/create-checkout-session')
                .send({ plan: 'monthly' });

            expect(res.status).toBe(404);
        });

        it('returns 400 when already active subscription', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'org-1', name: 'Org', subscription_status: 'active', stripe_customer_id: 'cus_123' }]
            });

            const res = await request(app)
                .post('/api/billing/create-checkout-session')
                .send({ plan: 'monthly' });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/already.*active/i);
        });

        it('creates checkout session', async () => {
            // Get org
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 'org-1', name: 'Org', subscription_status: 'trial', stripe_customer_id: null }]
            });
            // Get user email
            pool.query.mockResolvedValueOnce({
                rows: [{ email: 'test@example.com' }]
            });
            // Update org with stripe customer id
            pool.query.mockResolvedValueOnce({ rowCount: 1 });

            mockStripe.customers.create.mockResolvedValueOnce({ id: 'cus_new' });
            mockStripe.checkout.sessions.create.mockResolvedValueOnce({
                url: 'https://checkout.stripe.com/session/123'
            });

            const res = await request(app)
                .post('/api/billing/create-checkout-session')
                .send({ plan: 'monthly' });

            expect(res.status).toBe(200);
            expect(res.body.url).toMatch(/stripe\.com/);
        });
    });

    // ── GET /api/billing/subscription ──────────────────────────────────

    describe('GET /api/billing/subscription', () => {
        it('returns subscription status', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [{
                    subscription_status: 'active',
                    subscription_plan: 'monthly',
                    trial_ends_at: null,
                    current_period_ends_at: '2025-12-31',
                    stripe_customer_id: 'cus_123'
                }]
            });

            const res = await request(app)
                .get('/api/billing/subscription');

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('active');
            expect(res.body.plan).toBe('monthly');
            expect(res.body.hasPaymentMethod).toBe(true);
        });

        it('returns 404 when no org', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .get('/api/billing/subscription');

            expect(res.status).toBe(404);
        });
    });
});
