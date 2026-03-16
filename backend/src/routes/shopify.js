/**
 * Shopify Integration Routes
 * OAuth install/callback, data sync, and data access endpoints
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');
const shopifyService = require('../services/shopify');

// Shopify App credentials from environment
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_SCOPES = 'read_products,read_orders,read_customers,read_inventory';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

/**
 * Helper: get the user's organization_id
 */
async function getOrgId(userId) {
    const result = await pool.query(
        'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
        [userId]
    );
    return result.rows[0]?.organization_id || null;
}

/**
 * Helper: require org admin/owner role
 */
async function requireOrgAdmin(userId, organizationId) {
    const result = await pool.query(
        'SELECT role FROM organization_memberships WHERE user_id = $1 AND organization_id = $2',
        [userId, organizationId]
    );
    const role = result.rows[0]?.role;
    return role === 'owner' || role === 'admin';
}

// ─── OAuth Flow ──────────────────────────────────────────────────────

/**
 * GET /api/shopify/install
 * Redirect the user to Shopify's OAuth authorization page.
 * Query params: ?shop=mystore.myshopify.com
 */
router.get('/install', authenticate, async (req, res) => {
    try {
        const { shop } = req.query;

        if (!shop) {
            return res.status(400).json({ error: 'Shop domain is required (e.g., mystore.myshopify.com)' });
        }

        if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
            return res.status(503).json({ error: 'Shopify integration is not configured. Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET.' });
        }

        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const isAdmin = await requireOrgAdmin(req.userId, organizationId);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Only admins and owners can connect Shopify stores' });
        }

        // Normalize shop domain
        const shopDomain = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');

        // Generate a nonce for CSRF protection
        const nonce = crypto.randomBytes(16).toString('hex');

        // Store the nonce temporarily (in-memory for simplicity; use Redis in production)
        // We encode org info in the state parameter
        const state = Buffer.from(JSON.stringify({
            nonce,
            organizationId,
            userId: req.userId
        })).toString('base64url');

        const redirectUri = `${BACKEND_URL}/api/shopify/callback`;
        const installUrl = `https://${shopDomain}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SHOPIFY_SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

        res.json({ installUrl, shopDomain });

    } catch (error) {
        console.error('Shopify install error:', error);
        res.status(500).json({ error: 'Failed to initiate Shopify installation' });
    }
});

/**
 * GET /api/shopify/callback
 * Shopify redirects here after the merchant authorizes the app.
 * Exchanges the temporary code for a permanent access token.
 */
router.get('/callback', async (req, res) => {
    try {
        const { code, shop, state, hmac } = req.query;

        if (!code || !shop || !state) {
            return res.status(400).send('Missing required parameters from Shopify');
        }

        if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
            return res.status(503).send('Shopify integration is not configured');
        }

        // Verify HMAC signature
        const queryParams = { ...req.query };
        delete queryParams.hmac;
        delete queryParams.signature;
        const sortedParams = Object.keys(queryParams).sort().map(key => `${key}=${queryParams[key]}`).join('&');
        const generatedHmac = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(sortedParams).digest('hex');

        if (hmac && generatedHmac !== hmac) {
            return res.status(400).send('HMAC validation failed');
        }

        // Decode state
        let stateData;
        try {
            stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
        } catch {
            return res.status(400).send('Invalid state parameter');
        }

        const { organizationId } = stateData;

        // Exchange code for permanent access token
        const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: SHOPIFY_API_KEY,
                client_secret: SHOPIFY_API_SECRET,
                code
            })
        });

        if (!tokenResponse.ok) {
            const errText = await tokenResponse.text();
            console.error('Shopify token exchange failed:', errText);
            return res.status(500).send('Failed to get access token from Shopify');
        }

        const tokenData = await tokenResponse.json();

        // Save the store connection
        await shopifyService.saveStoreConnection(organizationId, {
            shopDomain: shop,
            accessToken: tokenData.access_token,
            scope: tokenData.scope
        });

        // Register webhooks for real-time sync
        try {
            await shopifyService.registerWebhooks(organizationId, BACKEND_URL);
            console.log('Shopify webhooks registered after OAuth for org:', organizationId);
        } catch (webhookError) {
            console.error('Failed to register webhooks after OAuth (non-fatal):', webhookError.message);
        }

        // Redirect to the frontend settings page with success
        const frontendUrl = process.env.FRONTEND_URL || 'https://www.lightspeedutility.ca';
        res.redirect(`${frontendUrl}/#shopify-connected`);

    } catch (error) {
        console.error('Shopify callback error:', error);
        res.status(500).send('Failed to complete Shopify installation');
    }
});

