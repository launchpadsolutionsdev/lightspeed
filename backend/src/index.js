/**
 * Lightspeed API Server
 * Main Express application setup
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const log = require('./services/logger');

// Import routes
const authRoutes = require('./routes/auth');
const organizationRoutes = require('./routes/organizations');
const toolsRoutes = require('./routes/tools');
const knowledgeBaseRoutes = require('./routes/knowledgeBase');
const responseHistoryRoutes = require('./routes/responseHistory');
const favoritesRoutes = require('./routes/favorites');
const feedbackRoutes = require('./routes/feedback');
const adminRoutes = require('./routes/admin');
const billingRoutes = require('./routes/billing');
const contactRoutes = require('./routes/contact');
const contentTemplateRoutes = require('./routes/contentTemplates');
const exportRoutes = require('./routes/export');
const jurisdictionRoutes = require('./routes/jurisdictions');
const rulesOfPlayRoutes = require('./routes/rulesOfPlay');
const conversationRoutes = require('./routes/conversations');
const sharedPromptRoutes = require('./routes/sharedPrompts');
const shopifyRoutes = require('./routes/shopify');
const responseRulesRoutes = require('./routes/responseRules');
const contentCalendarRoutes = require('./routes/contentCalendar');
const homeBaseRoutes = require('./routes/homeBase');
const askLightspeedRoutes = require('./routes/askLightspeed');
const complianceRoutes = require('./routes/compliance');
const dashboardRoutes = require('./routes/dashboard');
const feedDashboardRoutes = require('./routes/feedDashboard');
const bugReportRoutes = require('./routes/bugReports');
const shopifyAnalytics = require('./services/shopifyAnalytics');
const { runRetentionCleanup } = require('./services/dataRetention');
const pool = require('../config/database');

// Validate required environment variables
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'ANTHROPIC_API_KEY', 'GOOGLE_CLIENT_ID'];
const missing = REQUIRED_ENV.filter(v => !process.env[v]);
if (missing.length > 0) {
    log.error('Missing required environment variables', { missing });
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Trust first proxy (Render, etc.) so express-rate-limit reads X-Forwarded-For correctly
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS configuration
const allowedOrigins = [
    ...(process.env.NODE_ENV !== 'production' ? [
        'http://localhost:8000',
        'http://localhost:3000',
        'http://127.0.0.1:8000'
    ] : []),
    'https://www.lightspeedutility.ca',
    'https://lightspeedutility.ca',
    process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);

        if (allowedOrigins.some(allowed => origin.startsWith(allowed) || allowed === origin)) {
            return callback(null, true);
        }

        if (process.env.NODE_ENV === 'production') {
            return callback(new Error('Not allowed by CORS'));
        }

        return callback(null, true);
    },
    credentials: true
}));

// Stripe webhook needs raw body for signature verification — must come BEFORE express.json()
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// Shopify webhook needs raw body for HMAC signature verification
app.use('/api/shopify/webhook', express.raw({ type: 'application/json' }));

// Parse JSON bodies
app.use(express.json({ limit: '2mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute per IP
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', limiter);

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 requests per 15 minutes per IP
    message: { error: 'Too many sign-in attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/auth', authLimiter);

// Health check endpoint
app.get('/health', async (req, res) => {
    const health = {
        status: 'operational',
        timestamp: new Date().toISOString(),
        services: {}
    };

    // Check Database
    const dbStart = Date.now();
    try {
        await pool.query('SELECT 1');
        health.services.database = { status: 'operational', latency: Date.now() - dbStart };
    } catch (_error) {
        health.services.database = { status: 'down', latency: null };
        health.status = 'degraded';
    }

    // Check Anthropic API
    const aiStart = Date.now();
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch('https://api.anthropic.com/v1/models', {
            method: 'GET',
            headers: {
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            signal: controller.signal
        });
        clearTimeout(timeout);
        health.services.ai = {
            status: response.ok ? 'operational' : 'degraded',
            latency: Date.now() - aiStart
        };
        if (!response.ok) health.status = 'degraded';
    } catch (_error) {
        health.services.ai = { status: 'down', latency: null };
        health.status = 'degraded';
    }

    // Platform is implicitly operational if this response is being sent
    health.services.platform = { status: 'operational', latency: null };

    // Overall status is "down" only if all services are down
    const statuses = Object.values(health.services).map(s => s.status);
    if (statuses.every(s => s === 'down')) {
        health.status = 'down';
    }

    const statusCode = health.status === 'operational' ? 200 : 503;
    res.status(statusCode).json(health);
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/tools', toolsRoutes);
app.use('/api', toolsRoutes); // Also mount at /api for /api/generate endpoint
app.use('/api/knowledge-base', knowledgeBaseRoutes);
app.use('/api/response-history', responseHistoryRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/content-templates', contentTemplateRoutes);
app.use('/api/organizations', exportRoutes); // /api/organizations/:orgId/export
app.use('/api/jurisdictions', jurisdictionRoutes);
app.use('/api/rules-of-play', rulesOfPlayRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/shared-prompts', sharedPromptRoutes);
app.use('/api/shopify', shopifyRoutes);
app.use('/api/response-rules', responseRulesRoutes);
app.use('/api/content-calendar', contentCalendarRoutes);
app.use('/api/home-base', homeBaseRoutes);
app.use('/api/ask-lightspeed', askLightspeedRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/feed-dashboard', feedDashboardRoutes);
app.use('/api/bug-reports', bugReportRoutes);

// Start reminder checker (runs every 60 seconds)
if (contentCalendarRoutes.checkReminders) {
    setInterval(contentCalendarRoutes.checkReminders, 60000);
    log.info('Calendar reminder checker started (60s interval)');
}

// Start Home Base scheduled post publisher (runs every 60 seconds)
if (homeBaseRoutes.publishScheduledPosts) {
    setInterval(homeBaseRoutes.publishScheduledPosts, 60000);
    log.info('Home Base scheduled post publisher started (60s interval)');
}

// Start Home Base digest email checker (runs every hour)
if (homeBaseRoutes.sendDigestEmails) {
    setInterval(homeBaseRoutes.sendDigestEmails, 60 * 60 * 1000);
    log.info('Home Base digest email checker started (hourly)');
}

// Start Shopify analytics incremental sync (every 15 minutes) with concurrency guard
let analyticsSyncRunning = false;
setInterval(() => {
    if (analyticsSyncRunning) {
        log.debug('Shopify analytics sync skipped — previous sync still running');
        return;
    }
    analyticsSyncRunning = true;
    shopifyAnalytics.syncAllStores()
        .catch(err => log.error('Shopify analytics sync error', { error: err.message }))
        .finally(() => { analyticsSyncRunning = false; });
}, 15 * 60 * 1000);
log.info('Shopify analytics sync scheduler started (15min interval)');

// Start data retention cleanup (runs daily at ~3 AM server time, or every 24 hours)
let retentionRunning = false;
setInterval(() => {
    if (retentionRunning) return;
    retentionRunning = true;
    runRetentionCleanup()
        .catch(err => log.error('Data retention cleanup error', { error: err.message }))
        .finally(() => { retentionRunning = false; });
}, 24 * 60 * 60 * 1000); // 24 hours
log.info('Data retention cleanup scheduler started (24h interval)');

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    log.error('Unhandled error', { error: err });
    res.status(500).json({ error: 'Internal server error' });
});

// Run pending migrations on startup
async function runMigrations() {
    try {
        const migrationsDir = path.join(__dirname, '..', 'migrations');
        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();

        for (const file of files) {
            try {
                const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
                await pool.query(sql);
                log.info('Migration applied', { file });
            } catch (fileError) {
                log.error('Migration error', { file, error: fileError.message });
            }
        }
    } catch (error) {
        log.error('Migration setup error', { error });
    }
}

runMigrations().then(async () => {
    // Seed compliance KB entries from JSON files if table is empty
    try {
        const kbCount = await pool.query('SELECT COUNT(*) FROM compliance_knowledge_base');
        if (parseInt(kbCount.rows[0].count) === 0) {
            log.info('Compliance KB is empty — seeding from JSON files...');
            const dataDir = path.join(__dirname, '..', 'data');
            const kbFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('-kb-entries.json')).sort();
            let totalSeeded = 0;
            for (const file of kbFiles) {
                try {
                    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
                    const entries = raw.entries || raw;
                    for (const entry of entries) {
                        const jurisResult = await pool.query(
                            'SELECT name, regulatory_body FROM compliance_jurisdictions WHERE code = $1',
                            [entry.jurisdiction_code]
                        );
                        if (jurisResult.rows.length === 0) continue;
                        const { name: jName, regulatory_body: rBody } = jurisResult.rows[0];
                        const effectiveContent = entry.original_text || entry.content || '';
                        await pool.query(
                            `INSERT INTO compliance_knowledge_base
                             (jurisdiction_code, jurisdiction_name, regulatory_body, category, title, content,
                              original_text, plain_summary,
                              source_name, source_url, source_section, last_verified_date, verified_by, is_active)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
                            [entry.jurisdiction_code, jName, rBody, entry.category, entry.title, effectiveContent,
                             entry.original_text || null, entry.plain_summary || null,
                             entry.source_name || null, entry.source_url || null, entry.source_section || null,
                             entry.last_verified_date || new Date().toISOString().split('T')[0], 'System', true]
                        );
                        totalSeeded++;
                    }
                    log.info('Compliance KB file seeded', { file, entries: entries.length });
                } catch (fileErr) {
                    log.error('Error seeding compliance KB file', { file, error: fileErr.message });
                }
            }
            // Update Ontario entry count
            const countResult = await pool.query(
                "SELECT COUNT(*) FROM compliance_knowledge_base WHERE jurisdiction_code = 'ON' AND is_active = true"
            );
            await pool.query(
                "UPDATE compliance_jurisdictions SET entry_count = $1, updated_at = NOW() WHERE code = 'ON'",
                [parseInt(countResult.rows[0].count)]
            );
            log.info('Compliance KB seeding complete', { totalSeeded });
        }
    } catch (seedErr) {
        log.error('Compliance KB seed error (non-fatal)', { error: seedErr.message });
    }

    // Optional: load TBRHSF-specific profile / content / KB seed.
    // No-op unless SEED_TBRHSF=true. See src/services/tbrhsfSeeder.js.
    try {
        const { runTbrhsfSeeder } = require('./services/tbrhsfSeeder');
        await runTbrhsfSeeder();
    } catch (tbrhsfErr) {
        log.error('TBRHSF seed error (non-fatal)', { error: tbrhsfErr.message });
    }

    const server = app.listen(PORT, '0.0.0.0', () => {
        log.info('Lightspeed API server running', { port: PORT });

        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            log.warn('Email not configured — contact form and team invites will not send');
        }
    });

    // Graceful shutdown
    const shutdown = (signal) => {
        log.info('Shutting down gracefully', { signal });
        server.close(() => {
            pool.end().then(() => {
                log.info('Database pool closed');
                process.exit(0);
            });
        });
        // Force exit after 10s if graceful shutdown fails
        setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
});

module.exports = app;
