/**
 * Content Calendar Routes
 * Google Calendar-style month/week view with drag-drop, recurring events, search,
 * categories, comments, reminders, and ICS import/export
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');
const log = require('../services/logger');

const VALID_COLORS = ['tomato', 'blue', 'green', 'cyan', 'purple', 'gray', 'orange', 'pink'];
const VALID_RECURRENCE = ['daily', 'weekly', 'monthly'];
const PRESET_CATEGORIES = ['Ad Launch', 'Social Post', 'Email Campaign', 'Deadline', 'Meeting', 'Draw', 'Other'];
const VALID_REMINDER_MINUTES = [15, 30, 60, 1440];

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
 * GET /api/content-calendar?year=2026&month=3&view=personal|team|all&search=keyword&category=...
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

        const firstOfMonth = new Date(year, month - 1, 1);
        const lastOfMonth = new Date(year, month, 0);
        const gridStart = new Date(firstOfMonth);
        gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay());
        const gridEnd = new Date(lastOfMonth);
        const remaining = 6 - lastOfMonth.getDay();
        gridEnd.setDate(gridEnd.getDate() + remaining);

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
        log.error('Calendar events list error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to load calendar events', detail: error.message });
    }
});

/**
 * POST /api/content-calendar
 */
router.post('/', authenticate, async (req, res) => {
    try {
        const { title, description, event_date, event_time, end_time, all_day, color, visibility, recurrence_rule, recurrence_end_date, category, reminder_minutes } = req.body;
        if (!title || !event_date) {
            return res.status(400).json({ error: 'Title and date are required' });
        }

        const safeColor = VALID_COLORS.includes(color) ? color : 'blue';
        const safeVisibility = ['personal', 'team'].includes(visibility) ? visibility : 'personal';
        const isAllDay = all_day === true || all_day === 'true';
        const safeRecurrence = VALID_RECURRENCE.includes(recurrence_rule) ? recurrence_rule : null;
        const safeCategory = category && category.trim().length > 0 ? category.trim().substring(0, 50) : null;
        const safeReminder = VALID_REMINDER_MINUTES.includes(Number(reminder_minutes)) ? Number(reminder_minutes) : null;

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            `INSERT INTO calendar_events (organization_id, title, description, event_date, event_time, end_time, all_day, color, visibility, created_by, recurrence_rule, recurrence_end_date, category, reminder_minutes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING *`,
            [organizationId, title, description || null, event_date,
             isAllDay ? null : (event_time || null),
             isAllDay ? null : (end_time || null),
             isAllDay, safeColor, safeVisibility, req.userId,
             safeRecurrence, safeRecurrence ? (recurrence_end_date || null) : null,
             safeCategory, safeReminder]
        );

        const full = await pool.query(
            `SELECT ce.*, CONCAT(u.first_name, ' ', u.last_name) as created_by_name FROM calendar_events ce LEFT JOIN users u ON ce.created_by = u.id WHERE ce.id = $1`,
            [result.rows[0].id]
        );

        res.json(full.rows[0]);
    } catch (error) {
        log.error('Calendar event create error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to create calendar event', detail: error.message });
    }
});

/**
 * PUT /api/content-calendar/:id
 */
