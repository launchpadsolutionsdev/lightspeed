/**
 * Content Templates Routes
 * CRUD for per-org content templates + system template library
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/content-templates
 * Get content templates for user's organization
 * Query params: ?type=social (optional filter by template_type)
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;
        const { type } = req.query;

        let query = `SELECT * FROM content_templates
             WHERE organization_id = $1 AND is_active = TRUE`;
        const params = [organizationId];

        if (type) {
            query += ` AND template_type = $2`;
            params.push(type);
        }

        query += ` ORDER BY template_type, sort_order, name`;

        const result = await pool.query(query, params);

        res.json({ templates: result.rows });
    } catch (error) {
        console.error('Get content templates error:', error);
        res.status(500).json({ error: 'Failed to get content templates' });
    }
});

/**
 * GET /api/content-templates/library
 * Get system template library (templates with NULL organization_id)
 * These are available for any org to import
 */
router.get('/library', authenticate, async (req, res) => {
    try {
        const { type } = req.query;

        let query = `SELECT * FROM content_templates
             WHERE organization_id IS NULL AND is_active = TRUE`;
        const params = [];

        if (type) {
            query += ` AND template_type = $1`;
            params.push(type);
        }

        query += ` ORDER BY template_type, sort_order, name`;

        const result = await pool.query(query, params);

        res.json({ templates: result.rows });
    } catch (error) {
        console.error('Get template library error:', error);
        res.status(500).json({ error: 'Failed to get template library' });
    }
});

/**
 * POST /api/content-templates/import
 * Import system templates into org's template set
 * Body: { templateIds: [uuid, uuid, ...] }
 */
router.post('/import', authenticate, [
    body('templateIds').isArray({ min: 1 }).withMessage('templateIds must be a non-empty array')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;
        const { templateIds } = req.body;

        // Copy selected system templates to the org
        const result = await pool.query(
            `INSERT INTO content_templates (organization_id, template_type, name, subject, headline, content, metadata, sort_order, created_by)
             SELECT $1, template_type, name, subject, headline, content, metadata, sort_order, $2
             FROM content_templates
             WHERE id = ANY($3) AND organization_id IS NULL
             RETURNING *`,
            [organizationId, req.userId, templateIds]
        );

        res.status(201).json({
            message: `${result.rows.length} templates imported`,
            templates: result.rows
        });
    } catch (error) {
        console.error('Import templates error:', error);
        res.status(500).json({ error: 'Failed to import templates' });
    }
});

/**
 * POST /api/content-templates/import-all
 * Import all system templates for a given type (or all types)
 * Body: { type: 'social' } (optional - if omitted, imports all)
 */
router.post('/import-all', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;
        const { type } = req.body;

        let query = `INSERT INTO content_templates (organization_id, template_type, name, subject, headline, content, metadata, sort_order, created_by)
             SELECT $1, template_type, name, subject, headline, content, metadata, sort_order, $2
             FROM content_templates
             WHERE organization_id IS NULL`;
        const params = [organizationId, req.userId];

        if (type) {
            query += ` AND template_type = $3`;
            params.push(type);
        }

        query += ` RETURNING *`;

        const result = await pool.query(query, params);

        res.status(201).json({
            message: `${result.rows.length} templates imported`,
            templates: result.rows
        });
    } catch (error) {
        console.error('Import all templates error:', error);
        res.status(500).json({ error: 'Failed to import templates' });
    }
});

/**
 * POST /api/content-templates
 * Create a new content template for user's org
 */
router.post('/', authenticate, [
    body('templateType').notEmpty().withMessage('Template type required'),
    body('name').notEmpty().withMessage('Name required'),
    body('content').notEmpty().withMessage('Content required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;
        const { templateType, name, subject, headline, content, metadata } = req.body;

        const result = await pool.query(
            `INSERT INTO content_templates (organization_id, template_type, name, subject, headline, content, metadata, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [organizationId, templateType, name, subject || null, headline || null, content, metadata || '{}', req.userId]
        );

        res.status(201).json({ template: result.rows[0] });
    } catch (error) {
        console.error('Create content template error:', error);
        res.status(500).json({ error: 'Failed to create content template' });
    }
});

/**
 * PATCH /api/content-templates/:id
 * Update a content template
 */
router.patch('/:id', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;
        const { id } = req.params;
        const { name, subject, headline, content, metadata, isActive } = req.body;

        const fieldMap = {
            name: 'name',
            subject: 'subject',
            headline: 'headline',
            content: 'content',
            metadata: 'metadata',
            isActive: 'is_active'
        };

        const updates = ['updated_at = NOW()'];
        const values = [];
        let paramCount = 1;

        for (const [bodyKey, dbColumn] of Object.entries(fieldMap)) {
            if (req.body[bodyKey] !== undefined) {
                updates.push(`${dbColumn} = $${paramCount++}`);
                values.push(req.body[bodyKey]);
            }
        }

        if (values.length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }

        values.push(id, organizationId);
        const result = await pool.query(
            `UPDATE content_templates SET ${updates.join(', ')}
             WHERE id = $${paramCount++} AND organization_id = $${paramCount}
             RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Template not found' });
        }

        res.json({ template: result.rows[0] });
    } catch (error) {
        console.error('Update content template error:', error);
        res.status(500).json({ error: 'Failed to update content template' });
    }
});

/**
 * DELETE /api/content-templates/:id
 * Delete a content template
 */
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM content_templates WHERE id = $1 AND organization_id = $2 RETURNING id',
            [id, organizationId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Template not found' });
        }

        res.json({ message: 'Template deleted' });
    } catch (error) {
        console.error('Delete content template error:', error);
        res.status(500).json({ error: 'Failed to delete content template' });
    }
});

module.exports = router;
