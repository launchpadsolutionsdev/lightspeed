/**
 * Content Calendar Routes
 * Google Calendar-style month view with all-day bars, timed events, and team visibility
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

const VALID_COLORS = ['tomato', 'blue', 'green', 'cyan', 'purple', 'gray', 'orange', 'pink'];

/**
 * GET /api/content-calendar?year=2026&month=3&view=personal|team|all
 * Returns events for the visible month grid (includes adjacent month overflow days)
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        const year = parseInt(req.query.year) || new Date().getFullYear();
        const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
        const view = req.query.view || 'all';

        // Calculate the full grid range (include overflow days from prev/next month)
        const firstOfMonth = new Date(year, month - 1, 1);
        const lastOfMonth = new Date(year, month, 0);
        const gridStart = new Date(firstOfMonth);
        gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay()); // back to Sunday
        const gridEnd = new Date(lastOfMonth);
        const remaining = 6 - lastOfMonth.getDay();
        gridEnd.setDate(gridEnd.getDate() + remaining); // forward to Saturday

        const startDate = gridStart.toISOString().split('T')[0];
        const endDate = gridEnd.toISOString().split('T')[0];

        let viewFilter = '';
        const params = [organizationId, startDate, endDate];

        if (view === 'personal') {
            viewFilter = 'AND ce.visibility = $4 AND ce.created_by = $5';
            params.push('personal', req.userId);
        } else if (view === 'team') {
            viewFilter = 'AND ce.visibility = $4';
            params.push('team');
        }
        // 'all' = no filter

        const result = await pool.query(
            `SELECT ce.*, u.name as created_by_name
             FROM calendar_events ce
             LEFT JOIN users u ON ce.created_by = u.id
             WHERE ce.organization_id = $1
               AND ce.event_date >= $2::date
               AND ce.event_date <= $3::date
               ${viewFilter}
             ORDER BY ce.all_day DESC, ce.event_time ASC NULLS LAST, ce.created_at ASC`,
            params
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
        const { title, description, event_date, event_time, end_time, all_day, color, visibility } = req.body;
        if (!title || !event_date) {
            return res.status(400).json({ error: 'Title and date are required' });
        }

        const safeColor = VALID_COLORS.includes(color) ? color : 'blue';
        const safeVisibility = ['personal', 'team'].includes(visibility) ? visibility : 'personal';
        const isAllDay = all_day === true || all_day === 'true';

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            `INSERT INTO calendar_events (organization_id, title, description, event_date, event_time, end_time, all_day, color, visibility, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [organizationId, title, description || null, event_date,
             isAllDay ? null : (event_time || null),
             isAllDay ? null : (end_time || null),
             isAllDay, safeColor, safeVisibility, req.userId]
        );

        // Re-fetch with creator name
        const full = await pool.query(
            `SELECT ce.*, u.name as created_by_name FROM calendar_events ce LEFT JOIN users u ON ce.created_by = u.id WHERE ce.id = $1`,
            [result.rows[0].id]
        );

        res.json(full.rows[0]);
    } catch (error) {
        console.error('Calendar event create error:', error);
        res.status(500).json({ error: 'Failed to create calendar event' });
    }
});

/**
 * PUT /api/content-calendar/:id
 * Update a calendar event (only creator can edit)
 */
router.put('/:id', authenticate, async (req, res) => {
    try {
        const { title, description, event_date, event_time, end_time, all_day, color, visibility } = req.body;

        const safeColor = color && VALID_COLORS.includes(color) ? color : undefined;
        const safeVisibility = visibility && ['personal', 'team'].includes(visibility) ? visibility : undefined;
        const isAllDay = all_day === true || all_day === 'true';

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        // Verify ownership
        const existing = await pool.query(
            'SELECT created_by FROM calendar_events WHERE id = $1 AND organization_id = $2',
            [req.params.id, organizationId]
        );
        if (existing.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
        if (existing.rows[0].created_by !== req.userId) {
            return res.status(403).json({ error: 'Only the event creator can edit this event' });
        }

        const result = await pool.query(
            `UPDATE calendar_events
             SET title = COALESCE($1, title),
                 description = COALESCE($2, description),
                 event_date = COALESCE($3, event_date),
                 event_time = $4,
                 end_time = $5,
                 all_day = $6,
                 color = COALESCE($7, color),
                 visibility = COALESCE($8, visibility),
                 updated_at = NOW()
             WHERE id = $9 AND organization_id = $10
             RETURNING *`,
            [title, description, event_date,
             isAllDay ? null : (event_time || null),
             isAllDay ? null : (end_time || null),
             isAllDay,
             safeColor, safeVisibility, req.params.id, organizationId]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Event not found' });

        const full = await pool.query(
            `SELECT ce.*, u.name as created_by_name FROM calendar_events ce LEFT JOIN users u ON ce.created_by = u.id WHERE ce.id = $1`,
            [result.rows[0].id]
        );

        res.json(full.rows[0]);
    } catch (error) {
        console.error('Calendar event update error:', error);
        res.status(500).json({ error: 'Failed to update calendar event' });
    }
});

/**
 * DELETE /api/content-calendar/:id (only creator can delete)
 */
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        const existing = await pool.query(
            'SELECT created_by FROM calendar_events WHERE id = $1 AND organization_id = $2',
            [req.params.id, organizationId]
        );
        if (existing.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
        if (existing.rows[0].created_by !== req.userId) {
            return res.status(403).json({ error: 'Only the event creator can delete this event' });
        }

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
