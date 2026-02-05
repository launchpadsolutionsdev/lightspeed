/**
 * Response History Routes
 * Save responses, rate them, and retrieve rated examples for AI learning
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

/**
 * POST /api/response-history
 * Save a generated response to history
 */
router.post('/', authenticate, async (req, res) => {
    try {
        const { inquiry, response, format, tone } = req.body;

        if (!inquiry || !response) {
            return res.status(400).json({ error: 'Inquiry and response required' });
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
            `INSERT INTO response_history (organization_id, user_id, inquiry, response, format, tone, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             RETURNING *`,
            [organizationId, req.userId, inquiry, response, format || 'email', tone || 'balanced']
        );

        res.status(201).json({ entry: result.rows[0] });

    } catch (error) {
        console.error('Save response history error:', error);
        res.status(500).json({ error: 'Failed to save response' });
    }
});

/**
 * POST /api/response-history/:id/rate
 * Rate a response (thumbs up/down) with optional feedback
 */
router.post('/:id/rate', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { rating, feedback } = req.body;

        if (!rating || !['positive', 'negative'].includes(rating)) {
            return res.status(400).json({ error: 'Rating must be "positive" or "negative"' });
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
            `UPDATE response_history
             SET rating = $1, rating_feedback = $2, rating_at = NOW()
             WHERE id = $3 AND organization_id = $4
             RETURNING *`,
            [rating, feedback || null, id, organizationId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Response not found' });
        }

        res.json({ entry: result.rows[0] });

    } catch (error) {
        console.error('Rate response error:', error);
        res.status(500).json({ error: 'Failed to rate response' });
    }
});

/**
 * GET /api/response-history/rated-examples
 * Get rated examples for AI prompt injection (learning)
 * Returns recent positive and negative examples for the organization
 */
router.get('/rated-examples', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        // Get most recent positive examples (good responses to emulate)
        const positiveResult = await pool.query(
            `SELECT inquiry, response, format, tone
             FROM response_history
             WHERE organization_id = $1 AND rating = 'positive'
             ORDER BY rating_at DESC
             LIMIT 5`,
            [organizationId]
        );

        // Get most recent negative examples with feedback (mistakes to avoid)
        const negativeResult = await pool.query(
            `SELECT inquiry, response, rating_feedback, format, tone
             FROM response_history
             WHERE organization_id = $1 AND rating = 'negative'
             ORDER BY rating_at DESC
             LIMIT 3`,
            [organizationId]
        );

        res.json({
            positive: positiveResult.rows,
            negative: negativeResult.rows
        });

    } catch (error) {
        console.error('Get rated examples error:', error);
        res.status(500).json({ error: 'Failed to get rated examples' });
    }
});

module.exports = router;
