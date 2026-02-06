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

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());

// CORS configuration
const allowedOrigins = [
    'http://localhost:8000',
    'http://localhost:3000',
    'http://127.0.0.1:8000',
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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
const pool = require('../config/database');
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
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Lightspeed API server running on port ${PORT}`);
        console.log(`Health check: http://localhost:${PORT}/health`);
    });
});

module.exports = app;
