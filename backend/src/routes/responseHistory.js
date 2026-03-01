/**
 * Response History Routes
 * Save responses, rate them, and retrieve rated examples for AI learning
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');
const { pickRelevantRatedExamples } = require('../services/claude');

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

        // Quality metrics (gracefully handles missing columns from migration 024)
        let quality = null;
        try {
            const qualityResult = await pool.query(
                `SELECT
                    ROUND(AVG(char_count))::int AS avg_char_count,
                    ROUND(AVG(word_count))::int AS avg_word_count,
                    ROUND(AVG(kb_entries_used)::numeric, 1) AS avg_kb_entries_used,
                    ROUND(AVG(response_time_ms))::int AS avg_response_time_ms,
                    COUNT(*) FILTER (WHERE format = 'facebook' AND char_count > 400) AS facebook_over_limit,
                    COUNT(*) FILTER (WHERE format = 'facebook') AS facebook_total
                 FROM response_history
                 WHERE organization_id = $1 AND char_count IS NOT NULL`,
                [organizationId]
            );

            const qualityTrendResult = await pool.query(
                `SELECT
                    TO_CHAR(created_at, 'YYYY-MM') AS month,
                    ROUND(AVG(kb_entries_used)::numeric, 1) AS avg_kb_entries,
                    COUNT(*) FILTER (WHERE rating = 'positive') AS positive,
                    COUNT(*) FILTER (WHERE rating IS NOT NULL) AS rated,
                    ROUND(AVG(response_time_ms))::int AS avg_response_time_ms
                 FROM response_history
                 WHERE organization_id = $1 AND created_at >= NOW() - INTERVAL '6 months'
                 GROUP BY TO_CHAR(created_at, 'YYYY-MM')
                 ORDER BY month DESC`,
                [organizationId]
            );

            const q = qualityResult.rows[0];
            const fbTotal = parseInt(q.facebook_total) || 0;
            quality = {
                avgCharCount: parseInt(q.avg_char_count) || 0,
                avgWordCount: parseInt(q.avg_word_count) || 0,
                avgKbEntriesUsed: parseFloat(q.avg_kb_entries_used) || 0,
                avgResponseTimeMs: parseInt(q.avg_response_time_ms) || 0,
                facebookOverLimitRate: fbTotal > 0 ? Math.round(parseInt(q.facebook_over_limit) / fbTotal * 100) : 0,
                qualityTrend: qualityTrendResult.rows.map(r => ({
                    month: r.month,
                    positiveRate: parseInt(r.rated) > 0 ? Math.round(parseInt(r.positive) / parseInt(r.rated) * 100) : 0,
                    avgKbEntries: parseFloat(r.avg_kb_entries) || 0,
                    avgResponseTimeMs: parseInt(r.avg_response_time_ms) || 0
                }))
            };
        } catch (qualityErr) {
            // Migration 024 may not have run yet — quality columns don't exist
            console.warn('Quality metrics unavailable:', qualityErr.message);
        }

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
            categories: categoryResult.rows,
            quality
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
        const { inquiry, response, format, tone, tool, kb_entries_used, quality_violations, response_time_ms } = req.body;

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

        // Compute quality metrics
        const charCount = response.length;
        const wordCount = response.trim().split(/\s+/).length;

        const result = await pool.query(
            `INSERT INTO response_history (organization_id, user_id, inquiry, response, format, tone, tool,
                char_count, word_count, kb_entries_used, quality_violations, response_time_ms, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
             RETURNING *`,
            [organizationId, req.userId, inquiry, response, format || 'email', tone || 'balanced', tool || 'response_assistant',
             charCount, wordCount, kb_entries_used || 0, JSON.stringify(quality_violations || []), response_time_ms || null]
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

        const entry = result.rows[0];

        // Auto-create a lightweight correction KB entry when:
        // 1. Rating is negative
        // 2. Feedback text was provided (user explained what was wrong)
        // 3. No KB entry was already linked (user didn't create one manually)
        // This ensures corrections are searchable in future KB retrieval.
        if (rating === 'negative' && feedback && !entry.feedback_kb_entry_id) {
            try {
                const title = (entry.inquiry || '').substring(0, 255) || 'Correction from feedback';
                const autoKeywords = title.toLowerCase()
                    .replace(/[^a-z0-9\s]/g, '')
                    .split(/\s+/)
                    .filter(w => w.length > 3)
                    .slice(0, 8)
                    .map(k => `keyword:${k}`);

                const tags = ['source:feedback', 'source:auto-correction', ...autoKeywords];

                const kbResult = await pool.query(
                    `INSERT INTO knowledge_base (id, organization_id, title, content, category, tags, kb_type, created_by, source_response_id, created_at, updated_at)
                     VALUES (gen_random_uuid(), $1, $2, $3, 'faqs', $4, 'support', $5, $6, NOW(), NOW())
                     RETURNING id`,
                    [organizationId, title, feedback, tags, req.userId, id]
                );

                // Link the KB entry back to the response
                await pool.query(
                    `UPDATE response_history SET feedback_kb_entry_id = $1 WHERE id = $2`,
                    [kbResult.rows[0].id, id]
                );

                entry.feedback_kb_entry_id = kbResult.rows[0].id;
            } catch (kbErr) {
                // Non-fatal: the rating was still saved successfully
                console.warn('Auto-correction KB entry creation failed:', kbErr.message);
            }
        }

        res.json({ entry });

    } catch (error) {
        console.error('Rate response error:', error);
        res.status(500).json({ error: 'Failed to rate response' });
    }
});

/**
 * GET /api/response-history/rated-examples
 * Get rated examples for AI prompt injection (learning)
 * Returns recent positive and negative examples for the organization.
 *
 * Query params:
 *   tool   - filter by tool (default: 'response_assistant')
 *   format - filter by format ('email', 'facebook'). When provided, results
 *            are scoped to matching formats so email examples don't leak into
 *            Facebook prompts and vice versa.
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
        const tool = req.query.tool || 'response_assistant';
        const format = req.query.format || null;
        const inquiry = req.query.inquiry || null;

        // Build optional format filter clause
        const formatClause = format ? ` AND format = $3` : '';
        const positiveParams = format ? [organizationId, tool, format] : [organizationId, tool];
        const negativeParams = format ? [organizationId, tool, format] : [organizationId, tool];

        // Fetch a larger pool when inquiry is provided (Haiku will filter for relevance)
        const positiveLimit = inquiry ? 20 : 5;
        const negativeLimit = inquiry ? 10 : 3;

        // Get pool of positive examples (good responses to emulate)
        const positiveResult = await pool.query(
            `SELECT inquiry, response, format, tone
             FROM response_history
             WHERE organization_id = $1 AND rating = 'positive' AND (tool = $2 OR tool IS NULL)${formatClause}
             ORDER BY rating_at DESC
             LIMIT ${positiveLimit}`,
            positiveParams
        );

        // Get pool of negative examples with feedback (mistakes to avoid)
        // Join via proper FK (feedback_kb_entry_id) to pull in corrections
        const negativeResult = await pool.query(
            `SELECT rh.inquiry, rh.response, rh.rating_feedback, rh.format, rh.tone,
                    kb.content AS corrected_response
             FROM response_history rh
             LEFT JOIN knowledge_base kb
                ON rh.feedback_kb_entry_id = kb.id
             WHERE rh.organization_id = $1 AND rh.rating = 'negative' AND (rh.tool = $2 OR rh.tool IS NULL)${formatClause.replace('format', 'rh.format')}
             ORDER BY rh.rating_at DESC
             LIMIT ${negativeLimit}`,
            negativeParams
        );

        // If an inquiry was provided, use Haiku to filter for topical relevance
        if (inquiry && (positiveResult.rows.length > 5 || negativeResult.rows.length > 3)) {
            const filtered = await pickRelevantRatedExamples(
                inquiry,
                positiveResult.rows,
                negativeResult.rows,
                5,
                3
            );
            return res.json(filtered);
        }

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
