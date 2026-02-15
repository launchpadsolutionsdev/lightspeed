/**
 * Admin Routes
 * Super admin dashboard endpoints
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');
const auditLog = require('../services/auditLog');

/**
 * GET /api/admin/dashboard
 * Main dashboard data (expected by frontend)
 */
router.get('/dashboard', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        // Get total user count
        const userCount = await pool.query('SELECT COUNT(*) FROM users');

        // Get total organization count
        const orgCount = await pool.query('SELECT COUNT(*) FROM organizations');

        // Get new users today
        const newUsersToday = await pool.query(
            `SELECT COUNT(*) FROM users WHERE created_at > CURRENT_DATE`
        );

        // Get new orgs this week
        const newOrgsThisWeek = await pool.query(
            `SELECT COUNT(*) FROM organizations
             WHERE created_at > NOW() - INTERVAL '7 days'`
        );

        // Get active users in last 7 days
        const activeUsers7Days = await pool.query(
            `SELECT COUNT(DISTINCT user_id) FROM usage_logs
             WHERE created_at > NOW() - INTERVAL '7 days'`
        );

        // Get active users today
        const activeUsersToday = await pool.query(
            `SELECT COUNT(DISTINCT user_id) FROM usage_logs
             WHERE created_at > CURRENT_DATE`
        );

        // Get total requests in 30 days
        const totalRequests30Days = await pool.query(
            `SELECT COUNT(*) FROM usage_logs
             WHERE created_at > NOW() - INTERVAL '30 days'`
        );

        // Get requests today
        const requestsToday = await pool.query(
            `SELECT COUNT(*) FROM usage_logs WHERE created_at > CURRENT_DATE`
        );

        // Calculate real performance metrics from usage_logs
        const perfMetrics = await pool.query(
            `SELECT
                 COALESCE(AVG(response_time_ms) FILTER (WHERE response_time_ms IS NOT NULL), 0) as avg_response_time,
                 CASE WHEN COUNT(*) > 0
                      THEN ROUND(COUNT(*) FILTER (WHERE success IS NOT FALSE)::numeric / COUNT(*) * 100)
                      ELSE 100
                 END as success_rate
             FROM usage_logs
             WHERE created_at > NOW() - INTERVAL '30 days'`
        );
        const avgResponseTimeMs = Math.round(parseFloat(perfMetrics.rows[0].avg_response_time)) || 0;
        const successRate = parseInt(perfMetrics.rows[0].success_rate) || 100;

        // Get tool usage breakdown
        const toolUsage = await pool.query(
            `SELECT tool, COUNT(*) as count, SUM(total_tokens) as tokens
             FROM usage_logs
             WHERE created_at > NOW() - INTERVAL '30 days'
             GROUP BY tool
             ORDER BY count DESC`
        );

        // Get daily activity for last 14 days
        const dailyActivity = await pool.query(
            `SELECT DATE(created_at) as date, COUNT(*) as requests, COUNT(DISTINCT user_id) as users
             FROM usage_logs
             WHERE created_at > NOW() - INTERVAL '14 days'
             GROUP BY DATE(created_at)
             ORDER BY date DESC`
        );

        // Get subscription stats
        const trialCount = await pool.query(
            `SELECT COUNT(*) FROM organizations WHERE subscription_status = 'trial'`
        );
        const activeCount = await pool.query(
            `SELECT COUNT(*) FROM organizations WHERE subscription_status = 'active'`
        );
        const cancelledCount = await pool.query(
            `SELECT COUNT(*) FROM organizations WHERE subscription_status = 'cancelled'`
        );

        res.json({
            overview: {
                totalUsers: parseInt(userCount.rows[0].count),
                totalOrganizations: parseInt(orgCount.rows[0].count),
                newUsersToday: parseInt(newUsersToday.rows[0].count),
                newOrgsThisWeek: parseInt(newOrgsThisWeek.rows[0].count),
                activeUsers7Days: parseInt(activeUsers7Days.rows[0].count),
                activeUsersToday: parseInt(activeUsersToday.rows[0].count),
                totalRequests30Days: parseInt(totalRequests30Days.rows[0].count),
                requestsToday: parseInt(requestsToday.rows[0].count),
                avgResponseTimeMs: avgResponseTimeMs,
                successRate: successRate
            },
            toolUsage: toolUsage.rows || [],
            dailyActivity: dailyActivity.rows || [],
            subscriptions: {
                trial: parseInt(trialCount.rows[0].count),
                active: parseInt(activeCount.rows[0].count),
                cancelled: parseInt(cancelledCount.rows[0].count)
            }
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
        const days = Math.max(1, Math.min(365, parseInt(period) || 30));

        // Daily active users
        const dailyActiveUsers = await pool.query(
            `SELECT DATE(created_at) as date, COUNT(DISTINCT user_id) as active_users
             FROM usage_logs
             WHERE created_at > NOW() - make_interval(days => $1)
             GROUP BY DATE(created_at)
             ORDER BY date DESC`,
            [days]
        );

        // Retention calculation (week over week)
        const week1Users = await pool.query(
            `SELECT COUNT(DISTINCT user_id) as count FROM usage_logs
             WHERE created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'`
        );
        const returnedUsers = await pool.query(
            `SELECT COUNT(DISTINCT ul2.user_id) as count
             FROM usage_logs ul1
             JOIN usage_logs ul2 ON ul1.user_id = ul2.user_id
             WHERE ul1.created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'
             AND ul2.created_at > NOW() - INTERVAL '7 days'`
        );
        const week1Count = parseInt(week1Users.rows[0].count) || 1;
        const returnedCount = parseInt(returnedUsers.rows[0].count) || 0;
        const retentionRate = Math.round((returnedCount / week1Count) * 100);

        // Feature adoption (percentage of users who used each tool)
        const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
        const featureAdoption = await pool.query(
            `SELECT tool, COUNT(DISTINCT user_id) as users
             FROM usage_logs
             WHERE created_at > NOW() - make_interval(days => $1)
             GROUP BY tool`,
            [days]
        );
        const totalUserCount = parseInt(totalUsers.rows[0].count) || 1;
        const featureAdoptionData = featureAdoption.rows.map(f => ({
            tool: f.tool,
            adoption_rate: Math.round((parseInt(f.users) / totalUserCount) * 100)
        }));

        // Top users by activity
        const topUsers = await pool.query(
            `SELECT u.id, u.first_name, u.last_name, u.email,
                    COUNT(*) as request_count,
                    MAX(ul.created_at) as last_active
             FROM usage_logs ul
             JOIN users u ON ul.user_id = u.id
             WHERE ul.created_at > NOW() - make_interval(days => $1)
             GROUP BY u.id, u.first_name, u.last_name, u.email
             ORDER BY request_count DESC
             LIMIT 10`,
            [days]
        );

        // Peak usage hours
        const peakUsageHours = await pool.query(
            `SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as request_count
             FROM usage_logs
             WHERE created_at > NOW() - make_interval(days => $1)
             GROUP BY EXTRACT(HOUR FROM created_at)
             ORDER BY hour`,
            [days]
        );

        res.json({
            period: `${days} days`,
            dailyActiveUsers: dailyActiveUsers.rows || [],
            retention: {
                retentionRate: retentionRate || 0,
                returnedUsers: returnedCount || 0,
                week1Users: week1Count || 0
            },
            featureAdoption: featureAdoptionData || [],
            topUsers: topUsers.rows || [],
            peakUsageHours: peakUsageHours.rows || []
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
                   o.name as organization_name, o.id as organization_id, om.role
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
        const { days: rawDays = 30 } = req.query;
        const days = Math.max(1, Math.min(365, parseInt(rawDays) || 30));

        // Daily usage for the period
        const dailyUsage = await pool.query(
            `SELECT DATE(created_at) as date,
                    tool,
                    SUM(total_tokens) as tokens,
                    COUNT(*) as requests
             FROM usage_logs
             WHERE created_at > NOW() - make_interval(days => $1)
             GROUP BY DATE(created_at), tool
             ORDER BY date DESC`,
            [days]
        );

        // Top organizations by usage
        const topOrgs = await pool.query(
            `SELECT o.name, SUM(ul.total_tokens) as total_tokens, COUNT(*) as requests
             FROM usage_logs ul
             JOIN organizations o ON ul.organization_id = o.id
             WHERE ul.created_at > NOW() - make_interval(days => $1)
             GROUP BY o.id, o.name
             ORDER BY total_tokens DESC
             LIMIT 10`,
            [days]
        );

        // Usage by tool
        const toolUsage = await pool.query(
            `SELECT tool, SUM(total_tokens) as total_tokens, COUNT(*) as requests
             FROM usage_logs
             WHERE created_at > NOW() - make_interval(days => $1)
             GROUP BY tool
             ORDER BY total_tokens DESC`,
            [days]
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

        auditLog.logAction({ userId: req.userId, action: 'SUPER_ADMIN_TOGGLED', resourceType: 'USER', resourceId: userId, changes: { is_super_admin: isSuperAdmin }, req });
        res.json({ message: 'Super admin status updated' });

    } catch (error) {
        console.error('Update super admin error:', error);
        res.status(500).json({ error: 'Failed to update super admin status' });
    }
});

/**
 * GET /api/admin/recent-activity
 * Recent signups, logins, and usage events
 */
router.get('/recent-activity', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { limit = 50 } = req.query;

        // Recent signups
        const recentSignups = await pool.query(
            `SELECT id, email, first_name, last_name, created_at
             FROM users ORDER BY created_at DESC LIMIT $1`, [parseInt(limit)]
        );

        // Recent usage activity
        const recentUsage = await pool.query(
            `SELECT ul.tool, ul.total_tokens, ul.created_at,
                    u.first_name, u.last_name, u.email,
                    o.name as organization_name
             FROM usage_logs ul
             LEFT JOIN users u ON ul.user_id = u.id
             LEFT JOIN organizations o ON ul.organization_id = o.id
             ORDER BY ul.created_at DESC LIMIT $1`, [parseInt(limit)]
        );

        // Recent logins
        const recentLogins = await pool.query(
            `SELECT id, email, first_name, last_name, last_login_at
             FROM users
             WHERE last_login_at IS NOT NULL
             ORDER BY last_login_at DESC LIMIT $1`, [parseInt(limit)]
        );

        res.json({
            recentSignups: recentSignups.rows,
            recentUsage: recentUsage.rows,
            recentLogins: recentLogins.rows
        });

    } catch (error) {
        console.error('Get recent activity error:', error);
        res.status(500).json({ error: 'Failed to get recent activity' });
    }
});

/**
 * GET /api/admin/cost-estimate
 * Estimated API costs based on token usage
 */
router.get('/cost-estimate', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        // Claude Sonnet 4 pricing: $3/1M input, $15/1M output
        // We track total_tokens (input+output combined), estimate ~40% input, 60% output
        const INPUT_RATE = 3.00 / 1000000;
        const OUTPUT_RATE = 15.00 / 1000000;
        const INPUT_RATIO = 0.4;
        const OUTPUT_RATIO = 0.6;

        // Total tokens by period
        const tokensByPeriod = await pool.query(`
            SELECT
                SUM(CASE WHEN created_at > CURRENT_DATE THEN total_tokens ELSE 0 END) as tokens_today,
                SUM(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN total_tokens ELSE 0 END) as tokens_7d,
                SUM(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN total_tokens ELSE 0 END) as tokens_30d,
                SUM(total_tokens) as tokens_all_time
            FROM usage_logs
        `);

        const row = tokensByPeriod.rows[0];
        const calcCost = (tokens) => {
            const t = parseInt(tokens) || 0;
            return ((t * INPUT_RATIO * INPUT_RATE) + (t * OUTPUT_RATIO * OUTPUT_RATE)).toFixed(2);
        };

        // Cost by tool (30 days)
        const costByTool = await pool.query(`
            SELECT tool, SUM(total_tokens) as tokens, COUNT(*) as requests
            FROM usage_logs
            WHERE created_at > NOW() - INTERVAL '30 days'
            GROUP BY tool ORDER BY tokens DESC
        `);

        // Cost by organization (30 days)
        const costByOrg = await pool.query(`
            SELECT o.name, SUM(ul.total_tokens) as tokens, COUNT(*) as requests
            FROM usage_logs ul
            JOIN organizations o ON ul.organization_id = o.id
            WHERE ul.created_at > NOW() - INTERVAL '30 days'
            GROUP BY o.id, o.name ORDER BY tokens DESC LIMIT 20
        `);

        // Daily cost trend (last 30 days)
        const dailyCost = await pool.query(`
            SELECT DATE(created_at) as date, SUM(total_tokens) as tokens, COUNT(*) as requests
            FROM usage_logs
            WHERE created_at > NOW() - INTERVAL '30 days'
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `);

        res.json({
            summary: {
                today: { tokens: parseInt(row.tokens_today) || 0, cost: calcCost(row.tokens_today) },
                week: { tokens: parseInt(row.tokens_7d) || 0, cost: calcCost(row.tokens_7d) },
                month: { tokens: parseInt(row.tokens_30d) || 0, cost: calcCost(row.tokens_30d) },
                allTime: { tokens: parseInt(row.tokens_all_time) || 0, cost: calcCost(row.tokens_all_time) }
            },
            byTool: costByTool.rows.map(r => ({ ...r, cost: calcCost(r.tokens) })),
            byOrg: costByOrg.rows.map(r => ({ ...r, cost: calcCost(r.tokens) })),
            dailyTrend: dailyCost.rows.map(r => ({ ...r, cost: calcCost(r.tokens) }))
        });

    } catch (error) {
        console.error('Get cost estimate error:', error);
        res.status(500).json({ error: 'Failed to get cost estimates' });
    }
});

