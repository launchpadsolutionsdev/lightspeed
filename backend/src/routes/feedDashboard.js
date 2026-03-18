/**
 * Feed Dashboard Routes
 * Proxies and parses the 50/50 raffle XML feed for the main Dashboard tab.
 * Separate from the Shopify Analytics dashboard (dashboard.js).
 */

const express = require('express');
const router = express.Router();
const { XMLParser } = require('fast-xml-parser');
const { authenticate } = require('../middleware/auth');
const log = require('../services/logger');

const FEED_URL = process.env.DASHBOARD_FEED_URL || 'https://tbh.ca-api.bumpcbnraffle.net/api/feeds/dak';
const FEED_CACHE_TTL = 2 * 60 * 1000; // 2-minute cache for near-real-time pool updates

let _feedCache = null;
let _feedCacheTime = 0;

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '_',
    parseTagValue: true,
    trimValues: true,
    isArray: (name) => name === 'node'
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

        // Extract root <content> element
        const content = parsed.content || parsed;
        const data = extractRaffleData(content);

        _feedCache = data;
        _feedCacheTime = now;
        return data;
    } catch (error) {
        clearTimeout(timeout);
        if (_feedCache) {
            log.warn('Feed fetch failed, returning stale cache', { error: error.message });
            return _feedCache;
        }
        throw error;
    }
}

/**
 * Extract structured raffle data from the parsed XML.
 */
function extractRaffleData(content) {
    // Parse secondary prizes into drawn and upcoming
    const nodes = content.secondary_prizes?.node || [];
    const prizes = (Array.isArray(nodes) ? nodes : [nodes]).map(n => ({
        name: n.prize || '',
        winningNumber: n.winning_no || null,
        drawDate: n.draw_date || null,
        drawn: !!(n.winning_no && String(n.winning_no).trim())
    }));

    const drawnPrizes = prizes.filter(p => p.drawn);
    const upcomingPrizes = prizes.filter(p => !p.drawn);

    // Calculate time remaining
    const endDate = content.end ? new Date(content.end) : null;
    const now = new Date();
    let timeRemaining = null;
    if (endDate && endDate > now) {
        const diff = endDate - now;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        timeRemaining = { days, hours, totalMs: diff };
    }

    return {
        event: content.event || 'Raffle',
        startDate: content.start || null,
        endDate: content.end || null,
        dateDisplay: content.date_display || null,
        isTest: content.is_test === 1,

        // Pool & prize — use pre-formatted values from the feed
        pool: parseFloat(content.pool) || 0,
        poolFormatted: content.pool_nf_wd || `$${(parseFloat(content.pool) || 0).toLocaleString()}`,
        prize: parseFloat(content.prize) || 0,
        prizeFormatted: content.prize_fl_nf_wd || content.prize_nf_wd || `$${(parseFloat(content.prize) || 0).toLocaleString()}`,

        // Main draw
        mainWinningNumber: content.winning_no || null,
        mainDrawComplete: !!(content.winning_no && String(content.winning_no).trim()),

        // Time remaining
        timeRemaining,

        // Secondary prizes
        drawnPrizes,
        upcomingPrizes,
        totalSecondaryPrizes: prizes.length,
        totalDrawn: drawnPrizes.length,

        // Metadata
        lastUpdated: new Date().toISOString(),
        feedTimestamp: content.timestamp || null
    };
}

// GET /api/feed-dashboard/data
router.get('/data', authenticate, async (req, res) => {
    try {
        const data = await fetchFeed();
        res.json(data);
    } catch (error) {
        log.error('Feed dashboard error', { error: error.message });
        res.status(502).json({ error: 'Unable to fetch feed data', message: error.message });
    }
});

// POST /api/feed-dashboard/refresh — force cache refresh
router.post('/refresh', authenticate, async (req, res) => {
    _feedCache = null;
    _feedCacheTime = 0;
    try {
        const data = await fetchFeed();
        res.json(data);
    } catch (error) {
        log.error('Feed dashboard refresh error', { error: error.message });
        res.status(502).json({ error: 'Unable to refresh feed data' });
    }
});

module.exports = router;
