/**
 * Shopify Analytics Dashboard Routes
 * All endpoints read from local pre-computed tables — no live Shopify API calls.
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');
const analyticsService = require('../services/shopifyAnalytics');
const log = require('../services/logger');

function clampLimit(val, defaultVal, max) {
    const n = parseInt(val) || defaultVal;
    return Math.max(1, Math.min(n, max));
}

async function getOrgId(userId) {
    const result = await pool.query(
        `SELECT om.organization_id, o.timezone
         FROM organization_memberships om
         JOIN organizations o ON o.id = om.organization_id
         WHERE om.user_id = $1 LIMIT 1`,
        [userId]
    );
    const row = result.rows[0];
    return row ? { organizationId: row.organization_id, timezone: row.timezone || 'America/Toronto' } : null;
}

/**
 * Get today's date string (YYYY-MM-DD) in a specific timezone.
 * Data in daily_sales_metrics is stored in the shop's timezone (via ShopifyQL / Shopify API),
 * so date range queries must use the same timezone to avoid off-by-one errors.
 */
function todayInTimezone(tz) {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch {
        return new Date().toISOString().substring(0, 10);
    }
}

function parseDateRange(query, timezone = 'America/Toronto') {
    let startDate, endDate;

    if (query.start_date && query.end_date) {
        startDate = query.start_date;
        endDate = query.end_date;
    } else {
        const preset = query.preset || 'last_30_days';
        const todayStr = todayInTimezone(timezone);
        // Parse today's date in shop timezone for arithmetic
        const [y, m, d] = todayStr.split('-').map(Number);
        const today = new Date(y, m - 1, d); // local date (no TZ shift)
        endDate = todayStr;

        switch (preset) {
            case 'today':
                startDate = endDate;
                break;
            case 'yesterday': {
                const yd = new Date(today);
                yd.setDate(yd.getDate() - 1);
                startDate = endDate = formatLocalDate(yd);
                break;
            }
            case 'last_7_days': {
                const sd = new Date(today);
                sd.setDate(sd.getDate() - 6);
                startDate = formatLocalDate(sd);
                break;
            }
            case 'last_90_days': {
                const sd = new Date(today);
                sd.setDate(sd.getDate() - 89);
                startDate = formatLocalDate(sd);
                break;
            }
            case 'this_month':
                startDate = `${y}-${String(m).padStart(2, '0')}-01`;
                break;
            case 'last_month': {
                const lm = new Date(y, m - 2, 1);
                startDate = formatLocalDate(lm);
                const lme = new Date(y, m - 1, 0);
                endDate = formatLocalDate(lme);
                break;
            }
            case 'this_year':
                startDate = `${y}-01-01`;
                break;
            default: { // last_30_days
                const sd = new Date(today);
                sd.setDate(sd.getDate() - 29);
                startDate = formatLocalDate(sd);
                break;
            }
        }
    }

    return { startDate, endDate };
}

function formatLocalDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// GET /api/dashboard/summary
router.get('/summary', authenticate, async (req, res) => {
    try {
        const org = await getOrgId(req.userId);
        if (!org) return res.status(403).json({ error: 'No organization found' });

        const { startDate, endDate } = parseDateRange(req.query, org.timezone);
        const compare = req.query.compare || null;

        const summary = await analyticsService.getDashboardSummary(org.organizationId, startDate, endDate, compare);
        res.json(summary);
    } catch (error) {
        log.error('Dashboard summary error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to fetch dashboard summary' });
    }
});

// GET /api/dashboard/sales-over-time
router.get('/sales-over-time', authenticate, async (req, res) => {
    try {
        const org = await getOrgId(req.userId);
        if (!org) return res.status(403).json({ error: 'No organization found' });

        const { startDate, endDate } = parseDateRange(req.query, org.timezone);
        const granularity = req.query.granularity || 'day';

        const data = await analyticsService.getSalesOverTime(org.organizationId, startDate, endDate, granularity);
        res.json(data);
    } catch (error) {
        log.error('Sales over time error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to fetch sales data' });
    }
});

