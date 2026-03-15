/**
 * Content Calendar Routes
 * Google Calendar-style month/week view with drag-drop, recurring events, and search
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

const VALID_COLORS = ['tomato', 'blue', 'green', 'cyan', 'purple', 'gray', 'orange', 'pink'];
const VALID_RECURRENCE = ['daily', 'weekly', 'monthly'];

/**
 * Expand a recurring event into virtual instances for a date range
 */
function expandRecurringEvent(event, rangeStart, rangeEnd) {
    if (!event.recurrence_rule) return [event];

    const instances = [];
    const start = new Date(event.event_date);
    const end = event.recurrence_end_date ? new Date(event.recurrence_end_date) : new Date(rangeEnd);
    const rangeStartDate = new Date(rangeStart);
    const rangeEndDate = new Date(rangeEnd);

    // Cap end to reasonable limit (1 year out from start)
    const maxEnd = new Date(start);
    maxEnd.setFullYear(maxEnd.getFullYear() + 1);
    const effectiveEnd = end < maxEnd ? end : maxEnd;

    let current = new Date(start);
    let safety = 0;

    while (current <= effectiveEnd && current <= rangeEndDate && safety < 400) {
        safety++;
        if (current >= rangeStartDate && current <= rangeEndDate) {
            const dateStr = current.toISOString().split('T')[0];
            const isOriginal = dateStr === start.toISOString().split('T')[0];
            instances.push({
                ...event,
                event_date: dateStr,
                is_recurring_instance: !isOriginal,
                recurring_parent_id: event.id
            });
        }

        // Advance to next occurrence
        const next = new Date(current);
        if (event.recurrence_rule === 'daily') {
            next.setDate(next.getDate() + 1);
        } else if (event.recurrence_rule === 'weekly') {
            next.setDate(next.getDate() + 7);
        } else if (event.recurrence_rule === 'monthly') {
            next.setMonth(next.getMonth() + 1);
        }
        current = next;
    }

    return instances;
}

/**
 * GET /api/content-calendar?year=2026&month=3&view=personal|team|all&search=keyword
 * Returns events for the visible month grid (includes adjacent month overflow days)
 * Expands recurring events into virtual instances
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
        const search = req.query.search ? req.query.search.trim() : '';

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
        let searchFilter = '';
        const params = [organizationId, startDate, endDate];

        if (view === 'personal') {
            viewFilter = `AND ce.visibility = $${params.length + 1} AND ce.created_by = $${params.length + 2}`;
            params.push('personal', req.userId);
        } else if (view === 'team') {
            viewFilter = `AND ce.visibility = $${params.length + 1}`;
            params.push('team');
        }

        if (search) {
            searchFilter = `AND (ce.title ILIKE $${params.length + 1} OR ce.description ILIKE $${params.length + 1})`;
            params.push(`%${search}%`);
        }

        // For recurring events, we need events that START on or before the grid end
        // and whose recurrence potentially reaches into the grid range
        const result = await pool.query(
            `SELECT ce.*, CONCAT(u.first_name, ' ', u.last_name) as created_by_name
             FROM calendar_events ce
             LEFT JOIN users u ON ce.created_by = u.id
             WHERE ce.organization_id = $1
               AND (
                 (ce.recurrence_rule IS NULL AND ce.event_date >= $2::date AND ce.event_date <= $3::date)
                 OR
                 (ce.recurrence_rule IS NOT NULL AND ce.event_date <= $3::date
                  AND (ce.recurrence_end_date IS NULL OR ce.recurrence_end_date >= $2::date))
               )
               ${viewFilter}
               ${searchFilter}
             ORDER BY ce.all_day DESC, ce.event_time ASC NULLS LAST, ce.created_at ASC`,
            params
        );

        // Expand recurring events into instances
        const expanded = [];
        for (const event of result.rows) {
            if (event.recurrence_rule) {
                expanded.push(...expandRecurringEvent(event, startDate, endDate));
            } else {
                expanded.push(event);
            }
        }

        res.json(expanded);
    } catch (error) {
        console.error('Calendar events list error:', error);
        res.status(500).json({ error: 'Failed to load calendar events', detail: error.message });
    }
});

/**
 * POST /api/content-calendar
 * Create a new calendar event (supports recurrence_rule and recurrence_end_date)
 */
