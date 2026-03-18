/**
 * PostgreSQL Database Configuration
 * Connection pool for Lightspeed backend
 */

const { Pool } = require('pg');
const log = require('../src/services/logger');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false
});

// Test connection on startup
pool.on('connect', () => {
    log.info('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    log.error('Unexpected database error', { error: err.message });
});

module.exports = pool;