// ─── Webhooks ────────────────────────────────────────────────────────

/**
 * POST /api/shopify/webhook
 * Receives real-time webhook events from Shopify.
 * Raw body is used for HMAC verification (configured in index.js).
 * No authentication middleware — verified via Shopify HMAC signature.
 */
router.post('/webhook', async (req, res) => {
    try {
        const hmac = req.headers['x-shopify-hmac-sha256'];
        const topic = req.headers['x-shopify-topic'];
        const shopDomain = req.headers['x-shopify-shop-domain'];

        if (!hmac || !topic || !shopDomain) {
            return res.status(400).send('Missing required Shopify headers');
        }

        if (!SHOPIFY_API_SECRET) {
            return res.status(503).send('Shopify integration not configured');
        }

        // Verify HMAC signature using raw body
        const rawBody = req.body;
        const generatedHmac = crypto
            .createHmac('sha256', SHOPIFY_API_SECRET)
            .update(rawBody)
            .digest('base64');

        if (generatedHmac !== hmac) {
            console.error('Shopify webhook HMAC verification failed', { topic, shopDomain });
            return res.status(401).send('HMAC verification failed');
        }

        // Parse the payload after verification
        const payload = JSON.parse(rawBody.toString('utf8'));

        // Respond immediately with 200 — Shopify retries on non-2xx
        res.status(200).send('OK');

        // Process asynchronously to avoid blocking the response
        shopifyService.handleWebhookEvent(shopDomain, topic, payload)
            .then(result => {
                if (result.handled) {
                    console.log(`Shopify webhook processed: ${topic} for ${shopDomain}`, { shopifyId: result.shopifyId });
                } else {
                    console.warn(`Shopify webhook not handled: ${result.reason}`, { topic, shopDomain });
                }
            })
            .catch(error => {
                console.error('Shopify webhook processing error:', error.message, { topic, shopDomain });
            });

    } catch (error) {
        console.error('Shopify webhook error:', error);
        if (!res.headersSent) {
            res.status(500).send('Webhook processing error');
        }
    }
});

/**
 * POST /api/shopify/webhooks/register
 * Manually trigger webhook registration with Shopify.
 * Requires admin role.
 */
router.post('/webhooks/register', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const isAdmin = await requireOrgAdmin(req.userId, organizationId);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Only admins and owners can manage webhooks' });
        }

        const store = await shopifyService.getStoreConnection(organizationId);
        if (!store) {
            return res.status(404).json({ error: 'No Shopify store connected' });
        }

        const webhookBaseUrl = BACKEND_URL;
        const result = await shopifyService.registerWebhooks(organizationId, webhookBaseUrl);

        res.json({
            success: true,
            message: `Registered ${result.registered} webhooks`,
            ...result
        });

    } catch (error) {
        console.error('Shopify webhook registration error:', error);
        res.status(500).json({ error: 'Failed to register webhooks' });
    }
});

// ─── Connection Management ───────────────────────────────────────────

/**
 * GET /api/shopify/status
 * Check if the organization has a connected Shopify store.
 */
router.get('/status', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const store = await shopifyService.getStoreConnection(organizationId);

        if (!store) {
            return res.json({
                connected: false,
                configured: !!(SHOPIFY_API_KEY && SHOPIFY_API_SECRET)
            });
        }

        // Get sync status
        const productCount = await shopifyService.getProductCount(organizationId);
        const customerCount = await shopifyService.getCustomerCount(organizationId);

        const orderCount = await pool.query(
            'SELECT COUNT(*) FROM shopify_orders WHERE organization_id = $1',
            [organizationId]
        );

        // Get recent sync errors
        const syncErrors = await pool.query(
            `SELECT sync_type, error_message, completed_at
             FROM shopify_sync_logs
             WHERE organization_id = $1 AND status = 'error'
             ORDER BY completed_at DESC LIMIT 5`,
            [organizationId]
        );

        res.json({
            connected: true,
            configured: true,
            shopDomain: store.shop_domain,
            syncSettings: store.sync_settings,
            webhooksRegistered: store.webhooks_registered || false,
            webhookUrl: store.webhook_url || null,
            lastSync: {
                products: store.last_products_sync_at,
                orders: store.last_orders_sync_at,
                customers: store.last_customers_sync_at
            },
            counts: {
                products: productCount,
                orders: parseInt(orderCount.rows[0].count),
                customers: customerCount
            },
            syncErrors: syncErrors.rows
        });

    } catch (error) {
        console.error('Shopify status error:', error);
        res.status(500).json({ error: 'Failed to check Shopify status' });
    }
});