/**
 * GET /api/admin/organizations-list
 * Lightweight list of all organizations (id + name) for dropdowns
 */
router.get('/organizations-list', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name FROM organizations ORDER BY name ASC'
        );
        res.json({ organizations: result.rows });
    } catch (error) {
        console.error('Get organizations list error:', error);
        res.status(500).json({ error: 'Failed to get organizations list' });
    }
});

/**
 * PUT /api/admin/users/:userId/organization
 * Assign or reassign a user to an organization (bypasses invitation flow)
 */
router.put('/users/:userId/organization', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { organizationId, role } = req.body;

        if (!organizationId || !role) {
            return res.status(400).json({ error: 'organizationId and role are required' });
        }

        if (!['owner', 'admin', 'member'].includes(role)) {
            return res.status(400).json({ error: 'Role must be owner, admin, or member' });
        }

        // Verify user exists
        const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify organization exists
        const orgCheck = await pool.query('SELECT id FROM organizations WHERE id = $1', [organizationId]);
        if (orgCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Organization not found' });
        }

        // Remove any existing memberships for this user (single-org model)
        await pool.query('DELETE FROM organization_memberships WHERE user_id = $1', [userId]);

        // Create the new membership
        await pool.query(
            `INSERT INTO organization_memberships (user_id, organization_id, role, created_at)
             VALUES ($1, $2, $3, NOW())`,
            [userId, organizationId, role]
        );

        // Get updated info for response
        const updated = await pool.query(
            `SELECT o.name as organization_name, o.id as organization_id, om.role
             FROM organization_memberships om
             JOIN organizations o ON om.organization_id = o.id
             WHERE om.user_id = $1`,
            [userId]
        );

        auditLog.logAction({ orgId: organizationId, userId: req.userId, action: 'ADMIN_USER_ASSIGNED_TO_ORG', resourceType: 'MEMBERSHIP', resourceId: userId, changes: { organization_id: organizationId, role }, req });
        res.json({
            message: 'User organization updated',
            membership: updated.rows[0]
        });

    } catch (error) {
        console.error('Assign user organization error:', error);
        res.status(500).json({ error: 'Failed to assign user to organization' });
    }
});

