/**
 * Feedback Routes
 * Submit and view user feedback
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

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
        console.error('Submit feedback error:', error);
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
});

/**
 * GET /api/feedback
 * Get all feedback (admin only)
 */
router.get('/', authenticate, async (req, res) => {
    try {
        // Check if user is super admin
        const userResult = await pool.query(
            'SELECT is_super_admin FROM users WHERE id = $1',
            [req.userId]
        );

        if (!userResult.rows[0]?.is_super_admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const result = await pool.query(
            'SELECT * FROM feedback ORDER BY created_at DESC LIMIT 100'
        );

        res.json({ entries: result.rows });

    } catch (error) {
        console.error('Get feedback error:', error);
        res.status(500).json({ error: 'Failed to get feedback' });
    }
});

module.exports = router;
