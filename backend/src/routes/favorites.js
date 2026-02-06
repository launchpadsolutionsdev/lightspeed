/**
 * Favorites Routes
 * CRUD for saved response templates
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/favorites
 * Get all favorites for user
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

        const result = await pool.query(
            `SELECT * FROM favorites
             WHERE organization_id = $1 AND user_id = $2
             ORDER BY created_at DESC`,
            [organizationId, req.userId]
        );

        res.json({ entries: result.rows });

    } catch (error) {
        console.error('Get favorites error:', error);
        res.status(500).json({ error: 'Failed to get favorites' });
    }
});

/**
 * POST /api/favorites
 * Save a new favorite
 */
router.post('/', authenticate, async (req, res) => {
    try {
        const { title, inquiry, response } = req.body;

        if (!title || !response) {
            return res.status(400).json({ error: 'Title and response required' });
        }

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        const result = await pool.query(
            `INSERT INTO favorites (organization_id, user_id, title, inquiry, response, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             RETURNING *`,
            [organizationId, req.userId, title, inquiry || '', response]
        );

        res.status(201).json({ entry: result.rows[0] });

    } catch (error) {
        console.error('Save favorite error:', error);
        res.status(500).json({ error: 'Failed to save favorite' });
    }
});

/**
 * DELETE /api/favorites/:id
 * Delete a favorite
 */
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM favorites WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Favorite not found' });
        }

        res.json({ message: 'Favorite deleted' });

    } catch (error) {
        console.error('Delete favorite error:', error);
        res.status(500).json({ error: 'Failed to delete favorite' });
    }
});

module.exports = router;
