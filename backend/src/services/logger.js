/**
 * Structured Logger
 *
 * Replaces raw console.log/warn/error with structured JSON logging
 * in production and human-readable output in development.
 *
 * Usage:
 *   const log = require('./services/logger');
 *   log.info('Server started', { port: 3001 });
 *   log.warn('Rate limit approaching', { userId, count: 9 });
 *   log.error('Database query failed', { error: err.message, query: 'SELECT ...' });
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || 0;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function formatMessage(level, message, data) {
    if (IS_PRODUCTION) {
        // Structured JSON for log aggregators (Render, Datadog, etc.)
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...data
        };
        // Ensure errors are serializable
        if (data?.error instanceof Error) {
            entry.error = { message: data.error.message, stack: data.error.stack };
        }
        return JSON.stringify(entry);
    }

    // Human-readable for development
    const prefix = `[${level.toUpperCase()}]`;
    const dataStr = data && Object.keys(data).length > 0
        ? ' ' + JSON.stringify(data)
        : '';
    return `${prefix} ${message}${dataStr}`;
}

function shouldLog(level) {
    return (LOG_LEVELS[level] || 0) >= MIN_LEVEL;
}

const logger = {
    debug(message, data = {}) {
        if (shouldLog('debug')) console.log(formatMessage('debug', message, data));
    },
    info(message, data = {}) {
        if (shouldLog('info')) console.log(formatMessage('info', message, data));
    },
    warn(message, data = {}) {
        if (shouldLog('warn')) console.warn(formatMessage('warn', message, data));
    },
    error(message, data = {}) {
        if (shouldLog('error')) console.error(formatMessage('error', message, data));
    }
};

module.exports = logger;
