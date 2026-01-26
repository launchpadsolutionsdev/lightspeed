/**
 * Lightspeed API Server
 * Secure backend proxy for Claude API calls
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;

// Get API key from environment variable (set this in Render dashboard)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
    console.error('WARNING: ANTHROPIC_API_KEY environment variable is not set!');
}

// Security middleware
app.use(helmet());

// CORS - update this with your actual frontend domain after deployment
const allowedOrigins = [
    'http://localhost:8000',
    'http://localhost:3000',
    'http://127.0.0.1:8000',
    process.env.FRONTEND_URL // Set this in Render to your frontend URL
].filter(Boolean);

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);

        if (allowedOrigins.some(allowed => origin.startsWith(allowed) || allowed === origin)) {
            return callback(null, true);
        }

        // In production, be stricter
        if (process.env.NODE_ENV === 'production') {
            return callback(new Error('Not allowed by CORS'));
        }

        return callback(null, true);
    },
    credentials: true
}));

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// Rate limiting - prevent abuse
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute per IP
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', limiter);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main API endpoint - proxies to Claude
app.post('/api/generate', async (req, res) => {
    try {
        const { messages, system, max_tokens = 1024 } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Invalid request: messages array required' });
        }

        if (!ANTHROPIC_API_KEY) {
            return res.status(500).json({ error: 'API key not configured on server' });
        }

        // Call Claude API
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: max_tokens,
                system: system || '',
                messages: messages
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Claude API error:', response.status, errorData);
            return res.status(response.status).json({
                error: errorData.error?.message || 'API request failed'
            });
        }

        const data = await response.json();
        res.json(data);

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Lightspeed API server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});