router.put('/:id', authenticate, async (req, res) => {
    try {
        const { title, description, event_date, event_time, end_time, all_day, color, visibility, recurrence_rule, recurrence_end_date, category, reminder_minutes } = req.body;

        const safeColor = color && VALID_COLORS.includes(color) ? color : undefined;
        const safeVisibility = visibility && ['personal', 'team'].includes(visibility) ? visibility : undefined;
        const isAllDay = all_day === true || all_day === 'true';
        const safeRecurrence = recurrence_rule === null ? null : (VALID_RECURRENCE.includes(recurrence_rule) ? recurrence_rule : undefined);
        const safeCategory = category === null ? null : (category && category.trim().length > 0 ? category.trim().substring(0, 50) : undefined);
        const safeReminder = reminder_minutes === null ? null : (VALID_REMINDER_MINUTES.includes(Number(reminder_minutes)) ? Number(reminder_minutes) : undefined);

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
                 category = COALESCE($11, category),
                 reminder_minutes = COALESCE($12, reminder_minutes),
                 updated_at = NOW()
             WHERE id = $13 AND organization_id = $14
             RETURNING *`,
            [title, description, event_date,
             isAllDay ? null : (event_time || null),
             isAllDay ? null : (end_time || null),
             isAllDay,
             safeColor, safeVisibility,
             safeRecurrence, recurrence_end_date || null,
             safeCategory, safeReminder,
             req.params.id, organizationId]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Event not found' });

        const full = await pool.query(
            `SELECT ce.*, CONCAT(u.first_name, ' ', u.last_name) as created_by_name FROM calendar_events ce LEFT JOIN users u ON ce.created_by = u.id WHERE ce.id = $1`,
            [result.rows[0].id]
        );

        res.json(full.rows[0]);
    } catch (error) {
        log.error('Calendar event update error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to update calendar event' });
    }
});

/**
 * PATCH /api/content-calendar/:id/move
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
        log.error('Calendar event move error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to move calendar event', detail: error.message });
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
        log.error('Calendar event delete error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to delete calendar event' });
    }
});

// ==================== COMMENTS ====================

/**
 * GET /api/content-calendar/:id/comments
 */
router.get('/:id/comments', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.*, CONCAT(u.first_name, ' ', u.last_name) as author_name
             FROM calendar_event_comments c
             LEFT JOIN users u ON c.user_id = u.id
             WHERE c.event_id = $1
             ORDER BY c.created_at ASC`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (error) {
        log.error('Calendar comments fetch error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to load comments' });
    }
});

/**
 * POST /api/content-calendar/:id/comments
 */
