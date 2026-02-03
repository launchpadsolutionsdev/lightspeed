/**
 * Knowledge Base Routes
 * CRUD operations for custom knowledge entries
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/knowledge-base
 * Get all knowledge entries for user's organization
 */
router.get('/', authenticate, async (req, res) => {
    try {
        // Get user's organization
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            `SELECT * FROM knowledge_base
             WHERE organization_id = $1
             ORDER BY category, title`,
            [organizationId]
        );

        res.json({ entries: result.rows });

    } catch (error) {
        console.error('Get knowledge base error:', error);
        res.status(500).json({ error: 'Failed to get knowledge base' });
    }
});

/**
 * GET /api/knowledge-base/search
 * Search knowledge entries
 */
router.get('/search', authenticate, async (req, res) => {
    try {
        const { q, category } = req.query;

        // Get user's organization
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        let query = `SELECT * FROM knowledge_base WHERE organization_id = $1`;
        const params = [organizationId];
        let paramCount = 2;

        if (q) {
            query += ` AND (title ILIKE $${paramCount} OR content ILIKE $${paramCount})`;
            params.push(`%${q}%`);
            paramCount++;
        }

        if (category && category !== 'all') {
            query += ` AND category = $${paramCount}`;
            params.push(category);
        }

        query += ` ORDER BY category, title`;

        const result = await pool.query(query, params);

        res.json({ entries: result.rows });

    } catch (error) {
        console.error('Search knowledge base error:', error);
        res.status(500).json({ error: 'Failed to search knowledge base' });
    }
});

/**
 * POST /api/knowledge-base
 * Create new knowledge entry
 */
router.post('/', authenticate, [
    body('title').notEmpty().withMessage('Title required'),
    body('content').notEmpty().withMessage('Content required'),
    body('category').isIn(['products', 'policies', 'faqs', 'other']).withMessage('Valid category required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { title, content, category, tags } = req.body;

        // Get user's organization
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;
        const entryId = uuidv4();

        const result = await pool.query(
            `INSERT INTO knowledge_base (id, organization_id, title, content, category, tags, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
             RETURNING *`,
            [entryId, organizationId, title, content, category, tags || [], req.userId]
        );

        res.status(201).json({ entry: result.rows[0] });

    } catch (error) {
        console.error('Create knowledge entry error:', error);
        res.status(500).json({ error: 'Failed to create entry' });
    }
});

/**
 * GET /api/knowledge-base/:id
 * Get single knowledge entry
 */
router.get('/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        // Get user's organization
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            'SELECT * FROM knowledge_base WHERE id = $1 AND organization_id = $2',
            [id, organizationId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Entry not found' });
        }

        res.json({ entry: result.rows[0] });

    } catch (error) {
        console.error('Get knowledge entry error:', error);
        res.status(500).json({ error: 'Failed to get entry' });
    }
});

/**
 * PUT /api/knowledge-base/:id
 * Update knowledge entry
 */
router.put('/:id', authenticate, [
    body('title').optional().notEmpty().withMessage('Title cannot be empty'),
    body('content').optional().notEmpty().withMessage('Content cannot be empty'),
    body('category').optional().isIn(['products', 'policies', 'faqs', 'other']).withMessage('Valid category required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { id } = req.params;
        const { title, content, category, tags } = req.body;

        // Get user's organization
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        // Build update query
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (title !== undefined) {
            updates.push(`title = $${paramCount++}`);
            values.push(title);
        }
        if (content !== undefined) {
            updates.push(`content = $${paramCount++}`);
            values.push(content);
        }
        if (category !== undefined) {
            updates.push(`category = $${paramCount++}`);
            values.push(category);
        }
        if (tags !== undefined) {
            updates.push(`tags = $${paramCount++}`);
            values.push(tags);
        }

        updates.push(`updated_at = NOW()`);

        values.push(id, organizationId);

        const result = await pool.query(
            `UPDATE knowledge_base SET ${updates.join(', ')}
             WHERE id = $${paramCount++} AND organization_id = $${paramCount}
             RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Entry not found' });
        }

        res.json({ entry: result.rows[0] });

    } catch (error) {
        console.error('Update knowledge entry error:', error);
        res.status(500).json({ error: 'Failed to update entry' });
    }
});

/**
 * DELETE /api/knowledge-base/:id
 * Delete knowledge entry
 */
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        // Get user's organization
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            'DELETE FROM knowledge_base WHERE id = $1 AND organization_id = $2 RETURNING id',
            [id, organizationId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Entry not found' });
        }

        res.json({ message: 'Entry deleted' });

    } catch (error) {
        console.error('Delete knowledge entry error:', error);
        res.status(500).json({ error: 'Failed to delete entry' });
    }
});

/**
 * POST /api/knowledge-base/import
 * Import multiple knowledge entries
 */
router.post('/import', authenticate, async (req, res) => {
    try {
        const { entries } = req.body;

        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ error: 'Entries array required' });
        }

        // Get user's organization
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        const imported = [];
        const errors = [];

        for (const entry of entries) {
            try {
                if (!entry.title || !entry.content || !entry.category) {
                    errors.push({ entry, error: 'Missing required fields' });
                    continue;
                }

                const entryId = uuidv4();
                const result = await pool.query(
                    `INSERT INTO knowledge_base (id, organization_id, title, content, category, tags, created_by, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                     RETURNING *`,
                    [entryId, organizationId, entry.title, entry.content, entry.category, entry.tags || [], req.userId]
                );
                imported.push(result.rows[0]);
            } catch (err) {
                errors.push({ entry, error: err.message });
            }
        }

        res.json({
            imported: imported.length,
            errors: errors.length,
            details: { imported, errors }
        });

    } catch (error) {
        console.error('Import knowledge base error:', error);
        res.status(500).json({ error: 'Failed to import entries' });
    }
});

/**
 * GET /api/knowledge-base/export
 * Export all knowledge entries
 */
router.get('/export/all', authenticate, async (req, res) => {
    try {
        // Get user's organization
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            `SELECT title, content, category, tags
             FROM knowledge_base
             WHERE organization_id = $1
             ORDER BY category, title`,
            [organizationId]
        );

        res.json({ entries: result.rows });

    } catch (error) {
        console.error('Export knowledge base error:', error);
        res.status(500).json({ error: 'Failed to export entries' });
    }
});

module.exports = router;