/**
 * PATCH /api/admin/users/:userId/role
 * Change a user's role within their current organization
 */
router.patch('/users/:userId/role', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { role } = req.body;

        if (!role || !['owner', 'admin', 'member'].includes(role)) {
            return res.status(400).json({ error: 'Role must be owner, admin, or member' });
        }

        // Check user has a membership
        const membership = await pool.query(
            'SELECT user_id FROM organization_memberships WHERE user_id = $1',
            [userId]
        );
        if (membership.rows.length === 0) {
            return res.status(404).json({ error: 'User is not assigned to any organization' });
        }

        await pool.query(
            'UPDATE organization_memberships SET role = $1 WHERE user_id = $2',
            [role, userId]
        );

        auditLog.logAction({ userId: req.userId, action: 'ADMIN_USER_ROLE_CHANGED', resourceType: 'MEMBERSHIP', resourceId: userId, changes: { new_role: role }, req });
        res.json({ message: 'User role updated' });

    } catch (error) {
        console.error('Update user role error:', error);
        res.status(500).json({ error: 'Failed to update user role' });
    }
});

/**
 * DELETE /api/admin/users/:userId/organization
 * Remove a user from their organization
 */
router.delete('/users/:userId/organization', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { userId } = req.params;

        const result = await pool.query(
            'DELETE FROM organization_memberships WHERE user_id = $1',
            [userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User is not assigned to any organization' });
        }

        auditLog.logAction({ userId: req.userId, action: 'ADMIN_USER_REMOVED_FROM_ORG', resourceType: 'MEMBERSHIP', resourceId: userId, req });
        res.json({ message: 'User removed from organization' });

    } catch (error) {
        console.error('Remove user from organization error:', error);
        res.status(500).json({ error: 'Failed to remove user from organization' });
    }
});

