/**
 * Feedback Routes
 * Submit and view user feedback
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');
const log = require('../services/logger');

/**
 * POST /api/feedback
 * Submit feedback
 */
router.post('/', authenticate, async (req, res) => {
    try {
        const { name, email, type, message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        const organizationId = orgResult.rows[0]?.organization_id || null;

        const result = await pool.query(
            `INSERT INTO feedback (organization_id, user_id, name, email, type, message, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             RETURNING *`,
            [organizationId, req.userId, name || '', email || '', type || 'general', message]
        );

        res.status(201).json({ entry: result.rows[0] });

    } catch (error) {
        log.error('Submit feedback error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
});

/**
 * GET /api/feedback
 * Get feedback entries.
 *
 * Access model:
 *   - `is_super_admin` is a platform-operator flag (not a customer role).
 *     It should be granted only to staff of the platform provider, never
 *     to customer organization admins.
 *   - By default returns only feedback for the caller's active
 *     organization. A super admin can pass `?scope=all` to see
 *     cross-tenant feedback, or `?organizationId=<uuid>` to scope to a
 *     specific org. Non-super-admins are always restricted to their own
 *     org.
 */
router.get('/', authenticate, async (req, res) => {
    try {
        // Check if user is super admin
        const userResult = await pool.query(
            'SELECT is_super_admin FROM users WHERE id = $1',
            [req.userId]
        );

        const isSuperAdmin = Boolean(userResult.rows[0]?.is_super_admin);

        if (!isSuperAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { scope, organizationId } = req.query;

        let result;
        if (organizationId) {
            result = await pool.query(
                'SELECT * FROM feedback WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100',
                [organizationId]
            );
        } else if (scope === 'all') {
            result = await pool.query(
                'SELECT * FROM feedback ORDER BY created_at DESC LIMIT 100'
            );
        } else {
            // Default: scope to caller's active org to avoid accidental
            // cross-tenant exposure when a super admin opens the page.
            result = await pool.query(
                'SELECT * FROM feedback WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100',
                [req.organizationId || null]
            );
        }

        res.json({ entries: result.rows });

    } catch (error) {
        log.error('Get feedback error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to get feedback' });
    }
});

module.exports = router;
