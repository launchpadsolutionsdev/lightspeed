/**
 * Organization Data Export & Deletion Routes
 * Full data export and deletion for PIPEDA/GDPR compliance
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');
const auditLog = require('../services/auditLog');
const log = require('../services/logger');
const { toCSV } = require('../services/csvExport');

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
        log.error('Export error', { error, orgId: req.params.orgId });
        res.status(500).json({ error: 'Failed to export organization data' });
    }
});

/**
 * DELETE /api/organizations/:orgId/data
 * Permanently delete all organization data (PIPEDA/GDPR right to erasure).
 * Owner-only. Cancels Stripe subscription if active, then deletes the
 * organization row — all related data cascades via ON DELETE CASCADE.
 *
 * Requires confirmation: body must include { confirm: "DELETE" }
 */
router.delete('/:orgId/data', authenticate, async (req, res) => {
    try {
        const { orgId } = req.params;
        const { confirm } = req.body;

        if (confirm !== 'DELETE') {
            return res.status(400).json({
                error: 'Deletion requires confirmation. Send { "confirm": "DELETE" } in the request body.'
            });
        }

        // Verify user is owner of this org
        const memberCheck = await pool.query(
            `SELECT role FROM organization_memberships WHERE user_id = $1 AND organization_id = $2`,
            [req.userId, orgId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Not a member of this organization' });
        }

        if (memberCheck.rows[0].role !== 'owner') {
            return res.status(403).json({ error: 'Only organization owners can delete organization data' });
        }

        // Get org details for Stripe cleanup and audit
        const orgResult = await pool.query(
            'SELECT name, stripe_subscription_id, stripe_customer_id FROM organizations WHERE id = $1',
            [orgId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(404).json({ error: 'Organization not found' });
        }

        const org = orgResult.rows[0];

        // Cancel Stripe subscription if active
        if (org.stripe_subscription_id) {
            try {
                const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                await stripe.subscriptions.cancel(org.stripe_subscription_id);
            } catch (stripeErr) {
                log.warn('Stripe subscription cancellation failed (may already be cancelled)', { error: stripeErr.message });
            }
        }

        // Log before deletion (audit_logs has org_id but no FK cascade, so it persists)
        auditLog.logAction({
            orgId,
            userId: req.userId,
            action: 'ORG_DATA_DELETED',
            resourceType: 'ORGANIZATION',
            resourceId: orgId,
            changes: { organization_name: org.name },
            req
        });

        // Delete the organization — ON DELETE CASCADE removes:
        // organization_memberships, knowledge_base, response_history,
        // usage_logs, favorites, response_templates, content_templates,
        // organization_invitations, response_rules,
        // shopify_stores (and nested shopify tables)
        await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);

        res.json({
            message: 'Organization and all associated data have been permanently deleted.',
            deleted_organization: org.name
        });

    } catch (error) {
        log.error('Data deletion error', { error, orgId: req.params.orgId });
        res.status(500).json({ error: 'Failed to delete organization data' });
    }
});

/**
 * DELETE /api/organizations/:orgId/user-data
 * Delete a specific user's personal data from the organization (PIPEDA/GDPR).
 * The user can request deletion of their own data, or an owner can delete
 * any member's data. Anonymizes response history rather than deleting it
 * (preserves org analytics while removing PII).
 */
router.delete('/:orgId/user-data', authenticate, async (req, res) => {
    try {
        const { orgId } = req.params;
        const targetUserId = req.body.userId || req.userId;

        // Users can delete their own data; owners can delete any member's data
        if (targetUserId !== req.userId) {
            const memberCheck = await pool.query(
                `SELECT role FROM organization_memberships WHERE user_id = $1 AND organization_id = $2`,
                [req.userId, orgId]
            );
            if (memberCheck.rows.length === 0 || memberCheck.rows[0].role !== 'owner') {
                return res.status(403).json({ error: 'Only owners can delete other users\' data' });
            }
        }

        // Verify target user is a member
        const targetCheck = await pool.query(
            `SELECT role FROM organization_memberships WHERE user_id = $1 AND organization_id = $2`,
            [targetUserId, orgId]
        );
        if (targetCheck.rows.length === 0) {
            return res.status(404).json({ error: 'User is not a member of this organization' });
        }

        // Anonymize response history (set user_id to NULL, preserve org data)
        const anonResult = await pool.query(
            `UPDATE response_history SET user_id = NULL WHERE user_id = $1 AND organization_id = $2`,
            [targetUserId, orgId]
        );

        // Delete user's favorites
        await pool.query(
            `DELETE FROM favorites WHERE user_id = $1 AND organization_id = $2`,
            [targetUserId, orgId]
        );

        // Remove org membership
        await pool.query(
            `DELETE FROM organization_memberships WHERE user_id = $1 AND organization_id = $2`,
            [targetUserId, orgId]
        );

        auditLog.logAction({
            orgId,
            userId: req.userId,
            action: 'USER_DATA_DELETED',
            resourceType: 'USER',
            resourceId: targetUserId,
            changes: { responses_anonymized: anonResult.rowCount },
            req
        });

        res.json({
            message: 'User data has been deleted and response history anonymized.',
            responses_anonymized: anonResult.rowCount
        });

    } catch (error) {
        log.error('User data deletion error', { error, orgId: req.params.orgId });
        res.status(500).json({ error: 'Failed to delete user data' });
    }
});

module.exports = router;