// ==================== ORG ONBOARDING ENDPOINTS ====================

/**
 * POST /api/admin/organizations
 * Create a new organization
 */
router.post('/organizations', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Organization name is required' });
        }

        const orgId = uuidv4();
        const trimmedName = name.trim();
        const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

        const result = await pool.query(
            `INSERT INTO organizations (id, name, slug, subscription_status, trial_ends_at, created_at)
             VALUES ($1, $2, $3, 'trial', $4, NOW())
             RETURNING *`,
            [orgId, trimmedName, slug, trialEndsAt]
        );

        auditLog.logAction({ orgId: orgId, userId: req.userId, action: 'ADMIN_ORG_CREATED', resourceType: 'ORGANIZATION', resourceId: orgId, changes: { name: trimmedName }, req });
        res.status(201).json({ organization: result.rows[0] });
    } catch (error) {
        console.error('Create organization error:', error);
        res.status(500).json({ error: 'Failed to create organization' });
    }
});

/**
 * GET /api/admin/organizations/:orgId/setup
 * Get full org details + setup completeness status
 */
router.get('/organizations/:orgId/setup', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { orgId } = req.params;

        const orgResult = await pool.query('SELECT * FROM organizations WHERE id = $1', [orgId]);
        if (orgResult.rows.length === 0) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        const org = orgResult.rows[0];

        // Get KB entry count
        const kbCount = await pool.query(
            'SELECT COUNT(*) FROM knowledge_base WHERE organization_id = $1', [orgId]
        );

        // Get content template count
        const templateCount = await pool.query(
            'SELECT COUNT(*) FROM content_templates WHERE organization_id = $1 AND is_active = TRUE', [orgId]
        );

        // Get draw schedule status
        const drawSchedule = await pool.query(
            'SELECT id, draw_name, is_active FROM draw_schedules WHERE organization_id = $1 AND is_active = TRUE LIMIT 1', [orgId]
        );

        // Get member count
        const memberCount = await pool.query(
            'SELECT COUNT(*) FROM organization_memberships WHERE organization_id = $1', [orgId]
        );

        // Build setup checklist
        const checklist = {
            orgCreated: true,
            websiteSet: !!org.website_url,
            licenceSet: !!org.licence_number,
            kbPopulated: parseInt(kbCount.rows[0].count) > 0,
            templatesImported: parseInt(templateCount.rows[0].count) > 0,
            drawScheduleUploaded: drawSchedule.rows.length > 0,
            brandTerminologySet: !!org.brand_terminology,
            emailAddonsSet: !!org.email_addons,
            missionSet: !!org.mission,
            membersAdded: parseInt(memberCount.rows[0].count) > 0
        };
        const completedCount = Object.values(checklist).filter(Boolean).length;
        const totalCount = Object.keys(checklist).length;

        res.json({
            organization: org,
            kbCount: parseInt(kbCount.rows[0].count),
            templateCount: parseInt(templateCount.rows[0].count),
            drawSchedule: drawSchedule.rows[0] || null,
            memberCount: parseInt(memberCount.rows[0].count),
            checklist,
            setupProgress: { completed: completedCount, total: totalCount }
        });
    } catch (error) {
        console.error('Get org setup error:', error);
        res.status(500).json({ error: 'Failed to get organization setup' });
    }
});

