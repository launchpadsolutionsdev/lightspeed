/**
 * Shopify Analytics Dashboard Routes
 * All endpoints read from local pre-computed tables — no live Shopify API calls.
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');
const analyticsService = require('../services/shopifyAnalytics');

function clampLimit(val, defaultVal, max) {
    const n = parseInt(val) || defaultVal;
    return Math.max(1, Math.min(n, max));
}

async function getOrgId(userId) {
    const result = await pool.query(
        'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
        [userId]
    );
    return result.rows[0]?.organization_id || null;
}

function parseDateRange(query) {
    const now = new Date();
    let startDate, endDate;

    if (query.start_date && query.end_date) {
        startDate = query.start_date;
        endDate = query.end_date;
    } else {
        const preset = query.preset || 'last_30_days';
        endDate = now.toISOString().substring(0, 10);

        switch (preset) {
            case 'today':
                startDate = endDate;
                break;
            case 'yesterday': {
                const y = new Date(now);
                y.setDate(y.getDate() - 1);
                startDate = endDate = y.toISOString().substring(0, 10);
                break;
            }
            case 'last_7_days': {
                const d = new Date(now);
                d.setDate(d.getDate() - 6);
                startDate = d.toISOString().substring(0, 10);
                break;
            }
            case 'last_90_days': {
                const d = new Date(now);
                d.setDate(d.getDate() - 89);
                startDate = d.toISOString().substring(0, 10);
                break;
            }
            case 'this_month':
                startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
                break;
            case 'last_month': {
                const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                startDate = lm.toISOString().substring(0, 10);
                const lme = new Date(now.getFullYear(), now.getMonth(), 0);
                endDate = lme.toISOString().substring(0, 10);
                break;
            }
            case 'this_year':
                startDate = `${now.getFullYear()}-01-01`;
                break;
            default: { // last_30_days
                const d = new Date(now);
                d.setDate(d.getDate() - 29);
                startDate = d.toISOString().substring(0, 10);
                break;
            }
        }
    }

    return { startDate, endDate };
}

// GET /api/dashboard/summary
router.get('/summary', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(403).json({ error: 'No organization found' });

        const { startDate, endDate } = parseDateRange(req.query);
        const compare = req.query.compare || null;

        const summary = await analyticsService.getDashboardSummary(organizationId, startDate, endDate, compare);
        res.json(summary);
    } catch (error) {
        console.error('Dashboard summary error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard summary' });
    }
});

// GET /api/dashboard/sales-over-time
router.get('/sales-over-time', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(403).json({ error: 'No organization found' });

        const { startDate, endDate } = parseDateRange(req.query);
        const granularity = req.query.granularity || 'day';

        const data = await analyticsService.getSalesOverTime(organizationId, startDate, endDate, granularity);
        res.json(data);
    } catch (error) {
        console.error('Sales over time error:', error);
        res.status(500).json({ error: 'Failed to fetch sales data' });
    }
});

// GET /api/dashboard/top-products
router.get('/top-products', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(403).json({ error: 'No organization found' });

        const { startDate, endDate } = parseDateRange(req.query);
        const limit = clampLimit(req.query.limit, 10, 50);

        const data = await analyticsService.getTopProducts(organizationId, startDate, endDate, limit);
        res.json(data);
    } catch (error) {
        console.error('Top products error:', error);
        res.status(500).json({ error: 'Failed to fetch top products' });
    }
});

// GET /api/dashboard/sales-by-channel
router.get('/sales-by-channel', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(403).json({ error: 'No organization found' });

        const { startDate, endDate } = parseDateRange(req.query);

        const data = await analyticsService.getSalesByChannel(organizationId, startDate, endDate);
        res.json(data);
    } catch (error) {
        console.error('Sales by channel error:', error);
        res.status(500).json({ error: 'Failed to fetch channel data' });
    }
});

// GET /api/dashboard/sales-by-region
router.get('/sales-by-region', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(403).json({ error: 'No organization found' });

        const { startDate, endDate } = parseDateRange(req.query);
        const limit = clampLimit(req.query.limit, 10, 50);

        const data = await analyticsService.getSalesByRegion(organizationId, startDate, endDate, limit);
        res.json(data);
    } catch (error) {
        console.error('Sales by region error:', error);
        res.status(500).json({ error: 'Failed to fetch region data' });
    }
});

// GET /api/dashboard/recent-orders
router.get('/recent-orders', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(403).json({ error: 'No organization found' });

        const limit = clampLimit(req.query.limit, 20, 100);
        const data = await analyticsService.getRecentOrders(organizationId, limit);
        res.json(data);
    } catch (error) {
        console.error('Recent orders error:', error);
        res.status(500).json({ error: 'Failed to fetch recent orders' });
    }
});

// GET /api/dashboard/sync-status
router.get('/sync-status', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(403).json({ error: 'No organization found' });

        const status = await analyticsService.getSyncStatus(organizationId);
        res.json(status);
    } catch (error) {
        console.error('Sync status error:', error);
        res.status(500).json({ error: 'Failed to fetch sync status' });
    }
});

// GET /api/dashboard/top-customers
router.get('/top-customers', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(403).json({ error: 'No organization found' });

        const limit = clampLimit(req.query.limit, 10, 50);
        const data = await analyticsService.getTopCustomers(organizationId, limit);
        res.json(data);
    } catch (error) {
        console.error('Top customers error:', error);
        res.status(500).json({ error: 'Failed to fetch top customers' });
    }
});

// GET /api/dashboard/sales-by-city
router.get('/sales-by-city', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(403).json({ error: 'No organization found' });

        const { startDate, endDate } = parseDateRange(req.query);
        const limit = clampLimit(req.query.limit, 15, 50);
        const data = await analyticsService.getSalesByCity(organizationId, startDate, endDate, limit);
        res.json(data);
    } catch (error) {
        console.error('Sales by city error:', error);
        res.status(500).json({ error: 'Failed to fetch city data' });
    }
});

// GET /api/dashboard/price-points
router.get('/price-points', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(403).json({ error: 'No organization found' });

        const { startDate, endDate } = parseDateRange(req.query);
        const data = await analyticsService.getPricePoints(organizationId, startDate, endDate);
        res.json(data);
    } catch (error) {
        console.error('Price points error:', error);
        res.status(500).json({ error: 'Failed to fetch price point data' });
    }
});

// GET /api/dashboard/search-orders
router.get('/search-orders', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(403).json({ error: 'No organization found' });

        const q = (req.query.q || '').trim();
        if (!q || q.length < 2) return res.json({ orders: [] });

        const data = await analyticsService.searchOrders(organizationId, q);
        res.json(data);
    } catch (error) {
        console.error('Order search error:', error);
        res.status(500).json({ error: 'Failed to search orders' });
    }
});

// GET /api/dashboard/ai-insights
router.get('/ai-insights', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(403).json({ error: 'No organization found' });

        const { startDate, endDate } = parseDateRange(req.query);
        const data = await analyticsService.generateAIInsights(organizationId, startDate, endDate);
        res.json(data);
    } catch (error) {
        console.error('AI insights error:', error);
        res.status(500).json({ error: 'Failed to generate insights' });
    }
});

// POST /api/dashboard/sync — Trigger a manual sync
router.post('/sync', authenticate, async (req, res) => {
    try {
        const organizationId = await getOrgId(req.userId);
        if (!organizationId) return res.status(403).json({ error: 'No organization found' });

        const syncStatus = await analyticsService.getSyncStatus(organizationId);
        if (!syncStatus.connected) {
            return res.status(404).json({ error: 'No Shopify store connected' });
        }

        // If sync has been stuck at 'syncing' for more than 10 minutes, reset it
        if (syncStatus.sync_status === 'syncing') {
            const stuckCheck = await pool.query(
                `SELECT updated_at FROM shopify_stores WHERE organization_id = $1 AND analytics_sync_status = 'syncing' AND updated_at < NOW() - INTERVAL '10 minutes'`,
                [organizationId]
            );
            if (stuckCheck.rows.length > 0) {
                await pool.query(
                    `UPDATE shopify_stores SET analytics_sync_status = 'error', analytics_sync_error = 'Previous sync timed out', updated_at = NOW() WHERE organization_id = $1`,
                    [organizationId]
                );
                console.warn(`Reset stuck sync for org ${organizationId}`);
                // Fall through to start a new sync
            } else {
                return res.json({ success: true, message: 'Sync already in progress' });
            }
        }

        // Set status to 'syncing' immediately so polling picks it up
        await pool.query(
            `UPDATE shopify_stores SET analytics_sync_status = 'syncing', analytics_sync_error = NULL, updated_at = NOW() WHERE organization_id = $1`,
            [organizationId]
        );

        // Respond immediately, run sync in background
        res.json({ success: true, message: 'Sync started' });

        const syncFn = syncStatus.last_full_sync
            ? analyticsService.runIncrementalSync
            : analyticsService.runFullSync;

        syncFn(organizationId).catch(error => {
            console.error('Manual sync error:', error.message);
        });
    } catch (error) {
        console.error('Dashboard sync trigger error:', error);
        res.status(500).json({ error: 'Failed to trigger sync' });
    }
});

module.exports = router;
