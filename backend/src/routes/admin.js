/**
 * Admin Routes
 * Super admin dashboard endpoints
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');

/**
 * GET /api/admin/dashboard
 * Main dashboard data (expected by frontend)
 */
router.get('/dashboard', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        // Get user count
        const userCount = await pool.query('SELECT COUNT(*) FROM users');

        // Get organization count
        const orgCount = await pool.query('SELECT COUNT(*) FROM organizations');

        // Get active trials count
        const trialCount = await pool.query(
            `SELECT COUNT(*) FROM organizations
             WHERE subscription_status = 'trial' AND trial_ends_at > NOW()`
        );

        // Get paid subscriptions count
        const paidCount = await pool.query(
            `SELECT COUNT(*) FROM organizations
             WHERE subscription_status = 'active'`
        );

        // Get usage stats for last 30 days
        const usageStats = await pool.query(
            `SELECT tool, SUM(total_tokens) as total_tokens, COUNT(*) as request_count
             FROM usage_logs
             WHERE created_at > NOW() - INTERVAL '30 days'
             GROUP BY tool`
        );

        // Get new users this week
        const newUsersThisWeek = await pool.query(
            `SELECT COUNT(*) FROM users
             WHERE created_at > NOW() - INTERVAL '7 days'`
        );

        // Get new orgs this week
        const newOrgsThisWeek = await pool.query(
            `SELECT COUNT(*) FROM organizations
             WHERE created_at > NOW() - INTERVAL '7 days'`
        );

        // Get recent users
        const recentUsers = await pool.query(
            `SELECT id, email, first_name, last_name, picture, created_at
             FROM users ORDER BY created_at DESC LIMIT 10`
        );

        // Get recent organizations
        const recentOrgs = await pool.query(
            `SELECT id, name, subscription_status, created_at
             FROM organizations ORDER BY created_at DESC LIMIT 10`
        );

        res.json({
            stats: {
                totalUsers: parseInt(userCount.rows[0].count),
                totalOrganizations: parseInt(orgCount.rows[0].count),
                activeTrials: parseInt(trialCount.rows[0].count),
                paidSubscriptions: parseInt(paidCount.rows[0].count),
                newUsersThisWeek: parseInt(newUsersThisWeek.rows[0].count),
                newOrgsThisWeek: parseInt(newOrgsThisWeek.rows[0].count)
            },
            usage: usageStats.rows,
            recentUsers: recentUsers.rows,
            recentOrganizations: recentOrgs.rows
        });

    } catch (error) {
        console.error('Get admin dashboard error:', error);
        res.status(500).json({ error: 'Failed to get dashboard data' });
    }
});

/**
 * GET /api/admin/analytics/engagement
 * Engagement analytics (expected by frontend)
 */
router.get('/analytics/engagement', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { period = 30 } = req.query;
        const days = parseInt(period);

        // Daily active users
        const dailyActiveUsers = await pool.query(
            `SELECT DATE(created_at) as date, COUNT(DISTINCT user_id) as active_users
             FROM usage_logs
             WHERE created_at > NOW() - INTERVAL '${days} days'
             GROUP BY DATE(created_at)
             ORDER BY date DESC`
        );

        // Tool usage breakdown
        const toolUsage = await pool.query(
            `SELECT tool, COUNT(*) as count, SUM(total_tokens) as tokens
             FROM usage_logs
             WHERE created_at > NOW() - INTERVAL '${days} days'
             GROUP BY tool
             ORDER BY count DESC`
        );

        // Daily signups
        const dailySignups = await pool.query(
            `SELECT DATE(created_at) as date, COUNT(*) as signups
             FROM users
             WHERE created_at > NOW() - INTERVAL '${days} days'
             GROUP BY DATE(created_at)
             ORDER BY date DESC`
        );

        res.json({
            period: `${days} days`,
            dailyActiveUsers: dailyActiveUsers.rows,
            toolUsage: toolUsage.rows,
            dailySignups: dailySignups.rows
        });

    } catch (error) {
        console.error('Get engagement analytics error:', error);
        res.status(500).json({ error: 'Failed to get engagement data' });
    }
});

/**
 * GET /api/admin/stats
 * Get system-wide statistics
 */
