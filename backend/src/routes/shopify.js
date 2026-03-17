/**
 * Shopify Integration Routes
 * OAuth install/callback, webhooks, connection management, and live data endpoints.
 * Orders/customers are queried directly from Shopify API — no local sync.
 * Only products are synced locally (small catalog).
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');
const shopifyService = require('../services/shopify');

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_SCOPES = 'read_products,read_orders,read_customers,read_inventory';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

async function getOrgId(userId) {
    const result = await pool.query(
        'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
        [userId]
    );
    return result.rows[0]?.organization_id || null;
}

async function requireOrgAdmin(userId, organizationId) {
    const result = await pool.query(
        'SELECT role FROM organization_memberships WHERE user_id = $1 AND organization_id = $2',
        [userId, organizationId]
    );
    const role = result.rows[0]?.role;
    return role === 'owner' || role === 'admin';
}

// ─── OAuth Flow ──────────────────────────────────────────────────────

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

        const shopDomain = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const nonce = crypto.randomBytes(16).toString('hex');

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

router.get('/callback', async (req, res) => {
    try {
        const { code, shop, state, hmac } = req.query;

        if (!code || !shop || !state) {
            return res.status(400).send('Missing required parameters from Shopify');
        }

        if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
            return res.status(503).send('Shopify integration is not configured');
        }

        const queryParams = { ...req.query };
        delete queryParams.hmac;
        delete queryParams.signature;
        const sortedParams = Object.keys(queryParams).sort().map(key => `${key}=${queryParams[key]}`).join('&');
        const generatedHmac = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(sortedParams).digest('hex');

        if (hmac && generatedHmac !== hmac) {
            return res.status(400).send('HMAC validation failed');
        }

        let stateData;
        try {
            stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
        } catch {
            return res.status(400).send('Invalid state parameter');
        }

        const { organizationId } = stateData;

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

        await shopifyService.saveStoreConnection(organizationId, {
            shopDomain: shop,
            accessToken: tokenData.access_token,
            scope: tokenData.scope
        });

        // Register product webhooks
        try {
            await shopifyService.registerWebhooks(organizationId, BACKEND_URL);
        } catch (webhookError) {
            console.error('Failed to register webhooks after OAuth (non-fatal):', webhookError.message);
        }

        // Sync products in background (small catalog)
        shopifyService.syncProducts(organizationId).catch(err => {
            console.error('Product sync after OAuth failed (non-fatal):', err.message);
        });

        const frontendUrl = process.env.FRONTEND_URL || 'https://www.lightspeedutility.ca';
        res.redirect(`${frontendUrl}/#shopify-connected`);

    } catch (error) {
        console.error('Shopify callback error:', error);
        res.status(500).send('Failed to complete Shopify installation');
    }
});

// ─── Webhooks ────────────────────────────────────────────────────────

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

        const rawBody = req.body;
        const generatedHmac = crypto
            .createHmac('sha256', SHOPIFY_API_SECRET)
            .update(rawBody)
            .digest('base64');

        if (generatedHmac !== hmac) {
            console.error('Shopify webhook HMAC verification failed', { topic, shopDomain });
            return res.status(401).send('HMAC verification failed');
        }

        const payload = JSON.parse(rawBody.toString('utf8'));
        res.status(200).send('OK');

        shopifyService.handleWebhookEvent(shopDomain, topic, payload)
            .then(result => {
                if (result.handled) {
                    console.log(`Shopify webhook processed: ${topic} for ${shopDomain}`, { shopifyId: result.shopifyId });
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

        const result = await shopifyService.registerWebhooks(organizationId, BACKEND_URL);

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

        const productCount = await shopifyService.getProductCount(organizationId);

        res.json({
            connected: true,
            configured: true,
            shopDomain: store.shop_domain,
            webhooksRegistered: store.webhooks_registered || false,
            counts: {
                products: productCount
            }
        });

    } catch (error) {
        console.error('Shopify status error:', error);
        res.status(500).json({ error: 'Failed to check Shopify status' });
    }
});

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

        const normalizedDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

        const testResponse = await fetch(
            `https://${normalizedDomain}/admin/api/2025-04/shop.json`,
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

        await shopifyService.saveStoreConnection(organizationId, {
            shopDomain: normalizedDomain,
            accessToken,
            scope: 'read_products,read_orders,read_customers'
        });

        // Register product webhooks
        let webhooksRegistered = false;
        try {
            await shopifyService.registerWebhooks(organizationId, BACKEND_URL);
            webhooksRegistered = true;
        } catch (webhookError) {
            console.error('Failed to register webhooks after manual connect (non-fatal):', webhookError.message);
        }

        // Sync products in background (small catalog)
        shopifyService.syncProducts(organizationId).catch(err => {
            console.error('Product sync after connect failed (non-fatal):', err.message);
        });

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

// ─── Sync (products only) ────────────────────────────────────────────

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

        // Only sync products now — orders/customers come from live API
        const result = await shopifyService.syncProducts(organizationId);

        res.json({
            success: true,
            message: `Synced ${result.synced} products`,
            products: result.synced
        });

    } catch (error) {
        console.error('Shopify sync error:', error);
        res.status(500).json({ error: error.message || 'Sync failed' });
    }
});

// ─── Live Data Endpoints ─────────────────────────────────────────────

router.get('/analytics', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) {
            return res.status(403).json({ error: 'No organization found' });
        }

        const { days = 30 } = req.query;
        const analytics = await shopifyService.getLiveAnalytics(organizationId, {
            days: parseInt(days)
        });

        res.json(analytics);

    } catch (error) {
        console.error('Shopify analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

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

module.exports = router;
