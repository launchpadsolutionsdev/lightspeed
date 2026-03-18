/**
 * Feed Dashboard Routes
 * Proxies and parses the 50/50 raffle XML feeds for the main Dashboard tab.
 * Fetches data from three BUMP API feeds:
 *   1. Main raffle feed (pool, prizes, secondary prizes)
 *   2. Winners feed (historical draw results, claim status)
 *   3. Sales breakdown feed (tickets, revenue, payment methods, package tiers)
 * Separate from the Shopify Analytics dashboard (dashboard.js).
 */

const express = require('express');
const router = express.Router();
const { XMLParser } = require('fast-xml-parser');
const { authenticate } = require('../middleware/auth');
const log = require('../services/logger');

// Feed URLs — configure via environment variables or use BUMP API defaults.
const FEED_URL = process.env.DASHBOARD_FEED_URL || 'https://tbh.ca-api.bumpcbnraffle.net/api/feeds/dak';
const WINNERS_FEED_URL = process.env.DASHBOARD_WINNERS_FEED_URL || 'https://tbh.ca-api.bumpcbnraffle.net/api/feeds/winners';
const SALES_FEED_URL = process.env.DASHBOARD_SALES_FEED_URL || 'https://tbh.ca-api.bumpcbnraffle.net/api/feeds/event-details';
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
 * Fetch a single XML feed with timeout and parse it.
 */
async function fetchXmlFeed(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'Accept': 'application/xml, text/xml, */*' }
        });
        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`Feed returned ${response.status}`);
        }

        const xml = await response.text();
        return xmlParser.parse(xml);
    } catch (error) {
        clearTimeout(timeout);
        throw error;
    }
}

/**
 * Fetch all three feeds in parallel, parse, and cache.
 */
async function fetchFeed() {
    const now = Date.now();
    if (_feedCache && (now - _feedCacheTime) < FEED_CACHE_TTL) {
        return _feedCache;
    }

    try {
        // Fetch all configured feeds in parallel — secondary feeds are optional
        const feedPromises = [fetchXmlFeed(FEED_URL)];
        const winnersIdx = WINNERS_FEED_URL ? (feedPromises.push(fetchXmlFeed(WINNERS_FEED_URL)), feedPromises.length - 1) : -1;
        const salesIdx = SALES_FEED_URL ? (feedPromises.push(fetchXmlFeed(SALES_FEED_URL)), feedPromises.length - 1) : -1;

        const results = await Promise.allSettled(feedPromises);

        if (results[0].status === 'rejected') {
            throw results[0].reason;
        }

        const mainContent = results[0].value.content || results[0].value;

        let winnersContent = null;
        if (winnersIdx >= 0 && results[winnersIdx].status === 'fulfilled') {
            winnersContent = results[winnersIdx].value.content || results[winnersIdx].value;
        } else if (winnersIdx >= 0) {
            console.warn('Winners feed failed:', results[winnersIdx].reason?.message);
        }

        let salesContent = null;
        if (salesIdx >= 0 && results[salesIdx].status === 'fulfilled') {
            salesContent = results[salesIdx].value.content || results[salesIdx].value;
        } else if (salesIdx >= 0) {
            console.warn('Sales feed failed:', results[salesIdx].reason?.message);
        }

        const data = extractRaffleData(mainContent, winnersContent, salesContent);

        _feedCache = data;
        _feedCacheTime = now;
        return data;
    } catch (error) {
        if (_feedCache) {
            log.warn('Feed fetch failed, returning stale cache', { error: error.message });
            return _feedCache;
        }
        throw error;
    }
}

/**
 * Extract structured raffle data from the parsed XML feeds.
 */
function extractRaffleData(content, winnersContent, salesContent) {
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

    // Extract sales breakdown data (Feed 3)
    const salesBreakdown = extractSalesBreakdown(salesContent);

    // Extract winners history (Feed 2)
    const winnersHistory = extractWinnersHistory(winnersContent);

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

        // Sales breakdown (from Feed 3)
        salesBreakdown,

        // Winners history (from Feed 2)
        winnersHistory,

        // Metadata
        lastUpdated: new Date().toISOString(),
        feedTimestamp: content.timestamp || null
    };
}

/**
 * Extract sales breakdown metrics from the sales feed (Feed 3).
 */