router.post('/', authenticate, async (req, res) => {
    try {
        const { title, description, event_date, event_time, end_time, all_day, color, visibility, recurrence_rule, recurrence_end_date } = req.body;
        if (!title || !event_date) {
            return res.status(400).json({ error: 'Title and date are required' });
        }

        const safeColor = VALID_COLORS.includes(color) ? color : 'blue';
        const safeVisibility = ['personal', 'team'].includes(visibility) ? visibility : 'personal';
        const isAllDay = all_day === true || all_day === 'true';
        const safeRecurrence = VALID_RECURRENCE.includes(recurrence_rule) ? recurrence_rule : null;

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            `INSERT INTO calendar_events (organization_id, title, description, event_date, event_time, end_time, all_day, color, visibility, created_by, recurrence_rule, recurrence_end_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [organizationId, title, description || null, event_date,
             isAllDay ? null : (event_time || null),
             isAllDay ? null : (end_time || null),
             isAllDay, safeColor, safeVisibility, req.userId,
             safeRecurrence, safeRecurrence ? (recurrence_end_date || null) : null]
        );

        // Re-fetch with creator name
        const full = await pool.query(
            `SELECT ce.*, CONCAT(u.first_name, ' ', u.last_name) as created_by_name FROM calendar_events ce LEFT JOIN users u ON ce.created_by = u.id WHERE ce.id = $1`,
            [result.rows[0].id]
        );

        res.json(full.rows[0]);
    } catch (error) {
        console.error('Calendar event create error:', error);
        res.status(500).json({ error: 'Failed to create calendar event', detail: error.message });
    }
});

/**
 * PUT /api/content-calendar/:id
 * Update a calendar event (only creator can edit)
 */
router.put('/:id', authenticate, async (req, res) => {
    try {
        const { title, description, event_date, event_time, end_time, all_day, color, visibility, recurrence_rule, recurrence_end_date } = req.body;

        const safeColor = color && VALID_COLORS.includes(color) ? color : undefined;
        const safeVisibility = visibility && ['personal', 'team'].includes(visibility) ? visibility : undefined;
        const isAllDay = all_day === true || all_day === 'true';
        const safeRecurrence = recurrence_rule === null ? null : (VALID_RECURRENCE.includes(recurrence_rule) ? recurrence_rule : undefined);

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
                 recurrence_rule = COALESCE($9, recurrence_rule),
                 recurrence_end_date = $10,
                 updated_at = NOW()
             WHERE id = $11 AND organization_id = $12
             RETURNING *`,
            [title, description, event_date,
             isAllDay ? null : (event_time || null),
             isAllDay ? null : (end_time || null),
             isAllDay,
             safeColor, safeVisibility,
             safeRecurrence, recurrence_end_date || null,
             req.params.id, organizationId]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Event not found' });

        const full = await pool.query(
            `SELECT ce.*, CONCAT(u.first_name, ' ', u.last_name) as created_by_name FROM calendar_events ce LEFT JOIN users u ON ce.created_by = u.id WHERE ce.id = $1`,
            [result.rows[0].id]
        );

        res.json(full.rows[0]);
    } catch (error) {
        console.error('Calendar event update error:', error);
        res.status(500).json({ error: 'Failed to update calendar event' });
    }
});

/**
 * PATCH /api/content-calendar/:id/move
 * Quick date change for drag-and-drop reschedule (only creator can move)
 */
router.patch('/:id/move', authenticate, async (req, res) => {
    try {
        const { event_date } = req.body;
        if (!event_date) {
            return res.status(400).json({ error: 'event_date is required' });
        }

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        const existing = await pool.query(
            'SELECT created_by, recurrence_rule FROM calendar_events WHERE id = $1 AND organization_id = $2',
            [req.params.id, organizationId]
        );
        if (existing.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
        if (existing.rows[0].created_by !== req.userId) {
            return res.status(403).json({ error: 'Only the event creator can move this event' });
        }

        const result = await pool.query(
            `UPDATE calendar_events SET event_date = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3 RETURNING *`,
            [event_date, req.params.id, organizationId]
        );

        const full = await pool.query(
            `SELECT ce.*, CONCAT(u.first_name, ' ', u.last_name) as created_by_name FROM calendar_events ce LEFT JOIN users u ON ce.created_by = u.id WHERE ce.id = $1`,
            [result.rows[0].id]
        );

        res.json(full.rows[0]);
    } catch (error) {
        console.error('Calendar event move error:', error);
        res.status(500).json({ error: 'Failed to move calendar event', detail: error.message });
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