// GET /api/dashboard/top-products
router.get('/top-products', authenticate, async (req, res) => {
    try {
        const org = await getOrgId(req.userId);
        if (!org) return res.status(403).json({ error: 'No organization found' });

        const { startDate, endDate } = parseDateRange(req.query, org.timezone);
        const limit = clampLimit(req.query.limit, 10, 50);

        const data = await analyticsService.getTopProducts(org.organizationId, startDate, endDate, limit);
        res.json(data);
    } catch (error) {
        log.error('Top products error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to fetch top products' });
    }
});

// GET /api/dashboard/sales-by-channel
router.get('/sales-by-channel', authenticate, async (req, res) => {
    try {
        const org = await getOrgId(req.userId);
        if (!org) return res.status(403).json({ error: 'No organization found' });

        const { startDate, endDate } = parseDateRange(req.query, org.timezone);

        const data = await analyticsService.getSalesByChannel(org.organizationId, startDate, endDate);
        res.json(data);
    } catch (error) {
        log.error('Sales by channel error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to fetch channel data' });
    }
});

// GET /api/dashboard/sales-by-region
router.get('/sales-by-region', authenticate, async (req, res) => {
    try {
        const org = await getOrgId(req.userId);
        if (!org) return res.status(403).json({ error: 'No organization found' });

        const { startDate, endDate } = parseDateRange(req.query, org.timezone);
        const limit = clampLimit(req.query.limit, 10, 50);

        const data = await analyticsService.getSalesByRegion(org.organizationId, startDate, endDate, limit);
        res.json(data);
    } catch (error) {
        log.error('Sales by region error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to fetch region data' });
    }
});

// GET /api/dashboard/recent-orders
router.get('/recent-orders', authenticate, async (req, res) => {
    try {
        const org = await getOrgId(req.userId);
        if (!org) return res.status(403).json({ error: 'No organization found' });

        const limit = clampLimit(req.query.limit, 20, 100);
        const data = await analyticsService.getRecentOrders(org.organizationId, limit);
        res.json(data);
    } catch (error) {
        log.error('Recent orders error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to fetch recent orders' });
    }
});

// GET /api/dashboard/sync-status
router.get('/sync-status', authenticate, async (req, res) => {
    try {
        const org = await getOrgId(req.userId);
        if (!org) return res.status(403).json({ error: 'No organization found' });

        const status = await analyticsService.getSyncStatus(org.organizationId);
        res.json(status);
    } catch (error) {
        log.error('Sync status error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to fetch sync status' });
    }
});

// GET /api/dashboard/price-points
router.get('/price-points', authenticate, async (req, res) => {
    try {
        const org = await getOrgId(req.userId);
        if (!org) return res.status(403).json({ error: 'No organization found' });

        const { startDate, endDate } = parseDateRange(req.query, org.timezone);
        const data = await analyticsService.getPricePoints(org.organizationId, startDate, endDate);
        res.json(data);
    } catch (error) {
        log.error('Price points error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to fetch price point data' });
    }
});

// GET /api/dashboard/shopify-snapshot — 24h intelligence snapshot for Heartbeat
router.get('/shopify-snapshot', authenticate, async (req, res) => {
    try {
        const org = await getOrgId(req.userId);
        if (!org) return res.status(403).json({ error: 'No organization found' });

        const snapshot = await analyticsService.getShopifySnapshot(org.organizationId, org.timezone);
        res.json(snapshot);
    } catch (error) {
        log.error('Shopify snapshot error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to fetch shopify snapshot' });
    }
});

// POST /api/dashboard/sync — Trigger a manual sync
router.post('/sync', authenticate, async (req, res) => {
    try {
        const org = await getOrgId(req.userId);
        if (!org) return res.status(403).json({ error: 'No organization found' });
        const organizationId = org.organizationId;

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
                log.warn('Reset stuck sync for org', { organizationId });
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

        syncFn(organizationId).catch(async (error) => {
            log.error('Manual sync error', { error: error.message || error });
            // Safety net: ensure DB status is updated to 'error' so polling doesn't hang forever
            try {
                await pool.query(
                    `UPDATE shopify_stores SET analytics_sync_status = 'error', analytics_sync_error = $2, updated_at = NOW() WHERE organization_id = $1 AND analytics_sync_status = 'syncing'`,
                    [organizationId, error.message]
                );
            } catch (dbErr) {
                log.error('Failed to update sync error status', { error: dbErr.message || dbErr });
            }
        });
    } catch (error) {
        log.error('Dashboard sync trigger error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to trigger sync' });
    }
});

module.exports = router;