/**
 * PATCH /api/admin/organizations/:orgId
 * Update any organization's profile (super admin)
 */
router.patch('/organizations/:orgId', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { orgId } = req.params;

        const fieldMap = {
            name: 'name',
            brandVoice: 'brand_voice',
            timezone: 'timezone',
            websiteUrl: 'website_url',
            licenceNumber: 'licence_number',
            storeLocation: 'store_location',
            supportEmail: 'support_email',
            ceoName: 'ceo_name',
            ceoTitle: 'ceo_title',
            mediaContactName: 'media_contact_name',
            mediaContactEmail: 'media_contact_email',
            ctaWebsiteUrl: 'cta_website_url',
            mission: 'mission',
            defaultDrawTime: 'default_draw_time',
            ticketDeadlineTime: 'ticket_deadline_time',
            socialRequiredLine: 'social_required_line',
            brandTerminology: 'brand_terminology',
            emailAddons: 'email_addons'
        };

        const updates = [];
        const values = [];
        let paramCount = 1;

        for (const [bodyKey, dbColumn] of Object.entries(fieldMap)) {
            if (req.body[bodyKey] !== undefined) {
                updates.push(`${dbColumn} = $${paramCount++}`);
                values.push(req.body[bodyKey]);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }

        values.push(orgId);
        const result = await pool.query(
            `UPDATE organizations SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Organization not found' });
        }

        auditLog.logAction({ orgId: orgId, userId: req.userId, action: 'ADMIN_ORG_UPDATED', resourceType: 'ORGANIZATION', resourceId: orgId, changes: req.body, req });
        res.json({ organization: result.rows[0] });
    } catch (error) {
        console.error('Update organization error:', error);
        res.status(500).json({ error: 'Failed to update organization' });
    }
});

/**
 * GET /api/admin/organizations/:orgId/knowledge-base
 * Get all KB entries for an organization
 */
router.get('/organizations/:orgId/knowledge-base', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { orgId } = req.params;
        const result = await pool.query(
            `SELECT * FROM knowledge_base WHERE organization_id = $1 ORDER BY category, title`,
            [orgId]
        );
        res.json({ entries: result.rows });
    } catch (error) {
        console.error('Get org KB error:', error);
        res.status(500).json({ error: 'Failed to get knowledge base' });
    }
});

/**
 * POST /api/admin/organizations/:orgId/knowledge-base
 * Add a KB entry to an organization
 */
router.post('/organizations/:orgId/knowledge-base', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { orgId } = req.params;
        const { title, content, category, tags } = req.body;

        if (!title || !content || !category) {
            return res.status(400).json({ error: 'title, content, and category are required' });
        }

        const result = await pool.query(
            `INSERT INTO knowledge_base (organization_id, title, content, category, tags, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [orgId, title, content, category, tags || '{}', req.userId]
        );

        res.status(201).json({ entry: result.rows[0] });
    } catch (error) {
        console.error('Add KB entry error:', error);
        res.status(500).json({ error: 'Failed to add knowledge base entry' });
    }
});

