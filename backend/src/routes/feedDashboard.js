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
const pool = require('../../config/database');

// Legacy env-var feed URLs — used as fallback when an org has no DB-configured URLs.
const ENV_FEED_URL = process.env.DASHBOARD_FEED_URL || 'https://tbh.ca-api.bumpcbnraffle.net/api/feeds/dak';
const ENV_WINNERS_FEED_URL = process.env.DASHBOARD_WINNERS_FEED_URL || 'https://tbh.ca-api.bumpcbnraffle.net/api/feeds/winners';
const ENV_SALES_FEED_URL = process.env.DASHBOARD_SALES_FEED_URL || 'https://tbh.ca-api.bumpcbnraffle.net/api/feeds/event-details';
const FEED_CACHE_TTL = 2 * 60 * 1000; // 2-minute cache for near-real-time pool updates

// Per-org caches: Map<orgId, { data, cacheTime }>
const _feedCaches = new Map();

// Sales velocity snapshots — per-org in-memory hot caches backed by PostgreSQL.
const VELOCITY_MAX_SAMPLES = 5040; // ~7 days at 2-min intervals
const VELOCITY_SAVE_INTERVAL = 60 * 1000;     // Flush to DB at most once per 60s
const VELOCITY_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // Prune snapshots older than 7 days

// Per-org snapshot state: Map<orgId, snapshot[]>
const _salesSnapshotsByOrg = new Map();
const _snapshotsLoadedByOrg = new Set();
const _pendingDbSnapshotsByOrg = new Map();
let _lastSaveTimeByOrg = new Map();
let _bgFetchCount = 0;        // Health counter: total background fetches since startup
let _bgFetchFails = 0;        // Health counter: failed background fetches since startup

/**
 * Look up an organization's configured BUMP feed URLs from the database.
 * Returns null values if the org has no feed URLs configured.
 */
async function getOrgFeedUrls(orgId) {
    const result = await pool.query(
        'SELECT bump_feed_url, bump_winners_feed_url, bump_sales_feed_url FROM organizations WHERE id = $1',
        [orgId]
    );
    const row = result.rows[0];
    return {
        feedUrl: row?.bump_feed_url || null,
        winnersFeedUrl: row?.bump_winners_feed_url || null,
        salesFeedUrl: row?.bump_sales_feed_url || null
    };
}

/**
 * Load velocity snapshots from PostgreSQL on first access for a given org.
 * Falls back to the legacy JSON file if the DB table doesn't exist yet
 * (e.g. migration hasn't run), then prunes entries older than 7 days.
 */
async function loadSnapshots(orgId) {
    if (_snapshotsLoadedByOrg.has(orgId)) return;
    _snapshotsLoadedByOrg.add(orgId);

    const cutoff = Date.now() - VELOCITY_MAX_AGE;

    // Try PostgreSQL first
    try {
        const result = await pool.query(
            'SELECT ts, total_sales, total_tickets, total_numbers FROM velocity_snapshots WHERE organization_id = $1 AND ts >= $2 ORDER BY ts ASC',
            [orgId, cutoff]
        );
        const snapshots = result.rows.map(r => ({
            ts: Number(r.ts),
            totalSales: parseFloat(r.total_sales),
            totalTickets: parseInt(r.total_tickets, 10),
            totalNumbers: parseInt(r.total_numbers || 0, 10)
        }));
        _salesSnapshotsByOrg.set(orgId, snapshots);
        log.info('Loaded velocity snapshots from database', { orgId, count: snapshots.length });
        return;
    } catch (err) {
        log.warn('Could not load velocity snapshots from DB, trying JSON fallback', { orgId, error: err.message });
    }

    // Fallback: legacy JSON file (for first deploy before migration runs)
    const jsonPath = path.join(__dirname, '../../data/velocity-snapshots.json');
    try {
        if (fs.existsSync(jsonPath)) {
            const raw = fs.readFileSync(jsonPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                _salesSnapshotsByOrg.set(orgId, parsed.filter(s => s.ts >= cutoff));
                log.info('Loaded velocity snapshots from JSON fallback', { orgId, count: _salesSnapshotsByOrg.get(orgId).length });
                return;
            }
        }
    } catch (err) {
        log.warn('Could not load velocity snapshots from JSON', { error: err.message });
    }
    _salesSnapshotsByOrg.set(orgId, []);
}

