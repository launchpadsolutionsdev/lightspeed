/**
 * Lightspeed API Server
 * Main Express application setup
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

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
const drawScheduleRoutes = require('./routes/drawSchedules');
const contentTemplateRoutes = require('./routes/contentTemplates');
const exportRoutes = require('./routes/export');
const jurisdictionRoutes = require('./routes/jurisdictions');
const rulesOfPlayRoutes = require('./routes/rulesOfPlay');
const conversationRoutes = require('./routes/conversations');
const sharedPromptRoutes = require('./routes/sharedPrompts');
const pool = require('../config/database');

// Validate required environment variables
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'ANTHROPIC_API_KEY', 'GOOGLE_CLIENT_ID'];
const missing = REQUIRED_ENV.filter(v => !process.env[v]);
if (missing.length > 0) {
    console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

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

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

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
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', timestamp: new Date().toISOString(), database: 'connected' });
    } catch (error) {
        res.status(503).json({ status: 'degraded', timestamp: new Date().toISOString(), database: 'disconnected' });
    }
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
app.use('/api/draw-schedules', drawScheduleRoutes);
app.use('/api/content-templates', contentTemplateRoutes);
app.use('/api/organizations', exportRoutes); // /api/organizations/:orgId/export
app.use('/api/jurisdictions', jurisdictionRoutes);
app.use('/api/rules-of-play', rulesOfPlayRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/shared-prompts', sharedPromptRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Run pending migrations on startup
async function runMigrations() {
    try {
        const fs = require('fs');
        const path = require('path');
        const migrationsDir = path.join(__dirname, '..', 'migrations');
        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();

        for (const file of files) {
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            await pool.query(sql);
            console.log(`Migration applied: ${file}`);
        }
    } catch (error) {
        console.error('Migration error:', error.message);
    }
}

runMigrations().then(() => {
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`Lightspeed API server running on port ${PORT}`);

        // Warn if email is not configured
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            console.warn('\n⚠  EMAIL NOT CONFIGURED — contact form and team invites will not send.');
            console.warn('   Set SMTP_HOST, SMTP_USER, and SMTP_PASS in your .env file.\n');
        }
    });

    // Graceful shutdown
    const shutdown = (signal) => {
        console.log(`\n${signal} received. Shutting down gracefully...`);
        server.close(() => {
            pool.end().then(() => {
                console.log('Database pool closed.');
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