/**
 * DELETE /api/admin/organizations/:orgId/knowledge-base/:entryId
 * Delete a KB entry
 */
router.delete('/organizations/:orgId/knowledge-base/:entryId', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { orgId, entryId } = req.params;
        const result = await pool.query(
            'DELETE FROM knowledge_base WHERE id = $1 AND organization_id = $2 RETURNING id',
            [entryId, orgId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Entry not found' });
        }
        res.json({ message: 'Entry deleted' });
    } catch (error) {
        console.error('Delete KB entry error:', error);
        res.status(500).json({ error: 'Failed to delete entry' });
    }
});

/**
 * GET /api/admin/organizations/:orgId/content-templates
 * Get content templates for an organization
 */
router.get('/organizations/:orgId/content-templates', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { orgId } = req.params;
        const result = await pool.query(
            `SELECT * FROM content_templates WHERE organization_id = $1 AND is_active = TRUE
             ORDER BY template_type, sort_order, name`,
            [orgId]
        );
        res.json({ templates: result.rows });
    } catch (error) {
        console.error('Get org templates error:', error);
        res.status(500).json({ error: 'Failed to get content templates' });
    }
});

/**
 * POST /api/admin/organizations/:orgId/content-templates/import-all
 * Import all system templates into an organization
 */
