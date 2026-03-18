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
const fs = require('fs');
const path = require('path');
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

// Sales velocity snapshots — stores { timestamp, totalSales, totalTickets } samples
// Used for sparkline and surge indicator on the frontend
const VELOCITY_MAX_SAMPLES = 180; // 6 hours at 2-min intervals
let _salesSnapshots = [];

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

        // Record sales snapshot for velocity tracking
        if (data.salesBreakdown) {
            const snap = {
                ts: now,
                totalSales: data.salesBreakdown.totalSales,
                totalTickets: data.salesBreakdown.totalTickets
            };
            // Only add if value changed or first sample
            const last = _salesSnapshots[_salesSnapshots.length - 1];
            if (!last || last.totalSales !== snap.totalSales || last.totalTickets !== snap.totalTickets) {
                _salesSnapshots.push(snap);
                if (_salesSnapshots.length > VELOCITY_MAX_SAMPLES) {
                    _salesSnapshots = _salesSnapshots.slice(-VELOCITY_MAX_SAMPLES);
                }
            }
            data.salesVelocity = buildVelocityData(_salesSnapshots);
        }

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
    // Build claim status lookup from winners feed (keyed by winning number)
    const claimLookup = new Map();
    if (winnersContent) {
        const winnerNodes = winnersContent.winners?.node || [];
        const allWinners = Array.isArray(winnerNodes) ? winnerNodes : [winnerNodes];
        allWinners.forEach(w => {
            if (w.number) {
                claimLookup.set(String(w.number).trim(), w.claimed === 1 || w.claimed === '1');
            }
        });
    }

    // Parse secondary prizes into drawn and upcoming
    const nodes = content.secondary_prizes?.node || [];
    const prizes = (Array.isArray(nodes) ? nodes : [nodes]).map(n => {
        const winNum = n.winning_no ? String(n.winning_no).trim() : null;
        const drawn = !!(winNum);
        return {
            name: n.prize || '',
            winningNumber: winNum || null,
            drawDate: n.draw_date || null,
            drawn,
            claimed: drawn && claimLookup.has(winNum) ? claimLookup.get(winNum) : null
        };
    });

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
        debitPercent: totalSales > 0 ? ((debitSales / totalSales) * 100).toFixed(1) : '0',
        // Average ticket value
        averageTicketValue: totalTickets > 0 ? parseFloat((totalSales / totalTickets).toFixed(2)) : 0
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

/**
 * Build velocity data from sales snapshots for the frontend sparkline and surge indicator.
 */
function buildVelocityData(snapshots) {
    if (snapshots.length < 2) return { samples: [], surge: null };

    // Build time-bucketed samples (one per snapshot)
    const samples = snapshots.map(s => ({
        ts: s.ts,
        sales: s.totalSales,
        tickets: s.totalTickets
    }));

    // Surge: compare last hour vs the hour before that
    const now = snapshots[snapshots.length - 1].ts;
    const oneHourAgo = now - 60 * 60 * 1000;
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;

    const currentSnap = snapshots[snapshots.length - 1];
    const hourAgoSnap = snapshots.find(s => s.ts >= oneHourAgo) || snapshots[0];
    const twoHourSnap = snapshots.find(s => s.ts >= twoHoursAgo) || snapshots[0];

    const recentDelta = currentSnap.totalSales - hourAgoSnap.totalSales;
    const priorDelta = hourAgoSnap.totalSales - twoHourSnap.totalSales;

    let surgePercent = null;
    if (priorDelta > 0) {
        surgePercent = Math.round(((recentDelta - priorDelta) / priorDelta) * 100);
    }

    return {
        samples,
        surge: {
            recentSales: recentDelta,
            priorSales: priorDelta,
            percent: surgePercent,
            periodMinutes: 60
        }
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

// ---------------------------------------------------------------------------
// What's New articles — parsed from the static What's New index page
// ---------------------------------------------------------------------------
const WHATS_NEW_HTML_PATH = path.resolve(__dirname, '../../../frontend/whats-new/index.html');
const WHATS_NEW_CACHE_TTL = 5 * 60 * 1000; // 5-minute cache
let _whatsNewCache = null;
let _whatsNewCacheTime = 0;

/**
 * Parse the What's New index.html to extract article cards.
 * Returns the most recent `count` articles.
 */
function parseWhatsNewArticles(count = 3) {
    let html;
    try {
        html = fs.readFileSync(WHATS_NEW_HTML_PATH, 'utf8');
    } catch (err) {
        console.warn('Could not read What\'s New page:', err.message);
        return [];
    }

    const articles = [];
    // Match each <a href="..." class="wn-card"> block
    const cardRegex = /<a\s+href="([^"]*)"[^>]*class="wn-card"[^>]*>([\s\S]*?)<\/a>/g;
    let match;

    while ((match = cardRegex.exec(html)) !== null) {
        const href = match[1];
        const cardHtml = match[2];

        // Extract date
        const dateMatch = cardHtml.match(/<span class="wn-card-date">([^<]+)<\/span>/);
        const date = dateMatch ? dateMatch[1].trim() : '';

        // Extract badges
        const badges = [];
        const badgeRegex = /<span class="wn-card-badge[^"]*">([^<]+)<\/span>/g;
        let badgeMatch;
        while ((badgeMatch = badgeRegex.exec(cardHtml)) !== null) {
            badges.push(badgeMatch[1].trim());
        }

        // Extract title
        const titleMatch = cardHtml.match(/<h2 class="wn-card-title">([^<]+)<\/h2>/);
        const title = titleMatch ? titleMatch[1].trim().replace(/&amp;/g, '&').replace(/&mdash;/g, '—') : '';

        // Extract summary
        const summaryMatch = cardHtml.match(/<p class="wn-card-summary">([^<]+)<\/p>/);
        const summary = summaryMatch ? summaryMatch[1].trim().replace(/&amp;/g, '&').replace(/&mdash;/g, '—') : '';

        if (title) {
            articles.push({ href, date, badges, title, summary });
        }
    }

    return articles.slice(0, count);
}

// GET /api/feed-dashboard/whats-new — latest articles from the What's New page
router.get('/whats-new', authenticate, (req, res) => {
    const now = Date.now();
    if (_whatsNewCache && (now - _whatsNewCacheTime) < WHATS_NEW_CACHE_TTL) {
        return res.json(_whatsNewCache);
    }

    const articles = parseWhatsNewArticles(3);
    _whatsNewCache = { articles, lastUpdated: new Date().toISOString() };
    _whatsNewCacheTime = now;
    res.json(_whatsNewCache);
});

module.exports = router;
