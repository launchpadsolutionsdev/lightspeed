/**
 * Feed Dashboard Routes
 * Proxies and parses the external XML feed for the main Dashboard tab.
 * Separate from the Shopify Analytics dashboard (dashboard.js).
 */

const express = require('express');
const router = express.Router();
const { XMLParser } = require('fast-xml-parser');
const { authenticate } = require('../middleware/auth');

const FEED_URL = process.env.DASHBOARD_FEED_URL || 'https://tbh.ca-api.bumpcbnraffle.net/api/feeds/dak';
const FEED_CACHE_TTL = 5 * 60 * 1000; // 5-minute cache

let _feedCache = null;
let _feedCacheTime = 0;

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '_',
    textNodeName: '_text',
    parseAttributeValue: true,
    parseTagValue: true,
    trimValues: true,
    isArray: (name, jpath, isLeafNode) => {
        // Force common collection names to always be arrays
        const arrayPaths = ['entry', 'item', 'product', 'order', 'record', 'row', 'raffle', 'ticket', 'draw'];
        return arrayPaths.includes(name.toLowerCase());
    }
});

/**
 * Fetch the XML feed, parse to JSON, and cache.
 */
async function fetchFeed() {
    const now = Date.now();
    if (_feedCache && (now - _feedCacheTime) < FEED_CACHE_TTL) {
        return _feedCache;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(FEED_URL, {
            signal: controller.signal,
            headers: { 'Accept': 'application/xml, text/xml, */*' }
        });
        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`Feed returned ${response.status}`);
        }

        const xml = await response.text();
        const parsed = xmlParser.parse(xml);

        // Normalize: extract the root element (skip xml declaration wrapper)
        const rootKeys = Object.keys(parsed).filter(k => k !== '?xml');
        const data = rootKeys.length === 1 ? parsed[rootKeys[0]] : parsed;

        _feedCache = data;
        _feedCacheTime = now;
        return data;
    } catch (error) {
        clearTimeout(timeout);
        // Return stale cache if available
        if (_feedCache) {
            console.warn('Feed fetch failed, returning stale cache:', error.message);
            return _feedCache;
        }
        throw error;
    }
}

/**
 * Attempt to extract structured dashboard metrics from the parsed feed.
 * Adapts to whatever fields are present in the XML.
 */
function extractMetrics(data) {
    const metrics = {
        feedData: data,
        summary: {},
        items: [],
        lastUpdated: new Date().toISOString()
    };

    // Try to find arrays of items in the data
    function findArrays(obj, path = '') {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            if (obj.length > 0) {
                metrics.items = obj;
            }
            return;
        }
        for (const [key, val] of Object.entries(obj)) {
            if (Array.isArray(val) && val.length > 0) {
                metrics.items = val;
                metrics.itemsKey = key;
                return;
            }
            if (typeof val === 'object' && !Array.isArray(val)) {
                findArrays(val, path ? `${path}.${key}` : key);
            }
        }
    }

    // Extract scalar values as summary metrics
    function extractScalars(obj) {
        if (!obj || typeof obj !== 'object') return;
        for (const [key, val] of Object.entries(obj)) {
            if (val === null || val === undefined) continue;
            if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
                metrics.summary[key] = val;
            }
        }
    }

    findArrays(data);
    extractScalars(data);

    return metrics;
}

// GET /api/feed-dashboard/data
router.get('/data', authenticate, async (req, res) => {
    try {
        const data = await fetchFeed();
        const metrics = extractMetrics(data);
        res.json(metrics);
    } catch (error) {
        console.error('Feed dashboard error:', error.message);
        res.status(502).json({ error: 'Unable to fetch feed data', message: error.message });
    }
});

// GET /api/feed-dashboard/raw — returns the raw parsed feed JSON
router.get('/raw', authenticate, async (req, res) => {
    try {
        const data = await fetchFeed();
        res.json(data);
    } catch (error) {
        console.error('Feed dashboard raw error:', error.message);
        res.status(502).json({ error: 'Unable to fetch feed data' });
    }
});

// POST /api/feed-dashboard/refresh — force cache refresh
router.post('/refresh', authenticate, async (req, res) => {
    _feedCache = null;
    _feedCacheTime = 0;
    try {
        const data = await fetchFeed();
        const metrics = extractMetrics(data);
        res.json(metrics);
    } catch (error) {
        console.error('Feed dashboard refresh error:', error.message);
        res.status(502).json({ error: 'Unable to refresh feed data' });
    }
});

module.exports = router;
