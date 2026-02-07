/**
 * Billing Routes
 * Stripe checkout, webhooks, and subscription management
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Stripe Price IDs
const PRICES = {
    monthly: 'price_1Sy1ZGD0OAjcDsbxIPhkdNP9',
    annual: 'price_1Sy1ZGD0OAjcDsbxmJMjLusk'
};

/**
 * POST /api/billing/webhook
 * Stripe webhook handler
 * NOTE: This route receives raw body (not JSON) for signature verification.
 * The raw body parsing is configured in index.js BEFORE the JSON parser.
 */
router.post('/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        console.log(`[Stripe] Processing event: ${event.type}`);

        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const orgId = session.metadata?.org_id;
                const plan = session.metadata?.plan || 'monthly';

                if (orgId) {
                    await pool.query(
                        `UPDATE organizations SET
                            stripe_customer_id = $1,
                            stripe_subscription_id = $2,
                            subscription_status = 'active',
                            subscription_plan = $3
                         WHERE id = $4`,
                        [session.customer, session.subscription, plan, orgId]
                    );
                    console.log(`[Stripe] Organization ${orgId} activated on ${plan} plan`);
                }
                break;
            }

            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                const status = subscription.status === 'active' ? 'active'
                    : subscription.status === 'past_due' ? 'past_due'
                    : subscription.status;

                await pool.query(
                    `UPDATE organizations SET
                        subscription_status = $1,
                        current_period_ends_at = to_timestamp($2)
                     WHERE stripe_subscription_id = $3`,
                    [status, subscription.current_period_end, subscription.id]
                );
                console.log(`[Stripe] Subscription ${subscription.id} updated to ${status}`);
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                await pool.query(
                    `UPDATE organizations SET
                        subscription_status = 'cancelled'
                     WHERE stripe_subscription_id = $1`,
                    [subscription.id]
                );
                console.log(`[Stripe] Subscription ${subscription.id} cancelled`);
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                await pool.query(
                    `UPDATE organizations SET
                        subscription_status = 'past_due'
                     WHERE stripe_customer_id = $1`,
                    [invoice.customer]
                );
                console.log(`[Stripe] Payment failed for customer ${invoice.customer}`);
                break;
            }

            case 'invoice.paid': {
                const invoice = event.data.object;
                await pool.query(
                    `UPDATE organizations SET
                        subscription_status = 'active',
                        current_period_ends_at = to_timestamp($1)
                     WHERE stripe_customer_id = $2`,
                    [invoice.lines?.data?.[0]?.period?.end || (Date.now() / 1000 + 30 * 86400), invoice.customer]
                );
                console.log(`[Stripe] Invoice paid for customer ${invoice.customer}`);
                break;
            }
        }

        res.json({ received: true });
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

/**
 * POST /api/billing/create-checkout-session
 * Create Stripe checkout session for monthly or annual plan
 */
router.post('/create-checkout-session', authenticate, async (req, res) => {
    try {
        const { plan } = req.body; // 'monthly' or 'annual'

        if (!PRICES[plan]) {
            return res.status(400).json({ error: 'Invalid plan. Use "monthly" or "annual".' });
        }

        // Get user's organization
        const orgResult = await pool.query(
            `SELECT o.*
             FROM organizations o
             JOIN organization_memberships om ON o.id = om.organization_id
             WHERE om.user_id = $1
             LIMIT 1`,
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(404).json({ error: 'No organization found. Please set up your organization first.' });
        }

        const org = orgResult.rows[0];

        // Don't allow checkout if already active
        if (org.subscription_status === 'active') {
            return res.status(400).json({ error: 'You already have an active subscription. Use the billing portal to manage it.' });
        }

        // Get user email for Stripe
        const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [req.userId]);
        const userEmail = userResult.rows[0]?.email;

        // Create or reuse Stripe customer
        let customerId = org.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: userEmail,
                name: org.name,
                metadata: { org_id: org.id.toString(), org_name: org.name }
            });
            customerId = customer.id;
            await pool.query(
                'UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2',
                [customerId, org.id]
            );
        }

        const frontendUrl = process.env.FRONTEND_URL || 'https://www.lightspeedutility.ca';

        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            mode: 'subscription',
            line_items: [{ price: PRICES[plan], quantity: 1 }],
            success_url: `${frontendUrl}/dashboard?checkout=success`,
            cancel_url: `${frontendUrl}/dashboard?checkout=cancelled`,
            metadata: { org_id: org.id.toString(), plan: plan },
            subscription_data: {
                metadata: { org_id: org.id.toString(), plan: plan }
            }
        });

        res.json({ url: session.url });

    } catch (error) {
        console.error('Create checkout session error:', error);
        res.status(500).json({ error: 'Failed to create checkout session. Please try again.' });
    }
});

/**
 * POST /api/billing/create-portal-session
 * Create Stripe customer portal session (manage subscription, update payment, cancel)
 */
router.post('/create-portal-session', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            `SELECT o.stripe_customer_id
             FROM organizations o
             JOIN organization_memberships om ON o.id = om.organization_id
             WHERE om.user_id = $1
             LIMIT 1`,
            [req.userId]
        );

        const customerId = orgResult.rows[0]?.stripe_customer_id;
        if (!customerId) {
            return res.status(404).json({ error: 'No billing account found. Please subscribe first.' });
        }

        const frontendUrl = process.env.FRONTEND_URL || 'https://www.lightspeedutility.ca';

        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${frontendUrl}/dashboard`
        });

        res.json({ url: session.url });

    } catch (error) {
        console.error('Create portal session error:', error);
        res.status(500).json({ error: 'Failed to create portal session' });
    }
});

/**
 * GET /api/billing/subscription
 * Get current subscription status for the user's organization
 */
router.get('/subscription', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            `SELECT o.subscription_status, o.subscription_plan, o.trial_ends_at,
                    o.current_period_ends_at, o.stripe_customer_id
             FROM organizations o
             JOIN organization_memberships om ON o.id = om.organization_id
             WHERE om.user_id = $1
             LIMIT 1`,
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(404).json({ error: 'No organization found' });
        }

        const org = orgResult.rows[0];

        res.json({
            status: org.subscription_status,
            plan: org.subscription_plan,
            trialEndsAt: org.trial_ends_at,
            currentPeriodEndsAt: org.current_period_ends_at,
            hasPaymentMethod: !!org.stripe_customer_id
        });

    } catch (error) {
        console.error('Get subscription error:', error);
        res.status(500).json({ error: 'Failed to get subscription' });
    }
});

module.exports = router;
