/**
 * Authentication Middleware
 * JWT verification and role-based access control
 */

const jwt = require('jsonwebtoken');
const pool = require('../../config/database');

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

module.exports = {
    authenticate,
    requireOrganization,
    requireAdmin,
    requireOwner,
    requireSuperAdmin
};
