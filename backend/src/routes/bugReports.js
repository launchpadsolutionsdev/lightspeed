/**
 * Bug Report Routes
 * Submit and manage bug reports, feature requests, and questions
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');
const log = require('../services/logger');

/**
 * POST /api/bug-reports
 * Submit a bug report (any authenticated user)
 */
router.post('/', authenticate, async (req, res) => {
    try {
        const { title, description, category, severity, pageUrl, browserInfo } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Title is required' });
        }
        if (!description || !description.trim()) {
            return res.status(400).json({ error: 'Description is required' });
        }

        const validCategories = ['bug', 'feature', 'question'];
        const validSeverities = ['low', 'medium', 'high', 'critical'];
        const cat = validCategories.includes(category) ? category : 'bug';
        const sev = validSeverities.includes(severity) ? severity : 'medium';

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        const organizationId = orgResult.rows[0]?.organization_id || null;

        const result = await pool.query(
            `INSERT INTO bug_reports (user_id, organization_id, title, description, category, severity, page_url, browser_info)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [req.userId, organizationId, title.trim(), description.trim(), cat, sev, pageUrl || null, browserInfo || null]
        );

        res.status(201).json({ report: result.rows[0] });

    } catch (error) {
        log.error('Submit bug report error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to submit bug report' });
    }
});

/**
 * GET /api/bug-reports
 * List bug reports:
 *   - Super admin: all reports (with filters)
 *   - Regular users: their own reports only
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const { status, category, page = 1, limit = 20 } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

        const userResult = await pool.query('SELECT is_super_admin FROM users WHERE id = $1', [req.userId]);
        const isSuperAdmin = userResult.rows[0]?.is_super_admin;

        let where = [];
        let params = [];
        let paramCount = 1;

        if (!isSuperAdmin) {
            where.push(`br.user_id = $${paramCount++}`);
            params.push(req.userId);
        }
        if (status) {
            where.push(`br.status = $${paramCount++}`);
            params.push(status);
        }
        if (category) {
            where.push(`br.category = $${paramCount++}`);
            params.push(category);
        }

        const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

        const countResult = await pool.query(
            `SELECT COUNT(*) FROM bug_reports br ${whereClause}`,
            params
        );

        params.push(parseInt(limit), offset);
        const result = await pool.query(
            `SELECT br.*, u.first_name, u.last_name, u.email, o.name as organization_name
             FROM bug_reports br
             LEFT JOIN users u ON br.user_id = u.id
             LEFT JOIN organizations o ON br.organization_id = o.id
             ${whereClause}
             ORDER BY br.created_at DESC
             LIMIT $${paramCount++} OFFSET $${paramCount++}`,
            params
        );

        res.json({
            reports: result.rows,
            total: parseInt(countResult.rows[0].count),
            page: parseInt(page),
            totalPages: Math.ceil(parseInt(countResult.rows[0].count) / parseInt(limit))
        });

    } catch (error) {
        log.error('Get bug reports error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to get bug reports' });
    }
});

/**
 * GET /api/bug-reports/stats
 * Summary counts (super admin only)
 */
router.get('/stats', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE status = 'open') as open,
                COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
                COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
                COUNT(*) FILTER (WHERE status = 'closed') as closed,
                COUNT(*) FILTER (WHERE category = 'bug') as bugs,
                COUNT(*) FILTER (WHERE category = 'feature') as features,
                COUNT(*) FILTER (WHERE category = 'question') as questions,
                COUNT(*) as total
            FROM bug_reports
        `);

        res.json({ stats: result.rows[0] });

    } catch (error) {
        log.error('Get bug report stats error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

/**
 * PATCH /api/bug-reports/:id
 * Update status and admin notes (super admin only)
 */
router.patch('/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, adminNotes } = req.body;

        const updates = [];
        const values = [];
        let paramCount = 1;

        if (status) {
            const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }
            updates.push(`status = $${paramCount++}`);
            values.push(status);
        }
        if (adminNotes !== undefined) {
            updates.push(`admin_notes = $${paramCount++}`);
            values.push(adminNotes);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }

        updates.push(`updated_at = NOW()`);
        values.push(id);

        const result = await pool.query(
            `UPDATE bug_reports SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Bug report not found' });
        }

        res.json({ report: result.rows[0] });

    } catch (error) {
        log.error('Update bug report error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to update bug report' });
    }
});

module.exports = router;