router.post('/:id/comments', authenticate, async (req, res) => {
    try {
        const { content } = req.body;
        if (!content || !content.trim()) {
            return res.status(400).json({ error: 'Comment content is required' });
        }

        const result = await pool.query(
            `INSERT INTO calendar_event_comments (event_id, user_id, content)
             VALUES ($1, $2, $3) RETURNING *`,
            [req.params.id, req.userId, content.trim()]
        );

        const full = await pool.query(
            `SELECT c.*, CONCAT(u.first_name, ' ', u.last_name) as author_name
             FROM calendar_event_comments c
             LEFT JOIN users u ON c.user_id = u.id
             WHERE c.id = $1`,
            [result.rows[0].id]
        );

        res.json(full.rows[0]);
    } catch (error) {
        log.error('Calendar comment create error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

/**
 * DELETE /api/content-calendar/comments/:commentId
 */
router.delete('/comments/:commentId', authenticate, async (req, res) => {
    try {
        const existing = await pool.query(
            'SELECT user_id FROM calendar_event_comments WHERE id = $1',
            [req.params.commentId]
        );
        if (existing.rows.length === 0) return res.status(404).json({ error: 'Comment not found' });
        if (existing.rows[0].user_id !== req.userId) {
            return res.status(403).json({ error: 'Only the comment author can delete this comment' });
        }

        await pool.query('DELETE FROM calendar_event_comments WHERE id = $1', [req.params.commentId]);
        res.json({ success: true });
    } catch (error) {
        log.error('Calendar comment delete error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

// ==================== NOTIFICATIONS ====================

/**
 * GET /api/content-calendar/notifications
 */
router.get('/notifications/list', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT n.*, ce.title as event_title, ce.event_date, ce.event_time
             FROM calendar_notifications n
             LEFT JOIN calendar_events ce ON n.event_id = ce.id
             WHERE n.user_id = $1
             ORDER BY n.created_at DESC
             LIMIT 20`,
            [req.userId]
        );
        res.json(result.rows);
    } catch (error) {
        log.error('Notifications fetch error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to load notifications' });
    }
});

/**
 * GET /api/content-calendar/notifications/unread-count
 */
router.get('/notifications/unread-count', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT COUNT(*) as count FROM calendar_notifications WHERE user_id = $1 AND read = false',
            [req.userId]
        );
        res.json({ count: parseInt(result.rows[0].count) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get unread count' });
    }
});

/**
 * PATCH /api/content-calendar/notifications/:id/read
 */
router.patch('/notifications/:id/read', authenticate, async (req, res) => {
    try {
        await pool.query(
            'UPDATE calendar_notifications SET read = true WHERE id = $1 AND user_id = $2',
            [req.params.id, req.userId]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
});

/**
 * POST /api/content-calendar/notifications/mark-all-read
 */
router.post('/notifications/mark-all-read', authenticate, async (req, res) => {
    try {
        await pool.query(
            'UPDATE calendar_notifications SET read = true WHERE user_id = $1 AND read = false',
            [req.userId]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark all as read' });
    }
});

// ==================== REMINDER CHECK (called by server interval) ====================

/**
 * Check for events with reminders due and create notifications
 */
async function checkReminders() {
    try {
        const now = new Date();
        // Look for events with reminders in the next minute window
        const result = await pool.query(
            `SELECT ce.*, CONCAT(u.first_name, ' ', u.last_name) as created_by_name
             FROM calendar_events ce
             LEFT JOIN users u ON ce.created_by = u.id
             WHERE ce.reminder_minutes IS NOT NULL
               AND ce.event_date >= CURRENT_DATE
               AND ce.event_time IS NOT NULL`
        );

        for (const event of result.rows) {
            const eventDateTime = new Date(`${event.event_date.toISOString().split('T')[0]}T${event.event_time}`);
            const reminderTime = new Date(eventDateTime.getTime() - event.reminder_minutes * 60 * 1000);

            // Check if reminder is due within the last 60 seconds
            const diff = now.getTime() - reminderTime.getTime();
            if (diff >= 0 && diff < 60000) {
                // Check if notification already exists
                const existing = await pool.query(
                    `SELECT id FROM calendar_notifications
                     WHERE event_id = $1 AND user_id = $2
                       AND created_at > NOW() - INTERVAL '2 minutes'`,
                    [event.id, event.created_by]
                );

                if (existing.rows.length === 0) {
                    const timeLabel = event.reminder_minutes >= 1440
                        ? `${event.reminder_minutes / 1440} day(s)`
                        : event.reminder_minutes >= 60
                            ? `${event.reminder_minutes / 60} hour(s)`
                            : `${event.reminder_minutes} minutes`;

                    await pool.query(
                        `INSERT INTO calendar_notifications (user_id, event_id, message)
                         VALUES ($1, $2, $3)`,
                        [event.created_by, event.id, `Reminder: "${event.title}" starts in ${timeLabel}`]
                    );

                    // Try sending email reminder
                    try {
                        const { sendEmail } = require('../services/email');
                        const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [event.created_by]);
                        if (userResult.rows.length > 0 && userResult.rows[0].email) {
                            await sendEmail({
                                to: userResult.rows[0].email,
                                subject: `Reminder: ${event.title}`,
                                html: `<p>Your event "<strong>${event.title}</strong>" starts in ${timeLabel}.</p>
                                       <p>Date: ${event.event_date.toISOString().split('T')[0]}<br>Time: ${event.event_time}</p>`
                            });
                        }
                    } catch (emailErr) {
                        // Email sending is best-effort
                        log.info('Reminder email skipped', { error: emailErr.message });
                    }
                }
            }
        }
    } catch (error) {
        log.error('Reminder check error', { error: error.message || error });
    }
}

// ==================== ICS EXPORT ====================

/**
 * GET /api/content-calendar/export?scope=month|all&year=2026&month=3
 */
router.get('/export/ics', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        const scope = req.query.scope || 'month';
        let query, params;

        if (scope === 'all') {
            query = `SELECT * FROM calendar_events WHERE organization_id = $1 AND created_by = $2 ORDER BY event_date`;
            params = [organizationId, req.userId];
        } else {
            const year = parseInt(req.query.year) || new Date().getFullYear();
            const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const endDate = new Date(year, month, 0).toISOString().split('T')[0];
            query = `SELECT * FROM calendar_events WHERE organization_id = $1 AND event_date >= $2::date AND event_date <= $3::date ORDER BY event_date`;
            params = [organizationId, startDate, endDate];
        }

        const result = await pool.query(query, params);

        // Build ICS file
        let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Lightspeed//Runway//EN\r\nCALSCALE:GREGORIAN\r\n';

        for (const ev of result.rows) {
            const dateStr = ev.event_date.toISOString().split('T')[0].replace(/-/g, '');
            ics += 'BEGIN:VEVENT\r\n';
            ics += `UID:${ev.id}@lightspeed\r\n`;
            ics += `SUMMARY:${escapeICS(ev.title)}\r\n`;

            if (ev.description) {
                ics += `DESCRIPTION:${escapeICS(ev.description)}\r\n`;
            }

            if (ev.all_day) {
                ics += `DTSTART;VALUE=DATE:${dateStr}\r\n`;
                // All-day events end the next day in ICS
                const nextDay = new Date(ev.event_date);
                nextDay.setDate(nextDay.getDate() + 1);
                ics += `DTEND;VALUE=DATE:${nextDay.toISOString().split('T')[0].replace(/-/g, '')}\r\n`;
            } else {
                const time = ev.event_time ? ev.event_time.replace(/:/g, '').substring(0, 4) + '00' : '000000';
                ics += `DTSTART:${dateStr}T${time}\r\n`;
                if (ev.end_time) {
                    const endTime = ev.end_time.replace(/:/g, '').substring(0, 4) + '00';
                    ics += `DTEND:${dateStr}T${endTime}\r\n`;
                }
            }

            if (ev.category) {
                ics += `CATEGORIES:${escapeICS(ev.category)}\r\n`;
            }

            ics += `CREATED:${formatICSDate(ev.created_at)}\r\n`;
            ics += 'END:VEVENT\r\n';
        }

        ics += 'END:VCALENDAR\r\n';

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="runway-calendar.ics"');
        res.send(ics);
    } catch (error) {
        log.error('Calendar export error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to export calendar' });
    }
});

function escapeICS(str) {
    return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function formatICSDate(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// ==================== ICS IMPORT ====================

/**
 * POST /api/content-calendar/import
 * Body: { icsContent: string }
 */
router.post('/import/ics', authenticate, async (req, res) => {
    try {
        const { icsContent } = req.body;
        if (!icsContent) {
            return res.status(400).json({ error: 'ICS content is required' });
        }

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        if (orgResult.rows.length === 0) return res.status(400).json({ error: 'No organization found' });
        const organizationId = orgResult.rows[0].organization_id;

        // Parse ICS
        const events = parseICS(icsContent);
        if (events.length === 0) {
            return res.status(400).json({ error: 'No valid events found in the file' });
        }

        let imported = 0;
        for (const ev of events) {
            try {
                await pool.query(
                    `INSERT INTO calendar_events (organization_id, title, description, event_date, event_time, end_time, all_day, color, visibility, created_by, category)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [organizationId, ev.title, ev.description || null, ev.date,
                     ev.allDay ? null : (ev.startTime || null),
                     ev.allDay ? null : (ev.endTime || null),
                     ev.allDay, 'blue', 'personal', req.userId,
                     ev.category || null]
                );
                imported++;
            } catch (insertErr) {
                log.error('Failed to import event', { title: ev.title, error: insertErr.message });
            }
        }

        res.json({ success: true, imported, total: events.length });
    } catch (error) {
        log.error('Calendar import error', { error: error.message || error });
        res.status(500).json({ error: 'Failed to import calendar' });
    }
});

function parseICS(content) {
    const events = [];
    const lines = content.replace(/\r\n /g, '').replace(/\r\n\t/g, '').split(/\r?\n/);

    let inEvent = false;
    let current = {};

    for (const line of lines) {
        if (line === 'BEGIN:VEVENT') {
            inEvent = true;
            current = {};
        } else if (line === 'END:VEVENT') {
            inEvent = false;
            if (current.title && current.date) {
                events.push(current);
            }
        } else if (inEvent) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) continue;
            const key = line.substring(0, colonIdx);
            const value = line.substring(colonIdx + 1);

            if (key === 'SUMMARY') {
                current.title = unescapeICS(value);
            } else if (key === 'DESCRIPTION') {
                current.description = unescapeICS(value);
            } else if (key === 'CATEGORIES') {
                current.category = unescapeICS(value);
            } else if (key === 'DTSTART' || key === 'DTSTART;VALUE=DATE') {
                if (value.length === 8) {
                    // Date only — all-day
                    current.date = `${value.substring(0, 4)}-${value.substring(4, 6)}-${value.substring(6, 8)}`;
                    current.allDay = true;
                } else {
                    // DateTime
                    current.date = `${value.substring(0, 4)}-${value.substring(4, 6)}-${value.substring(6, 8)}`;
                    if (value.length >= 15) {
                        current.startTime = `${value.substring(9, 11)}:${value.substring(11, 13)}`;
                    }
                    current.allDay = false;
                }
            } else if (key === 'DTEND' || key === 'DTEND;VALUE=DATE') {
                if (value.length >= 15) {
                    current.endTime = `${value.substring(9, 11)}:${value.substring(11, 13)}`;
                }
            }
        }
    }

    return events;
}

function unescapeICS(str) {
    return str.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// Export the reminder checker for use in server startup
router.checkReminders = checkReminders;

module.exports = router;