/**
 * POST /api/shopify/disconnect
 * Disconnect the Shopify store.
 */
router.post('/disconnect', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const isAdmin = await requireOrgAdmin(req.userId, organizationId);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Only admins and owners can disconnect Shopify' });
        }

        // Unregister webhooks before disconnecting
        try {
            await shopifyService.unregisterWebhooks(organizationId);
        } catch (webhookError) {
            console.error('Failed to unregister webhooks (non-fatal):', webhookError.message);
        }

        await shopifyService.disconnectStore(organizationId);
        res.json({ success: true, message: 'Shopify store disconnected' });

    } catch (error) {
        console.error('Shopify disconnect error:', error);
        res.status(500).json({ error: 'Failed to disconnect Shopify store' });
    }
});

// ─── Manual Connect (API Key) ────────────────────────────────────────

/**
 * POST /api/shopify/connect
 * Connect a Shopify store using a manually-created custom app access token.
 * This is an alternative to OAuth for stores that prefer Admin API access tokens.
 */
router.post('/connect', authenticate, async (req, res) => {
    try {
        const { shopDomain, accessToken } = req.body;

        if (!shopDomain || !accessToken) {
            return res.status(400).json({ error: 'Shop domain and access token are required' });
        }

        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const isAdmin = await requireOrgAdmin(req.userId, organizationId);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Only admins and owners can connect Shopify stores' });
        }

        // Normalize domain
        const normalizedDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

        // Verify the token works by making a test API call
        const testResponse = await fetch(
            `https://${normalizedDomain}/admin/api/2024-01/shop.json`,
            {
                headers: {
                    'X-Shopify-Access-Token': accessToken,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!testResponse.ok) {
            return res.status(400).json({ error: 'Invalid access token or shop domain. Could not connect to Shopify.' });
        }

        const shopData = await testResponse.json();

        // Save the connection
        const store = await shopifyService.saveStoreConnection(organizationId, {
            shopDomain: normalizedDomain,
            accessToken,
            scope: 'read_products,read_orders,read_customers'
        });

        // Register webhooks for real-time sync
        let webhooksRegistered = false;
        try {
            await shopifyService.registerWebhooks(organizationId, BACKEND_URL);
            webhooksRegistered = true;
            console.log('Shopify webhooks registered after manual connect for org:', organizationId);
        } catch (webhookError) {
            console.error('Failed to register webhooks after manual connect (non-fatal):', webhookError.message);
        }

        res.json({
            success: true,
            shopDomain: normalizedDomain,
            shopName: shopData.shop?.name || normalizedDomain,
            webhooksRegistered,
            message: 'Shopify store connected successfully'
        });

    } catch (error) {
        console.error('Shopify connect error:', error);
        res.status(500).json({ error: 'Failed to connect Shopify store' });
    }
});

// ─── Data Sync ───────────────────────────────────────────────────────

/**
 * POST /api/shopify/sync
 * Trigger a manual sync of Shopify data.
 * Runs asynchronously — returns 202 immediately, frontend polls /sync/status.
 * Body: { types: ["products", "orders", "customers"] }
 */
router.post('/sync', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const store = await shopifyService.getStoreConnection(organizationId);
        if (!store) {
            return res.status(404).json({ error: 'No Shopify store connected' });
        }

        // Check if a sync is already running
        const running = await pool.query(
            `SELECT id FROM shopify_sync_logs WHERE organization_id = $1 AND status = 'running' LIMIT 1`,
            [organizationId]
        );
        if (running.rows.length > 0) {
            return res.status(202).json({ success: true, message: 'Sync already in progress', status: 'running' });
        }

        const { types = ['products', 'orders', 'customers'] } = req.body;

        // Respond immediately
        res.status(202).json({ success: true, message: 'Sync started', status: 'running' });

        // Run sync in background
        (async () => {
            try {
                if (types.includes('products')) {
                    await shopifyService.syncProducts(organizationId);
                }
                if (types.includes('orders')) {
                    await shopifyService.syncOrders(organizationId);
                }
                if (types.includes('customers')) {
                    await shopifyService.syncCustomers(organizationId);
                }
                console.log(`Shopify sync complete for org ${organizationId}`);
            } catch (err) {
                console.error(`Shopify background sync error for org ${organizationId}:`, err.message);
            }
        })();

    } catch (error) {
        console.error('Shopify sync error:', error);
        res.status(500).json({ error: error.message || 'Sync failed' });
    }
});

/**
 * GET /api/shopify/sync/status
 * Check if a sync is currently running and get latest results.
 */
