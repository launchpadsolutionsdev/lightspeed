/**
 * Response History Routes
 * Save responses, rate them, and retrieve rated examples for AI learning
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/response-history
 * Get all response history for the organization (team-wide)
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
            `SELECT rh.*, u.first_name, u.last_name, u.email
             FROM response_history rh
             LEFT JOIN users u ON rh.user_id = u.id
             WHERE rh.organization_id = $1
             ORDER BY rh.created_at DESC
             LIMIT 500`,
            [organizationId]
        );

        res.json({ entries: result.rows });

    } catch (error) {
        console.error('Get response history error:', error);
        res.status(500).json({ error: 'Failed to get response history' });
    }
});

/**
 * GET /api/response-history/stats
 * Get aggregated analytics for the organization
 */
router.get('/stats', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );

        if (orgResult.rows.length === 0) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const organizationId = orgResult.rows[0].organization_id;

        // Total responses
        const totalResult = await pool.query(
            'SELECT COUNT(*) as total FROM response_history WHERE organization_id = $1',
            [organizationId]
        );

        // Today's responses
        const todayResult = await pool.query(
            `SELECT COUNT(*) as today FROM response_history
             WHERE organization_id = $1 AND created_at >= CURRENT_DATE`,
            [organizationId]
        );

        // Rating stats
        const ratingResult = await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE rating IS NOT NULL) as rated,
                COUNT(*) FILTER (WHERE rating = 'positive') as positive,
                COUNT(*) FILTER (WHERE rating = 'negative') as negative
             FROM response_history WHERE organization_id = $1`,
            [organizationId]
        );

        // Leaderboard (responses per user)
        const leaderboardResult = await pool.query(
            `SELECT u.first_name, u.last_name, u.email, COUNT(rh.id) as count
             FROM response_history rh
             JOIN users u ON rh.user_id = u.id
             WHERE rh.organization_id = $1
             GROUP BY u.id, u.first_name, u.last_name, u.email
             ORDER BY count DESC
             LIMIT 10`,
            [organizationId]
        );

        // Monthly breakdown (last 6 months)
        const monthlyResult = await pool.query(
            `SELECT
                TO_CHAR(created_at, 'YYYY-MM') as month,
                COUNT(*) as count,
                COUNT(*) FILTER (WHERE rating = 'positive') as positive,
                COUNT(*) FILTER (WHERE rating = 'negative') as negative,
                COUNT(*) FILTER (WHERE rating IS NOT NULL) as rated
             FROM response_history
             WHERE organization_id = $1 AND created_at >= NOW() - INTERVAL '6 months'
             GROUP BY TO_CHAR(created_at, 'YYYY-MM')
             ORDER BY month DESC`,
            [organizationId]
        );

        // Category breakdown
        const categoryResult = await pool.query(
            `SELECT format as category, COUNT(*) as count
             FROM response_history
             WHERE organization_id = $1
             GROUP BY format
             ORDER BY count DESC`,
            [organizationId]
        );

        const rating = ratingResult.rows[0];

        res.json({
            total: parseInt(totalResult.rows[0].total),
            today: parseInt(todayResult.rows[0].today),
            positiveRate: rating.rated > 0 ? Math.round(parseInt(rating.positive) / parseInt(rating.rated) * 100) : 0,
            rated: parseInt(rating.rated),
            positive: parseInt(rating.positive),
            negative: parseInt(rating.negative),
            leaderboard: leaderboardResult.rows.map((r, i) => ({
                rank: i + 1,
                name: `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.email,
                count: parseInt(r.count)
            })),
            monthly: monthlyResult.rows,
            categories: categoryResult.rows
        });

    } catch (error) {
        console.error('Get analytics stats error:', error);
        res.status(500).json({ error: 'Failed to get analytics' });
    }
});

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