function extractSalesBreakdown(salesContent) {
    if (!salesContent) return null;

    const totalSales = parseFloat(String(salesContent.total_sales).replace(/,/g, '')) || 0;
    const cashSales = parseFloat(String(salesContent.cash_sales).replace(/,/g, '')) || 0;
    const creditSales = parseFloat(String(salesContent.credit_sales).replace(/,/g, '')) || 0;
    const debitSales = parseFloat(String(salesContent.debit_sales).replace(/,/g, '')) || 0;
    const totalTickets = parseInt(String(salesContent.tickets).replace(/,/g, ''), 10) || 0;
    const totalNumbers = parseInt(String(salesContent.numbers).replace(/,/g, ''), 10) || 0;

    // Package tier breakdown
    const breakdownNodes = salesContent.breakdown?.node || [];
    const tiers = (Array.isArray(breakdownNodes) ? breakdownNodes : [breakdownNodes]).map(n => ({
        numbersPerTicket: parseInt(n.quantity) || 0,
        price: parseFloat(n.price) || 0,
        tickets: parseInt(String(n.total_tickets).replace(/,/g, '')) || 0,
        numbers: parseInt(String(n.total_numbers).replace(/,/g, '')) || 0,
        sales: parseFloat(String(n.total_sales).replace(/,/g, '')) || 0,
        cashSales: parseFloat(String(n.total_sales_cash).replace(/,/g, '')) || 0,
        creditSales: parseFloat(String(n.total_sales_credit).replace(/,/g, '')) || 0,
        debitSales: parseFloat(String(n.total_sales_debit).replace(/,/g, '')) || 0
    }));

    return {
        totalSales,
        cashSales,
        creditSales,
        debitSales,
        totalTickets,
        totalNumbers,
        tiers,
        // Computed percentages
        creditPercent: totalSales > 0 ? ((creditSales / totalSales) * 100).toFixed(1) : '0',
        cashPercent: totalSales > 0 ? ((cashSales / totalSales) * 100).toFixed(1) : '0',
        debitPercent: totalSales > 0 ? ((debitSales / totalSales) * 100).toFixed(1) : '0'
    };
}

/**
 * Extract winners history from the winners feed (Feed 2).
 * Groups by event and identifies grand prize winners vs early bird draws.
 */
function extractWinnersHistory(winnersContent) {
    if (!winnersContent) return null;

    const winnerNodes = winnersContent.winners?.node || [];
    const winners = (Array.isArray(winnerNodes) ? winnerNodes : [winnerNodes]);

    // Grand prize winners (game_id = 1, have jackpot values)
    const grandPrizeWinners = winners
        .filter(w => w.game_id === 1 || (w.jackpot && String(w.jackpot).trim()))
        .map(w => ({
            eventId: w.event_id,
            eventTitle: w.eventtitle || '',
            number: w.number || '',
            claimed: w.claimed === 1 || w.claimed === '1',
            datePicked: w.time_picked || '',
            jackpot: w.jackpot || '',
            prize: w.prize || w.amount || '',
            date: w.date || ''
        }))
        .sort((a, b) => new Date(b.datePicked) - new Date(a.datePicked))
        .filter(w => {
            // Only include draws from the last 5 months
            const cutoff = new Date();
            cutoff.setMonth(cutoff.getMonth() - 5);
            const drawDate = new Date(w.datePicked || w.date);
            return !isNaN(drawDate.getTime()) && drawDate >= cutoff;
        });

    // Count total draws and unclaimed prizes
    const totalDraws = winners.length;
    const unclaimedCount = winners.filter(w =>
        (w.claimed === 0 || w.claimed === '0') &&
        (w.game_id === 1 || (w.jackpot && String(w.jackpot).trim()))
    ).length;

    // Group by event for summary stats
    const eventMap = new Map();
    winners.forEach(w => {
        const eventId = w.event_id;
        if (!eventMap.has(eventId)) {
            eventMap.set(eventId, {
                eventId,
                eventTitle: w.eventtitle || '',
                drawCount: 0,
                grandPrize: null
            });
        }
        const entry = eventMap.get(eventId);
        entry.drawCount++;
        if (w.game_id === 1 || (w.jackpot && String(w.jackpot).trim())) {
            entry.grandPrize = w.jackpot || w.prize || null;
        }
    });

    return {
        grandPrizeWinners,
        totalDraws,
        unclaimedGrandPrizes: unclaimedCount,
        eventSummaries: Array.from(eventMap.values()).sort((a, b) => b.eventId - a.eventId)
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

// GET /api/feed-dashboard/status — show which feeds are configured
router.get('/status', authenticate, (req, res) => {
    res.json({
        mainFeed: { url: FEED_URL, configured: !!FEED_URL },
        winnersFeed: { url: WINNERS_FEED_URL || null, configured: !!WINNERS_FEED_URL },
        salesFeed: { url: SALES_FEED_URL || null, configured: !!SALES_FEED_URL },
        cacheTtl: FEED_CACHE_TTL,
        cacheAge: _feedCacheTime ? Date.now() - _feedCacheTime : null
    });
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