/**
 * Flush pending snapshots to PostgreSQL for a given org (throttled, async, fire-and-forget).
 * Also prunes rows older than 7 days periodically.
 */
function saveSnapshotsIfNeeded(orgId) {
    const now = Date.now();
    const lastSave = _lastSaveTimeByOrg.get(orgId) || 0;
    if (now - lastSave < VELOCITY_SAVE_INTERVAL) return;
    const pending = _pendingDbSnapshotsByOrg.get(orgId);
    if (!pending || pending.length === 0) return;
    _lastSaveTimeByOrg.set(orgId, now);

    const batch = pending.splice(0);

    // Build a multi-row INSERT for efficiency
    const values = [];
    const params = [];
    batch.forEach((s, i) => {
        const offset = i * 5;
        values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
        params.push(orgId, s.ts, s.totalSales, s.totalTickets, s.totalNumbers || 0);
    });

    pool.query(
        `INSERT INTO velocity_snapshots (organization_id, ts, total_sales, total_tickets, total_numbers) VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`,
        params
    ).catch(err => log.warn('Could not save velocity snapshots to DB', { orgId, error: err.message }));

    // Prune old rows periodically (fire-and-forget)
    const cutoff = now - VELOCITY_MAX_AGE;
    pool.query('DELETE FROM velocity_snapshots WHERE organization_id = $1 AND ts < $2', [orgId, cutoff])
        .catch(err => log.warn('Could not prune old velocity snapshots', { orgId, error: err.message }));
}

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
 * Record a snapshot into the in-memory array and queue it for DB persistence.
 */
function recordSnapshot(orgId, ts, totalSales, totalTickets, totalNumbers) {
    const snap = { ts, totalSales, totalTickets, totalNumbers: totalNumbers || 0 };
    let snapshots = _salesSnapshotsByOrg.get(orgId) || [];
    snapshots.push(snap);
    if (snapshots.length > VELOCITY_MAX_SAMPLES) {
        snapshots = snapshots.slice(-VELOCITY_MAX_SAMPLES);
    }
    _salesSnapshotsByOrg.set(orgId, snapshots);

    if (!_pendingDbSnapshotsByOrg.has(orgId)) _pendingDbSnapshotsByOrg.set(orgId, []);
    _pendingDbSnapshotsByOrg.get(orgId).push(snap);
    saveSnapshotsIfNeeded(orgId);
}

/**
 * Fetch all three feeds in parallel, parse, and cache.
 * Records a velocity snapshot on every call — even on cache hits and failures —
 * so the timeline never has gaps while the server is running.
 *
 * @param {string} orgId - Organization UUID
 * @param {string} feedUrl - Main raffle feed URL
 * @param {string} winnersFeedUrl - Winners feed URL (optional)
 * @param {string} salesFeedUrl - Sales breakdown feed URL (optional)
 */