router.get('/sync/status', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        // Check for running sync
        const running = await pool.query(
            `SELECT id, sync_type, started_at FROM shopify_sync_logs
             WHERE organization_id = $1 AND status = 'running'
             ORDER BY started_at DESC LIMIT 1`,
            [organizationId]
        );

        // Get latest completed syncs
        const latest = await pool.query(
            `SELECT sync_type, status, records_synced, error_message, completed_at
             FROM shopify_sync_logs
             WHERE organization_id = $1 AND status IN ('success', 'error')
             ORDER BY completed_at DESC LIMIT 5`,
            [organizationId]
        );

        const isRunning = running.rows.length > 0;
        const results = {};
        for (const row of latest.rows) {
            if (!results[row.sync_type]) {
                results[row.sync_type] = {
                    status: row.status,
                    synced: row.records_synced,
                    error: row.error_message,
                    completedAt: row.completed_at
                };
            }
        }

        res.json({
            running: isRunning,
            runningType: running.rows[0]?.sync_type || null,
            results
        });

    } catch (error) {
        console.error('Shopify sync status error:', error);
        res.status(500).json({ error: 'Failed to check sync status' });
    }
});

/**
 * GET /api/shopify/sync/logs
 * Get recent sync logs.
 */
router.get('/sync/logs', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const result = await pool.query(
            `SELECT * FROM shopify_sync_logs
             WHERE organization_id = $1
             ORDER BY created_at DESC
             LIMIT 20`,
            [organizationId]
        );

        res.json(result.rows);

    } catch (error) {
        console.error('Shopify sync logs error:', error);
        res.status(500).json({ error: 'Failed to fetch sync logs' });
    }
});

// ─── Data Access ─────────────────────────────────────────────────────

/**
 * GET /api/shopify/products
 * Get cached Shopify products.
 */
router.get('/products', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const { limit = 50, offset = 0, search = '' } = req.query;
        const products = await shopifyService.getProducts(organizationId, {
            limit: parseInt(limit),
            offset: parseInt(offset),
            search
        });

        const total = await shopifyService.getProductCount(organizationId);

        res.json({ products, total });

    } catch (error) {
        console.error('Shopify products error:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

/**
 * GET /api/shopify/orders
 * Get cached Shopify orders.
 */
router.get('/orders', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const { limit = 50, offset = 0, search = '', status = '' } = req.query;
        const orders = await shopifyService.getOrders(organizationId, {
            limit: parseInt(limit),
            offset: parseInt(offset),
            search,
            status
        });

        res.json({ orders });

    } catch (error) {
        console.error('Shopify orders error:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

/**
 * GET /api/shopify/orders/lookup
 * Look up a specific order by number or customer email.
 */
router.get('/orders/lookup', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const { orderNumber, email } = req.query;
        const orders = await shopifyService.lookupOrder(organizationId, { orderNumber, email });

        res.json({ orders });

    } catch (error) {
        console.error('Shopify order lookup error:', error);
        res.status(500).json({ error: 'Failed to look up order' });
    }
});

/**
 * GET /api/shopify/analytics
 * Get Shopify order analytics.
 */
router.get('/analytics', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const { days = 30 } = req.query;
        const analytics = await shopifyService.getOrderAnalytics(organizationId, {
            days: parseInt(days)
        });

        res.json(analytics);

    } catch (error) {
        console.error('Shopify analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

/**
 * GET /api/shopify/customers
 * Get cached Shopify customers.
 */
router.get('/customers', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const { limit = 50, offset = 0, search = '' } = req.query;
        const customers = await shopifyService.getCustomers(organizationId, {
            limit: parseInt(limit),
            offset: parseInt(offset),
            search
        });

        const total = await shopifyService.getCustomerCount(organizationId);

        res.json({ customers, total });

    } catch (error) {
        console.error('Shopify customers error:', error);
        res.status(500).json({ error: 'Failed to fetch customers' });
    }
});

/**
 * GET /api/shopify/customers/export
 * Export Shopify customers as a JSON array (for List Normalizer).
 */
router.get('/customers/export', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const result = await pool.query(
            `SELECT first_name, last_name, email, phone, city, province, country, zip, orders_count, total_spent, tags
             FROM shopify_customers
             WHERE organization_id = $1
             ORDER BY email ASC`,
            [organizationId]
        );

        res.json({ customers: result.rows, total: result.rows.length });

    } catch (error) {
        console.error('Shopify customer export error:', error);
        res.status(500).json({ error: 'Failed to export customers' });
    }
});

module.exports = router;
