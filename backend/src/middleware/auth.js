/**
 * Authentication Middleware
 * JWT verification and role-based access control
 */

const jwt = require('jsonwebtoken');
const pool = require('../../config/database');
const { cache, TTL } = require('../services/cache');
const log = require('../services/logger');

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

        // Determine active organization.
        // If the client sends an X-Organization-Id header, use that org
        // (after verifying the user is a member). Otherwise fall back to
        // the user's first membership for backwards compatibility.
        const requestedOrgId = req.headers['x-organization-id'] || null;

        if (requestedOrgId) {
            // Verify membership for the requested org
            const memberCacheKey = `auth:org:${decoded.userId}:${requestedOrgId}`;
            let isMember = cache.get(memberCacheKey);
            if (isMember === undefined) {
                const memberRow = await pool.query(
                    'SELECT organization_id FROM organization_memberships WHERE user_id = $1 AND organization_id = $2',
                    [decoded.userId, requestedOrgId]
                );
                isMember = memberRow.rows.length > 0;
                cache.set(memberCacheKey, isMember, TTL.AUTH_ORG);
            }
            req.organizationId = isMember ? requestedOrgId : null;
        } else {
            // Legacy fallback: grab the first org the user belongs to
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
        }

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        log.error('Auth middleware error', { error });
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
        log.error('Org middleware error', { error });
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
    trial: parseInt(process.env.TRIAL_USAGE_LIMIT || '300'),
    active: parseInt(process.env.ACTIVE_USAGE_LIMIT || '500'),
    past_due: parseInt(process.env.PAST_DUE_USAGE_LIMIT || '50')
};

const checkUsageLimit = async (req, res, next) => {
    try {
        // Super admins bypass
        if (req.user?.is_super_admin) return next();

        // Resolve the active organization's subscription info. Prefer the
        // org already attached to the request by `authenticate`; fall back
        // to the user's first membership for safety.
        const orgResult = await pool.query(
            `SELECT o.id AS organization_id, o.subscription_status, o.trial_ends_at
             FROM organizations o
             WHERE o.id = COALESCE(
                 $1::uuid,
                 (SELECT organization_id FROM organization_memberships WHERE user_id = $2 LIMIT 1)
             )`,
            [req.organizationId || null, req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(403).json({
                error: 'You must belong to an organization to use this feature.',
                code: 'AUTH_REQUIRED'
            });
        }

        const { subscription_status, organization_id } = orgResult.rows[0];

        if (subscription_status === 'cancelled') {
            return res.status(403).json({
                error: 'Your subscription has been cancelled. Reactivate to continue.',
                code: 'SUBSCRIPTION_CANCELLED'
            });
        }

        if (!Object.prototype.hasOwnProperty.call(USAGE_LIMITS, subscription_status)) {
            return res.status(403).json({
                error: 'Your subscription is not active.',
                code: 'SUBSCRIPTION_INVALID'
            });
        }

        const limit = USAGE_LIMITS[subscription_status];

        // Count generations this calendar month
        const usageResult = await pool.query(
            `SELECT COUNT(*) AS count FROM usage_logs
             WHERE organization_id = $1
               AND created_at >= date_trunc('month', NOW())`,
            [organization_id]
        );

        const used = parseInt(usageResult.rows[0]?.count || '0', 10);

        if (used >= limit) {
            return res.status(429).json({
                error: `Monthly usage limit reached (${used}/${limit}).`,
                code: 'USAGE_LIMIT_REACHED',
                limit,
                used
            });
        }

        next();
    } catch (error) {
        log.error('checkUsageLimit error', { error: error.message });
        res.status(503).json({
            error: 'Unable to verify usage limit. Please try again.',
            code: 'USAGE_CHECK_FAILED'
        });
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
