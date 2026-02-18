/**
 * Shared Prompts & Team Activity Routes
 * Organization-wide prompt library and team collaboration features
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/shared-prompts
 * List organization's shared prompts
 * Query: ?category=general&sort=popular|recent
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const { category, sort = 'popular' } = req.query;

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        const organizationId = orgResult.rows[0]?.organization_id;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        let sql = `SELECT sp.*, u.first_name, u.last_name, u.picture
                    FROM shared_prompts sp
                    JOIN users u ON sp.user_id = u.id
                    WHERE sp.organization_id = $1`;
        const params = [organizationId];

        if (category) {
            sql += ` AND sp.category = $2`;
            params.push(category);
        }

        sql += sort === 'popular'
            ? ' ORDER BY sp.usage_count DESC, sp.created_at DESC'
            : ' ORDER BY sp.created_at DESC';

        const result = await pool.query(sql, params);
        res.json({ prompts: result.rows });
    } catch (error) {
        console.error('List shared prompts error:', error);
        res.status(500).json({ error: 'Failed to list shared prompts' });
    }
});

/**
 * POST /api/shared-prompts
 * Create a shared prompt
 */
router.post('/', authenticate, [
    body('title').notEmpty().withMessage('Title required'),
    body('prompt_text').notEmpty().withMessage('Prompt text required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { title, prompt_text, category = 'general' } = req.body;

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        const organizationId = orgResult.rows[0]?.organization_id;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const result = await pool.query(
            `INSERT INTO shared_prompts (organization_id, user_id, title, prompt_text, category, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
             RETURNING *`,
            [organizationId, req.userId, title, prompt_text, category]
        );

        res.status(201).json({ prompt: result.rows[0] });
    } catch (error) {
        console.error('Create shared prompt error:', error);
        res.status(500).json({ error: 'Failed to create shared prompt' });
    }
});

/**
 * POST /api/shared-prompts/:id/use
 * Increment usage count when a prompt is used
 */
router.post('/:id/use', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE shared_prompts SET usage_count = usage_count + 1, updated_at = NOW()
             WHERE id = $1 RETURNING usage_count`,
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Prompt not found' });
        }

        res.json({ usage_count: result.rows[0].usage_count });
    } catch (error) {
        console.error('Use shared prompt error:', error);
        res.status(500).json({ error: 'Failed to update usage' });
    }
});

/**
 * DELETE /api/shared-prompts/:id
 * Delete a shared prompt (only creator or admin)
 */
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id, role FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        const organizationId = orgResult.rows[0]?.organization_id;
        const role = orgResult.rows[0]?.role;

        // Allow deletion if user is creator or admin/owner
        let sql, params;
        if (role === 'owner' || role === 'admin') {
            sql = 'DELETE FROM shared_prompts WHERE id = $1 AND organization_id = $2 RETURNING id';
            params = [req.params.id, organizationId];
        } else {
            sql = 'DELETE FROM shared_prompts WHERE id = $1 AND organization_id = $2 AND user_id = $3 RETURNING id';
            params = [req.params.id, organizationId, req.userId];
        }

        const result = await pool.query(sql, params);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Prompt not found or no permission' });
        }

        res.json({ deleted: true });
    } catch (error) {
        console.error('Delete shared prompt error:', error);
        res.status(500).json({ error: 'Failed to delete shared prompt' });
    }
});

/**
 * GET /api/shared-prompts/team-activity
 * Get recent team activity (recent AI usage across the org)
 */
router.get('/team-activity', authenticate, async (req, res) => {
    try {
        const { limit = 20 } = req.query;

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        const organizationId = orgResult.rows[0]?.organization_id;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const result = await pool.query(
            `SELECT rh.id, rh.inquiry, rh.tool, rh.format, rh.tone, rh.rating, rh.created_at,
                    u.first_name, u.last_name, u.picture
             FROM response_history rh
             JOIN users u ON rh.user_id = u.id
             WHERE rh.organization_id = $1
             ORDER BY rh.created_at DESC
             LIMIT $2`,
            [organizationId, parseInt(limit)]
        );

        res.json({ activity: result.rows });
    } catch (error) {
        console.error('Team activity error:', error);
        res.status(500).json({ error: 'Failed to get team activity' });
    }
});

module.exports = router;
