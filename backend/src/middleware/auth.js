/**
 * Authentication Middleware
 * JWT verification and role-based access control
 */

const jwt = require('jsonwebtoken');
const pool = require('../../config/database');
const { cache, TTL } = require('../services/cache');

/**
 * Verify JWT token and attach user to request
 */
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const token = authHeader.split(' ')[1];

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Get user from database
        const userResult = await pool.query(
            'SELECT id, email, first_name, last_name, picture, is_super_admin FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        req.userId = decoded.userId;
        req.user = userResult.rows[0];

        // Cache organization_id on the request so route handlers don't
        // each need a separate SELECT on organization_memberships.
        const orgCacheKey = `auth:org:${decoded.userId}`;
        let orgId = cache.get(orgCacheKey);
        if (orgId === undefined) {
            const orgRow = await pool.query(
                'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
                [decoded.userId]
            );
            orgId = orgRow.rows[0]?.organization_id || null;
            cache.set(orgCacheKey, orgId, TTL.AUTH_ORG);
        }
        req.organizationId = orgId;

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        console.error('Auth middleware error:', error);
        res.status(500).json({ error: 'Authentication error' });
    }
};

/**
 * Load organization from :orgId param and verify membership
 */
const requireOrganization = async (req, res, next) => {
    try {
        const orgId = req.params.orgId;

        if (!orgId) {
            return res.status(400).json({ error: 'Organization ID required' });
        }

        // Get organization
        const orgResult = await pool.query(
            'SELECT * FROM organizations WHERE id = $1',
            [orgId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(404).json({ error: 'Organization not found' });
        }

        // Check membership
        const memberResult = await pool.query(
            'SELECT role FROM organization_memberships WHERE user_id = $1 AND organization_id = $2',
            [req.userId, orgId]
        );

        if (memberResult.rows.length === 0) {
            return res.status(403).json({ error: 'Not a member of this organization' });
        }

        req.organization = orgResult.rows[0];
        req.memberRole = memberResult.rows[0].role;
        next();
    } catch (error) {
        console.error('Org middleware error:', error);
        res.status(500).json({ error: 'Organization verification error' });
    }
};

/**
 * Require admin or owner role
 */
const requireAdmin = (req, res, next) => {
    if (req.memberRole !== 'owner' && req.memberRole !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

/**
 * Require owner role only
 */
const requireOwner = (req, res, next) => {
    if (req.memberRole !== 'owner') {
        return res.status(403).json({ error: 'Owner access required' });
    }
    next();
};

/**
 * Require super admin (system-level admin)
 */
const requireSuperAdmin = (req, res, next) => {
    if (!req.user.is_super_admin) {
        return res.status(403).json({ error: 'Super admin access required' });
    }
    next();
};

/**
 * Check AI generation usage limits based on subscription tier.
 *
 * Limits per status:
 *   trial   — 100 generations/month (prevents abuse during free trial)
 *   active  — 500 generations/month (paid tier)
 *   past_due — 50 generations/month  (grace period while payment is resolved)
 *   cancelled / other — blocked entirely
 *
 * Super admins always bypass limits.
 */
const USAGE_LIMITS = {
    trial: parseInt(process.env.TRIAL_USAGE_LIMIT || '100'),
    active: parseInt(process.env.ACTIVE_USAGE_LIMIT || '500'),
    past_due: parseInt(process.env.PAST_DUE_USAGE_LIMIT || '50')
};

const checkUsageLimit = async (req, res, next) => {
    try {
        // Super admins bypass limits
        if (req.user.is_super_admin) return next();

        // Get user's organization and subscription
        const orgResult = await pool.query(
            `SELECT o.subscription_status, o.trial_ends_at, om.organization_id
             FROM organizations o
             JOIN organization_memberships om ON o.id = om.organization_id
             WHERE om.user_id = $1 LIMIT 1`,
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(403).json({ error: 'No organization found', code: 'AUTH_REQUIRED' });
        }

        const org = orgResult.rows[0];

        // Block cancelled subscriptions entirely
        if (org.subscription_status === 'cancelled') {
            return res.status(403).json({
                error: 'Your subscription has been cancelled. Please resubscribe to continue using AI tools.',
                code: 'SUBSCRIPTION_CANCELLED'
            });
        }

        // Block expired trials
        if (org.subscription_status === 'trial' && org.trial_ends_at && new Date(org.trial_ends_at) < new Date()) {
            return res.status(403).json({
                error: 'Your free trial has expired. Please subscribe to continue using AI tools.',
                code: 'TRIAL_EXPIRED'
            });
        }

        // Look up the monthly limit for this subscription status
        const limit = USAGE_LIMITS[org.subscription_status];
        if (limit === undefined) {
            // Unknown status — block to be safe
            return res.status(403).json({
                error: 'Your subscription status does not allow AI generation. Please contact support.',
                code: 'SUBSCRIPTION_INVALID'
            });
        }

        // Count this month's usage
        const usageQuery = await pool.query(
            `SELECT COUNT(*) FROM usage_logs
             WHERE organization_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)`,
            [org.organization_id]
        );

        const usageCount = parseInt(usageQuery.rows[0].count);

        if (usageCount >= limit) {
            return res.status(429).json({
                error: 'Monthly usage limit reached. Please upgrade your plan or wait until next month.',
                code: 'USAGE_LIMIT_REACHED',
                usageCount,
                limit
            });
        }

        next();
    } catch (error) {
        console.error('Usage limit check error:', error);
        res.status(503).json({ error: 'Unable to verify usage limits. Please try again.' });
    }
};

/**
 * Per-user AI generation rate limiter.
 * Prevents a single authenticated user from flooding AI generation endpoints.
 * Uses in-memory tracking — no Redis dependency needed at current scale.
 */
const AI_RATE_LIMIT = parseInt(process.env.AI_RATE_LIMIT_PER_MINUTE || '10');
const aiRateMap = new Map(); // userId -> { count, windowStart }

// Cleanup stale entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of aiRateMap) {
        if (now - val.windowStart > 120000) aiRateMap.delete(key);
    }
}, 300000);

const checkAIRateLimit = (req, res, next) => {
    // Super admins bypass
    if (req.user?.is_super_admin) return next();

    const userId = req.userId;
    const now = Date.now();
    const windowMs = 60000; // 1 minute

    let entry = aiRateMap.get(userId);

    if (!entry || now - entry.windowStart > windowMs) {
        // New window
        entry = { count: 1, windowStart: now };
        aiRateMap.set(userId, entry);
        return next();
    }

    entry.count++;

    if (entry.count > AI_RATE_LIMIT) {
        const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
        return res.status(429).json({
            error: 'Too many AI generation requests. Please wait a moment.',
            code: 'AI_RATE_LIMIT',
            retryAfter
        });
    }

    next();
};

module.exports = {
    authenticate,
    requireOrganization,
    requireAdmin,
    requireOwner,
    requireSuperAdmin,
    checkUsageLimit,
    checkAIRateLimit
};