router.get('/stats', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        // Get user count
        const userCount = await pool.query('SELECT COUNT(*) FROM users');

        // Get organization count
        const orgCount = await pool.query('SELECT COUNT(*) FROM organizations');

        // Get active trials count
        const trialCount = await pool.query(
            `SELECT COUNT(*) FROM organizations
             WHERE subscription_status = 'trial' AND trial_ends_at > NOW()`
        );

        // Get paid subscriptions count
        const paidCount = await pool.query(
            `SELECT COUNT(*) FROM organizations
             WHERE subscription_status = 'active'`
        );

        // Get usage stats for last 30 days
        const usageStats = await pool.query(
            `SELECT tool, SUM(total_tokens) as total_tokens, COUNT(*) as request_count
             FROM usage_logs
             WHERE created_at > NOW() - INTERVAL '30 days'
             GROUP BY tool`
        );

        // Get new users this week
        const newUsersThisWeek = await pool.query(
            `SELECT COUNT(*) FROM users
             WHERE created_at > NOW() - INTERVAL '7 days'`
        );

        // Get new orgs this week
        const newOrgsThisWeek = await pool.query(
            `SELECT COUNT(*) FROM organizations
             WHERE created_at > NOW() - INTERVAL '7 days'`
        );

        res.json({
            users: {
                total: parseInt(userCount.rows[0].count),
                newThisWeek: parseInt(newUsersThisWeek.rows[0].count)
            },
            organizations: {
                total: parseInt(orgCount.rows[0].count),
                activeTrials: parseInt(trialCount.rows[0].count),
                paidSubscriptions: parseInt(paidCount.rows[0].count),
                newThisWeek: parseInt(newOrgsThisWeek.rows[0].count)
            },
            usage: usageStats.rows
        });

    } catch (error) {
        console.error('Get admin stats error:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});

/**
 * GET /api/admin/users
 * List all users
 */
router.get('/users', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50, search } = req.query;
        const offset = (page - 1) * limit;

        let query = `
            SELECT u.id, u.email, u.first_name, u.last_name, u.picture,
                   u.is_super_admin, u.created_at, u.last_login_at,
                   o.name as organization_name, om.role
            FROM users u
            LEFT JOIN organization_memberships om ON u.id = om.user_id
            LEFT JOIN organizations o ON om.organization_id = o.id
        `;

        const params = [];
        let paramCount = 1;

        if (search) {
            query += ` WHERE u.email ILIKE $${paramCount} OR u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount}`;
            params.push(`%${search}%`);
            paramCount++;
        }

        query += ` ORDER BY u.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);

        // Get total count
        let countQuery = 'SELECT COUNT(*) FROM users';
        if (search) {
            countQuery += ` WHERE email ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1`;
        }
        const countResult = await pool.query(countQuery, search ? [`%${search}%`] : []);

        res.json({
            users: result.rows,
            total: parseInt(countResult.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        });

    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to get users' });
    }
});

/**
 * GET /api/admin/organizations
 * List all organizations
 */
router.get('/organizations', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50, search, status } = req.query;
        const offset = (page - 1) * limit;

        let query = `
            SELECT o.*,
                   (SELECT COUNT(*) FROM organization_memberships WHERE organization_id = o.id) as member_count,
                   (SELECT SUM(total_tokens) FROM usage_logs WHERE organization_id = o.id) as total_tokens_used
            FROM organizations o
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 1;

        if (search) {
            query += ` AND o.name ILIKE $${paramCount++}`;
            params.push(`%${search}%`);
        }

        if (status) {
            query += ` AND o.subscription_status = $${paramCount++}`;
            params.push(status);
        }

        query += ` ORDER BY o.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);

        // Get total count
        let countQuery = 'SELECT COUNT(*) FROM organizations WHERE 1=1';
        const countParams = [];
        let countParamIndex = 1;

        if (search) {
            countQuery += ` AND name ILIKE $${countParamIndex++}`;
            countParams.push(`%${search}%`);
        }
        if (status) {
            countQuery += ` AND subscription_status = $${countParamIndex}`;
            countParams.push(status);
        }

        const countResult = await pool.query(countQuery, countParams);

        res.json({
            organizations: result.rows,
            total: parseInt(countResult.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        });

    } catch (error) {
        console.error('Get organizations error:', error);
        res.status(500).json({ error: 'Failed to get organizations' });
    }
});

/**
 * GET /api/admin/usage
 * Get detailed usage analytics
 */
router.get('/usage', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { days = 30 } = req.query;

        // Daily usage for the period
        const dailyUsage = await pool.query(
            `SELECT DATE(created_at) as date,
                    tool,
                    SUM(total_tokens) as tokens,
                    COUNT(*) as requests
             FROM usage_logs
             WHERE created_at > NOW() - INTERVAL '${parseInt(days)} days'
             GROUP BY DATE(created_at), tool
             ORDER BY date DESC`
        );

        // Top organizations by usage
        const topOrgs = await pool.query(
            `SELECT o.name, SUM(ul.total_tokens) as total_tokens, COUNT(*) as requests
             FROM usage_logs ul
             JOIN organizations o ON ul.organization_id = o.id
             WHERE ul.created_at > NOW() - INTERVAL '${parseInt(days)} days'
             GROUP BY o.id, o.name
             ORDER BY total_tokens DESC
             LIMIT 10`
        );

        // Usage by tool
        const toolUsage = await pool.query(
            `SELECT tool, SUM(total_tokens) as total_tokens, COUNT(*) as requests
             FROM usage_logs
             WHERE created_at > NOW() - INTERVAL '${parseInt(days)} days'
             GROUP BY tool
             ORDER BY total_tokens DESC`
        );

        res.json({
            period: `${days} days`,
            dailyUsage: dailyUsage.rows,
            topOrganizations: topOrgs.rows,
            toolBreakdown: toolUsage.rows
        });

    } catch (error) {
        console.error('Get usage error:', error);
        res.status(500).json({ error: 'Failed to get usage data' });
    }
});

/**
 * PATCH /api/admin/users/:userId/super-admin
 * Toggle super admin status
 */
router.patch('/users/:userId/super-admin', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { isSuperAdmin } = req.body;

        // Can't change own super admin status
        if (userId === req.userId) {
            return res.status(400).json({ error: 'Cannot change your own super admin status' });
        }

        await pool.query(
            'UPDATE users SET is_super_admin = $1 WHERE id = $2',
            [isSuperAdmin, userId]
        );

        res.json({ message: 'Super admin status updated' });

    } catch (error) {
        console.error('Update super admin error:', error);
        res.status(500).json({ error: 'Failed to update super admin status' });
    }
});

module.exports = router;