async function fetchFeed(orgId, feedUrl, winnersFeedUrl, salesFeedUrl) {
    await loadSnapshots(orgId);
    const now = Date.now();
    const cached = _feedCaches.get(orgId);
    const snapshots = _salesSnapshotsByOrg.get(orgId) || [];

    if (cached && (now - cached.cacheTime) < FEED_CACHE_TTL) {
        // Still record a time-stamped snapshot and recompute velocity on cache hits
        if (cached.data.salesBreakdown) {
            recordSnapshot(orgId, now, cached.data.salesBreakdown.totalSales, cached.data.salesBreakdown.totalTickets, cached.data.salesBreakdown.totalNumbers);
            cached.data.salesVelocity = buildVelocityData(_salesSnapshotsByOrg.get(orgId) || []);
        }
        return cached.data;
    }

    try {
        // Fetch all configured feeds in parallel — secondary feeds are optional
        const feedPromises = [fetchXmlFeed(feedUrl)];
        const winnersIdx = winnersFeedUrl ? (feedPromises.push(fetchXmlFeed(winnersFeedUrl)), feedPromises.length - 1) : -1;
        const salesIdx = salesFeedUrl ? (feedPromises.push(fetchXmlFeed(salesFeedUrl)), feedPromises.length - 1) : -1;

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
            recordSnapshot(orgId, now, data.salesBreakdown.totalSales, data.salesBreakdown.totalTickets, data.salesBreakdown.totalNumbers);
        }
        data.salesVelocity = buildVelocityData(_salesSnapshotsByOrg.get(orgId) || []);

        _feedCaches.set(orgId, { data, cacheTime: now });
        return data;
    } catch (error) {
        // Record a snapshot from the last known values so the timeline stays continuous
        if (cached && cached.data.salesBreakdown) {
            recordSnapshot(orgId, now, cached.data.salesBreakdown.totalSales, cached.data.salesBreakdown.totalTickets, cached.data.salesBreakdown.totalNumbers);
        }

        if (cached) {
            log.warn('Feed fetch failed, returning stale cache', { orgId, error: error.message });
            return cached.data;
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
        .sort((a, b) => new Date(b.datePicked) - new Date(a.datePicked));

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
 * Time windows for multi-window velocity (stock ticker style).
 * Each window defines: label, duration in ms, and the "prior" comparison period.
 */
const VELOCITY_WINDOWS = [
    { key: '1m',  label: '1 min',   ms: 1 * 60 * 1000 },
    { key: '5m',  label: '5 min',   ms: 5 * 60 * 1000 },
    { key: '10m', label: '10 min',  ms: 10 * 60 * 1000 },
    { key: '30m', label: '30 min',  ms: 30 * 60 * 1000 },
    { key: '1h',  label: '1 hour',  ms: 60 * 60 * 1000 },
    { key: '3h',  label: '3 hours', ms: 3 * 60 * 60 * 1000 },
    { key: '24h', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
    { key: '7d',  label: '7 days',  ms: 7 * 24 * 60 * 60 * 1000 }
];

/**
 * Build velocity data from sales snapshots for the frontend stock-ticker card.
 * Returns all samples plus per-window velocity stats.
 */
function buildVelocityData(snapshots) {
    if (snapshots.length < 2) return { samples: [], surge: null, windows: {} };

    const samples = snapshots.map(s => ({
        ts: s.ts,
        sales: s.totalSales,
        tickets: s.totalTickets,
        numbers: s.totalNumbers || 0
    }));

    const now = snapshots[snapshots.length - 1].ts;
    const currentSnap = snapshots[snapshots.length - 1];

    // Build per-window stats
    const windows = {};
    for (const win of VELOCITY_WINDOWS) {
        const cutoff = now - win.ms;
        const priorCutoff = now - win.ms * 2;

        // Find the earliest snapshot within this window
        const windowStart = snapshots.find(s => s.ts >= cutoff) || snapshots[0];
        // Find the earliest snapshot within the prior comparison window
        const priorStart = snapshots.find(s => s.ts >= priorCutoff) || snapshots[0];

        const salesDelta = currentSnap.totalSales - windowStart.totalSales;
        const ticketsDelta = currentSnap.totalTickets - windowStart.totalTickets;
        const numbersDelta = (currentSnap.totalNumbers || 0) - (windowStart.totalNumbers || 0);
        const priorDelta = windowStart.totalSales - priorStart.totalSales;

        let percentChange = null;
        if (priorDelta > 0) {
            percentChange = Math.round(((salesDelta - priorDelta) / priorDelta) * 100);
        }

        // Filter samples within this window for the sparkline
        const windowSamples = samples.filter(s => s.ts >= cutoff);

        windows[win.key] = {
            key: win.key,
            label: win.label,
            durationMs: win.ms,
            salesDelta,
            ticketsDelta,
            numbersDelta,
            percentChange,
            priorDelta,
            samples: windowSamples
        };
    }

    // Default surge uses 1h window for backwards compat
    const hourWindow = windows['1h'];
    const surge = hourWindow ? {
        recentSales: hourWindow.salesDelta,
        priorSales: hourWindow.priorDelta,
        percent: hourWindow.percentChange,
        periodMinutes: 60
    } : null;

    return { samples, surge, windows };
}

/**
 * Resolve feed URLs for a request — uses org's DB-configured URLs,
 * falling back to legacy environment variables.
 */
async function resolveOrgFeedUrls(orgId) {
    if (!orgId) return null;
    try {
        const urls = await getOrgFeedUrls(orgId);
        if (urls.feedUrl) return urls;
    } catch (err) {
        log.warn('Could not look up org feed URLs, falling back to env vars', { orgId, error: err.message });
    }
    // Fallback to environment variables for legacy/migration period
    return {
        feedUrl: ENV_FEED_URL || null,
        winnersFeedUrl: ENV_WINNERS_FEED_URL || null,
        salesFeedUrl: ENV_SALES_FEED_URL || null
    };
}

// GET /api/feed-dashboard/data
router.get('/data', authenticate, async (req, res) => {
    try {
        const orgId = req.organizationId;
        const urls = await resolveOrgFeedUrls(orgId);
        if (!urls || !urls.feedUrl) {
            return res.json({ notConfigured: true, error: 'No BUMP feed URLs configured. Go to Teams > BUMP Feed Configuration to set them up.' });
        }
        const data = await fetchFeed(orgId, urls.feedUrl, urls.winnersFeedUrl, urls.salesFeedUrl);
        res.json(data);
    } catch (error) {
        log.error('Feed dashboard error', { error: error.message });
        res.status(502).json({ error: 'Unable to fetch feed data', message: error.message });
    }
});

// GET /api/feed-dashboard/status — show which feeds are configured
router.get('/status', authenticate, async (req, res) => {
    const orgId = req.organizationId;
    const urls = orgId ? await resolveOrgFeedUrls(orgId) : null;
    const cached = orgId ? _feedCaches.get(orgId) : null;
    res.json({
        mainFeed: { url: urls?.feedUrl || null, configured: !!urls?.feedUrl },
        winnersFeed: { url: urls?.winnersFeedUrl || null, configured: !!urls?.winnersFeedUrl },
        salesFeed: { url: urls?.salesFeedUrl || null, configured: !!urls?.salesFeedUrl },
        cacheTtl: FEED_CACHE_TTL,
        cacheAge: cached ? Date.now() - cached.cacheTime : null
    });
});

// POST /api/feed-dashboard/refresh — force cache refresh
router.post('/refresh', authenticate, async (req, res) => {
    const orgId = req.organizationId;
    if (orgId) _feedCaches.delete(orgId);
    try {
        const urls = await resolveOrgFeedUrls(orgId);
        if (!urls || !urls.feedUrl) {
            return res.json({ notConfigured: true, error: 'No BUMP feed URLs configured.' });
        }
        const data = await fetchFeed(orgId, urls.feedUrl, urls.winnersFeedUrl, urls.salesFeedUrl);
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

// Background snapshot collection — fetches every 90 seconds for ALL orgs that have
// feed URLs configured, so velocity data accumulates continuously 24/7.
const VELOCITY_BG_INTERVAL = 90 * 1000;
const VELOCITY_HEALTH_LOG_INTERVAL = 30 * 60 * 1000; // Log health stats every 30 min

async function backgroundFetchAllOrgs() {
    try {
        const result = await pool.query(
            'SELECT id, bump_feed_url, bump_winners_feed_url, bump_sales_feed_url FROM organizations WHERE bump_feed_url IS NOT NULL'
        );
        const promises = result.rows.map(row =>
            fetchFeed(row.id, row.bump_feed_url, row.bump_winners_feed_url, row.bump_sales_feed_url)
                .catch(err => {
                    _bgFetchFails++;
                    log.warn('Background velocity fetch failed', { orgId: row.id, error: err.message, totalFails: _bgFetchFails });
                })
        );
        await Promise.allSettled(promises);
    } catch (err) {
        // Query itself failed (e.g. migration not yet applied) — fall back to env vars
        log.warn('Background fetch org query failed, using env fallback', { error: err.message });
        fetchFeed('_legacy', ENV_FEED_URL, ENV_WINNERS_FEED_URL, ENV_SALES_FEED_URL).catch(() => { _bgFetchFails++; });
    }
}

setInterval(() => {
    _bgFetchCount++;
    backgroundFetchAllOrgs();
}, VELOCITY_BG_INTERVAL);

// Run once on startup after a short delay to seed the first snapshot
setTimeout(() => {
    _bgFetchCount++;
    backgroundFetchAllOrgs();
}, 5000);

// Periodic health log — helps diagnose overnight gaps by checking Render logs
setInterval(() => {
    let totalSnapshots = 0;
    let totalPending = 0;
    for (const [, snaps] of _salesSnapshotsByOrg) totalSnapshots += snaps.length;
    for (const [, pending] of _pendingDbSnapshotsByOrg) totalPending += pending.length;
    log.info('Heartbeat background health', {
        orgsTracked: _salesSnapshotsByOrg.size,
        snapshotsInMemory: totalSnapshots,
        pendingDbWrites: totalPending,
        bgFetches: _bgFetchCount,
        bgFails: _bgFetchFails
    });
}, VELOCITY_HEALTH_LOG_INTERVAL);

module.exports = router;
