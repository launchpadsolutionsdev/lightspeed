/**
 * Organization Data Export Route
 * Full data export for PIPEDA compliance and org admin needs
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');
const auditLog = require('../services/auditLog');

/**
 * GET /api/organizations/:orgId/export
 * Export all organization data as a single JSON file.
 * Requires authenticated user who is a member of the org (admin/owner).
 */
router.get('/:orgId/export', authenticate, async (req, res) => {
    try {
        const { orgId } = req.params;

        // Verify user is admin/owner of this org
        const memberCheck = await pool.query(
            `SELECT role FROM organization_memberships WHERE user_id = $1 AND organization_id = $2`,
            [req.userId, orgId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Not a member of this organization' });
        }

        const role = memberCheck.rows[0].role;
        if (role !== 'owner' && role !== 'admin') {
            return res.status(403).json({ error: 'Only admins and owners can export data' });
        }

        // Fetch all org data in parallel
        const [
            orgResult,
            membersResult,
            kbResult,
            historyResult,
            templatesResult,
            contentTemplatesResult,
            drawSchedulesResult,
            favoritesResult,
            usageSummaryResult
        ] = await Promise.all([
            pool.query('SELECT * FROM organizations WHERE id = $1', [orgId]),
            pool.query(
                `SELECT u.id, u.email, u.first_name, u.last_name, om.role, om.created_at as joined_at
                 FROM users u
                 JOIN organization_memberships om ON u.id = om.user_id
                 WHERE om.organization_id = $1
                 ORDER BY om.created_at`,
                [orgId]
            ),
            pool.query(
                `SELECT id, title, content, category, tags, created_at, updated_at
                 FROM knowledge_base WHERE organization_id = $1
                 ORDER BY category, title`,
                [orgId]
            ),
            pool.query(
                `SELECT id, inquiry, response, format, tone, tool, rating, rating_feedback, created_at
                 FROM response_history WHERE organization_id = $1
                 ORDER BY created_at DESC LIMIT 10000`,
                [orgId]
            ),
            pool.query(
                `SELECT id, name, content, category, is_shared, created_at
                 FROM response_templates WHERE organization_id = $1
                 ORDER BY name`,
                [orgId]
            ),
            pool.query(
                `SELECT id, template_type, name, subject, headline, content, metadata, created_at
                 FROM content_templates WHERE organization_id = $1 AND is_active = TRUE
                 ORDER BY template_type, sort_order`,
                [orgId]
            ),
            pool.query(
                `SELECT id, draw_name, grand_prize_date, ticket_sales_start, ticket_sales_end,
                        guaranteed_prize, prize_description, early_birds, pricing, is_active, created_at
                 FROM draw_schedules WHERE organization_id = $1
                 ORDER BY grand_prize_date DESC`,
                [orgId]
            ),
            pool.query(
                `SELECT id, title, inquiry, response, created_at
                 FROM favorites WHERE organization_id = $1
                 ORDER BY created_at DESC`,
                [orgId]
            ),
            pool.query(
                `SELECT tool,
                        DATE_TRUNC('month', created_at) as month,
                        COUNT(*) as request_count,
                        COALESCE(SUM(total_tokens), 0) as total_tokens
                 FROM usage_logs WHERE organization_id = $1
                 GROUP BY tool, DATE_TRUNC('month', created_at)
                 ORDER BY month DESC, tool`,
                [orgId]
            )
        ]);

        const org = orgResult.rows[0];
        if (!org) {
            return res.status(404).json({ error: 'Organization not found' });
        }

        // Strip sensitive fields from org
        const { stripe_customer_id, stripe_subscription_id, ...safeOrg } = org;

        const exportData = {
            exported_at: new Date().toISOString(),
            exported_by: req.userId,
            organization: safeOrg,
            members: membersResult.rows,
            knowledge_base: kbResult.rows,
            response_history: {
                count: historyResult.rows.length,
                note: historyResult.rows.length >= 10000 ? 'Export capped at 10,000 most recent entries' : undefined,
                entries: historyResult.rows
            },
            response_templates: templatesResult.rows,
            content_templates: contentTemplatesResult.rows,
            draw_schedules: drawSchedulesResult.rows,
            favorites: favoritesResult.rows,
            usage_summary: usageSummaryResult.rows
        };

        // Audit log
        auditLog.logAction({
            orgId,
            userId: req.userId,
            action: 'ORG_DATA_EXPORTED',
            resourceType: 'ORGANIZATION',
            resourceId: orgId,
            changes: {
                kb_entries: kbResult.rows.length,
                history_entries: historyResult.rows.length,
                templates: templatesResult.rows.length
            },
            req
        });

        const slug = org.slug || 'org';
        const date = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Disposition', `attachment; filename="lightspeed-export-${slug}-${date}.json"`);
        res.setHeader('Content-Type', 'application/json');
        res.json(exportData);

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Failed to export organization data' });
    }
});

module.exports = router;
