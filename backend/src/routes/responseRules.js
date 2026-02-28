/**
 * Response Rules Routes
 * CRUD operations for persistent org-level AI instructions
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');
const auditLog = require('../services/auditLog');

/**
 * GET /api/response-rules
 * List all response rules for the user's organization, sorted by sort_order.
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const result = await pool.query(
            `SELECT id, rule_text, rule_type, is_active, sort_order, created_by, created_at, updated_at
             FROM response_rules
             WHERE organization_id = $1
             ORDER BY sort_order, created_at`,
            [organizationId]
        );

        res.json({ rules: result.rows });

    } catch (error) {
        console.error('Get response rules error:', error);
        res.status(500).json({ error: 'Failed to get response rules' });
    }
});

/**
 * POST /api/response-rules
 * Create a new response rule.
 */
router.post('/', authenticate, [
    body('rule_text').notEmpty().withMessage('Rule text is required'),
    body('rule_type').optional().isIn(['always', 'never', 'formatting', 'general'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const { rule_text, rule_type = 'general' } = req.body;

        // Set sort_order to max + 1 so new rules go to the end
        const maxOrder = await pool.query(
            `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
             FROM response_rules WHERE organization_id = $1`,
            [organizationId]
        );

        const result = await pool.query(
            `INSERT INTO response_rules (organization_id, rule_text, rule_type, sort_order, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [organizationId, rule_text, rule_type, maxOrder.rows[0].next_order, req.userId]
        );

        auditLog.logAction({
            orgId: organizationId, userId: req.userId,
            action: 'RESPONSE_RULE_CREATED', resourceType: 'RESPONSE_RULE',
            resourceId: result.rows[0].id,
            changes: { rule_type, rule_text: rule_text.substring(0, 100) },
            req
        });

        res.status(201).json({ rule: result.rows[0] });

    } catch (error) {
        console.error('Create response rule error:', error);
        res.status(500).json({ error: 'Failed to create response rule' });
    }
});

/**
 * PUT /api/response-rules/reorder
 * Bulk update sort_order for all rules. Body: { order: [id1, id2, id3, ...] }
 * NOTE: This route MUST be registered before /:id to avoid matching "reorder" as a UUID.
 */
router.put('/reorder', authenticate, async (req, res) => {
    try {
        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const { order } = req.body;
        if (!Array.isArray(order) || order.length === 0) {
            return res.status(400).json({ error: 'Order array required' });
        }

        // Update each rule's sort_order in a single transaction
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (let i = 0; i < order.length; i++) {
                await client.query(
                    `UPDATE response_rules SET sort_order = $1, updated_at = NOW()
                     WHERE id = $2 AND organization_id = $3`,
                    [i + 1, order[i], organizationId]
                );
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        res.json({ message: 'Order updated' });

    } catch (error) {
        console.error('Reorder response rules error:', error);
        res.status(500).json({ error: 'Failed to reorder rules' });
    }
});

/**
 * PUT /api/response-rules/:id
 * Update a rule's text, type, or active status.
 */
router.put('/:id', authenticate, [
    body('rule_text').optional().notEmpty().withMessage('Rule text cannot be empty'),
    body('rule_type').optional().isIn(['always', 'never', 'formatting', 'general']),
    body('is_active').optional().isBoolean()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const { id } = req.params;
        const { rule_text, rule_type, is_active } = req.body;

        // Build dynamic SET clause
        const sets = [];
        const values = [];
        let paramIndex = 1;

        if (rule_text !== undefined) {
            sets.push(`rule_text = $${paramIndex++}`);
            values.push(rule_text);
        }
        if (rule_type !== undefined) {
            sets.push(`rule_type = $${paramIndex++}`);
            values.push(rule_type);
        }
        if (is_active !== undefined) {
            sets.push(`is_active = $${paramIndex++}`);
            values.push(is_active);
        }

        if (sets.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        sets.push('updated_at = NOW()');
        values.push(id, organizationId);

        const result = await pool.query(
            `UPDATE response_rules SET ${sets.join(', ')}
             WHERE id = $${paramIndex++} AND organization_id = $${paramIndex}
             RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Rule not found' });
        }

        auditLog.logAction({
            orgId: organizationId, userId: req.userId,
            action: 'RESPONSE_RULE_UPDATED', resourceType: 'RESPONSE_RULE',
            resourceId: id,
            changes: { rule_text: rule_text?.substring(0, 100), rule_type, is_active },
            req
        });

        res.json({ rule: result.rows[0] });

    } catch (error) {
        console.error('Update response rule error:', error);
        res.status(500).json({ error: 'Failed to update rule' });
    }
});

/**
 * DELETE /api/response-rules/:id
 * Delete a response rule.
 */
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const { id } = req.params;

        const result = await pool.query(
            `DELETE FROM response_rules WHERE id = $1 AND organization_id = $2 RETURNING id, rule_text`,
            [id, organizationId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Rule not found' });
        }

        auditLog.logAction({
            orgId: organizationId, userId: req.userId,
            action: 'RESPONSE_RULE_DELETED', resourceType: 'RESPONSE_RULE',
            resourceId: id,
            changes: { rule_text: result.rows[0].rule_text?.substring(0, 100) },
            req
        });

        res.json({ message: 'Rule deleted' });

    } catch (error) {
        console.error('Delete response rule error:', error);
        res.status(500).json({ error: 'Failed to delete rule' });
    }
});

module.exports = router;
