/**
 * Content Calendar Routes
 * Simple campaign planner for scheduling content across types
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/content-calendar
 * List calendar entries for the organization
 * Query: ?view=upcoming|past|all
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        const view = req.query.view || 'upcoming';
        let dateFilter = '';
        if (view === 'upcoming') dateFilter = 'AND scheduled_date >= CURRENT_DATE';
        else if (view === 'past') dateFilter = 'AND scheduled_date < CURRENT_DATE';

        const result = await pool.query(
            `SELECT cc.*, u.name as created_by_name
             FROM content_calendar cc
             LEFT JOIN users u ON cc.created_by = u.id
             WHERE cc.organization_id = $1 ${dateFilter}
             ORDER BY cc.scheduled_date ASC`,
            [organizationId]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Content calendar list error:', error);
        res.status(500).json({ error: 'Failed to load content calendar' });
    }
});

/**
 * POST /api/content-calendar
 * Create a new calendar entry
 */
router.post('/', authenticate, async (req, res) => {
    try {
        const { title, content_type, scheduled_date, notes } = req.body;
        if (!title || !content_type || !scheduled_date) {
            return res.status(400).json({ error: 'Title, content type, and date are required' });
        }

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            `INSERT INTO content_calendar (organization_id, title, content_type, scheduled_date, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [organizationId, title, content_type, scheduled_date, notes || null, req.userId]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Content calendar create error:', error);
        res.status(500).json({ error: 'Failed to create calendar entry' });
    }
});

/**
 * PUT /api/content-calendar/:id
 * Update a calendar entry (status, notes, generated content)
 */
router.put('/:id', authenticate, async (req, res) => {
    try {
        const { title, content_type, scheduled_date, notes, status, generated_content } = req.body;

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            `UPDATE content_calendar
             SET title = COALESCE($1, title),
                 content_type = COALESCE($2, content_type),
                 scheduled_date = COALESCE($3, scheduled_date),
                 notes = COALESCE($4, notes),
                 status = COALESCE($5, status),
                 generated_content = COALESCE($6, generated_content),
                 updated_at = NOW()
             WHERE id = $7 AND organization_id = $8
             RETURNING *`,
            [title, content_type, scheduled_date, notes, status, generated_content, req.params.id, organizationId]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Entry not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Content calendar update error:', error);
        res.status(500).json({ error: 'Failed to update calendar entry' });
    }
});

/**
 * DELETE /api/content-calendar/:id
 */
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        await pool.query(
            'DELETE FROM content_calendar WHERE id = $1 AND organization_id = $2',
            [req.params.id, organizationId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Content calendar delete error:', error);
        res.status(500).json({ error: 'Failed to delete calendar entry' });
    }
});

module.exports = router;
