/**
 * Content Calendar Routes
 * Google Calendar-style event planner — freeform events with date, time, color
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

const VALID_COLORS = ['blue', 'red', 'green', 'orange', 'purple', 'pink'];

/**
 * GET /api/content-calendar?month=YYYY-MM
 * List events for the given month (defaults to current month)
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        const month = req.query.month; // YYYY-MM
        let startDate, endDate;
        if (month && /^\d{4}-\d{2}$/.test(month)) {
            startDate = `${month}-01`;
            const [y, m] = month.split('-').map(Number);
            const lastDay = new Date(y, m, 0).getDate();
            endDate = `${month}-${String(lastDay).padStart(2, '0')}`;
        } else {
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            startDate = `${y}-${m}-01`;
            const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
            endDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
        }

        const result = await pool.query(
            `SELECT ce.*, u.name as created_by_name
             FROM calendar_events ce
             LEFT JOIN users u ON ce.created_by = u.id
             WHERE ce.organization_id = $1
               AND ce.event_date >= $2::date
               AND ce.event_date <= $3::date
             ORDER BY ce.event_date ASC, ce.event_time ASC NULLS LAST`,
            [organizationId, startDate, endDate]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Calendar events list error:', error);
        res.status(500).json({ error: 'Failed to load calendar events' });
    }
});

/**
 * POST /api/content-calendar
 * Create a new calendar event
 */
router.post('/', authenticate, async (req, res) => {
    try {
        const { title, event_date, event_time, notes, color } = req.body;
        if (!title || !event_date) {
            return res.status(400).json({ error: 'Title and date are required' });
        }

        const safeColor = VALID_COLORS.includes(color) ? color : 'blue';

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            `INSERT INTO calendar_events (organization_id, title, event_date, event_time, notes, color, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [organizationId, title, event_date, event_time || null, notes || null, safeColor, req.userId]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Calendar event create error:', error);
        res.status(500).json({ error: 'Failed to create calendar event' });
    }
});

/**
 * PUT /api/content-calendar/:id
 * Update a calendar event
 */
router.put('/:id', authenticate, async (req, res) => {
    try {
        const { title, event_date, event_time, notes, color } = req.body;

        const safeColor = color && VALID_COLORS.includes(color) ? color : undefined;

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            `UPDATE calendar_events
             SET title = COALESCE($1, title),
                 event_date = COALESCE($2, event_date),
                 event_time = COALESCE($3, event_time),
                 notes = COALESCE($4, notes),
                 color = COALESCE($5, color),
                 updated_at = NOW()
             WHERE id = $6 AND organization_id = $7
             RETURNING *`,
            [title, event_date, event_time, notes, safeColor, req.params.id, organizationId]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Calendar event update error:', error);
        res.status(500).json({ error: 'Failed to update calendar event' });
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
            'DELETE FROM calendar_events WHERE id = $1 AND organization_id = $2',
            [req.params.id, organizationId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Calendar event delete error:', error);
        res.status(500).json({ error: 'Failed to delete calendar event' });
    }
});

module.exports = router;