router.post('/organizations/:orgId/content-templates/import-all', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { orgId } = req.params;

        const result = await pool.query(
            `INSERT INTO content_templates (organization_id, template_type, name, subject, headline, content, metadata, sort_order, created_by)
             SELECT $1, template_type, name, subject, headline, content, metadata, sort_order, $2
             FROM content_templates
             WHERE organization_id IS NULL
             RETURNING *`,
            [orgId, req.userId]
        );

        res.status(201).json({
            message: `${result.rows.length} templates imported`,
            count: result.rows.length
        });
    } catch (error) {
        console.error('Import templates error:', error);
        res.status(500).json({ error: 'Failed to import templates' });
    }
});

/**
 * GET /api/admin/audit-logs
 * View audit logs with filtering
 */
router.get('/audit-logs', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { action, org_id, user_id, limit = 100, offset = 0 } = req.query;

        let query = `SELECT al.*, u.email as actor_email, u.first_name as actor_first_name, o.name as org_name
                     FROM audit_logs al
                     LEFT JOIN users u ON al.actor_user_id = u.id
                     LEFT JOIN organizations o ON al.organization_id = o.id
                     WHERE 1=1`;
        const params = [];
        let paramCount = 1;

        if (action) {
            query += ` AND al.action = $${paramCount++}`;
            params.push(action);
        }
        if (org_id) {
            query += ` AND al.organization_id = $${paramCount++}`;
            params.push(org_id);
        }
        if (user_id) {
            query += ` AND al.actor_user_id = $${paramCount++}`;
            params.push(user_id);
        }

        query += ` ORDER BY al.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        const countResult = await pool.query('SELECT COUNT(*) FROM audit_logs');

        res.json({
            logs: result.rows,
            total: parseInt(countResult.rows[0].count)
        });
    } catch (error) {
        console.error('Get audit logs error:', error);
        res.status(500).json({ error: 'Failed to get audit logs' });
    }
});

module.exports = router;
