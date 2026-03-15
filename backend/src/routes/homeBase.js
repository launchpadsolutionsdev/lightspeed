const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

const VALID_CATEGORIES = ['urgent', 'fyi', 'draw_update', 'campaign', 'general'];
const MAX_PINNED = 3;

/**
 * Helper: check if the current user is admin/owner in their org.
 */
async function isAdmin(userId, organizationId) {
    const result = await pool.query(
        'SELECT role FROM organization_memberships WHERE user_id = $1 AND organization_id = $2',
        [userId, organizationId]
    );
    if (result.rows.length === 0) return false;
    return result.rows[0].role === 'admin' || result.rows[0].role === 'owner';
}

// ── Posts ──────────────────────────────────────────────────────────────

/**
 * GET /api/home-base/posts?category=all
 * Returns posts newest first, pinned posts flagged. Includes author name and comment count.
 */
router.get('/posts', authenticate, async (req, res) => {
    try {
        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'Organization required' });
        }

        const category = req.query.category;
        let categoryFilter = '';
        const params = [organizationId];

        if (category && category !== 'all' && VALID_CATEGORIES.includes(category)) {
            categoryFilter = ' AND p.category = $2';
            params.push(category);
        }

        const result = await pool.query(
            `SELECT p.id, p.body, p.category, p.pinned, p.created_at, p.updated_at,
                    p.author_id,
                    u.first_name, u.last_name,
                    COALESCE(c.comment_count, 0)::int AS comment_count
             FROM home_base_posts p
             JOIN users u ON u.id = p.author_id
             LEFT JOIN (
                 SELECT post_id, COUNT(*) AS comment_count
                 FROM home_base_comments
                 GROUP BY post_id
             ) c ON c.post_id = p.id
             WHERE p.organization_id = $1${categoryFilter}
             ORDER BY p.pinned DESC, p.created_at DESC`,
            params
        );

        res.json({ posts: result.rows });
    } catch (error) {
        console.error('Failed to get home base posts:', error.message);
        res.status(500).json({ error: 'Failed to get posts' });
    }
});

/**
 * POST /api/home-base/posts
 * Create a new post. Body: { body, category }
 */
router.post('/posts', authenticate, [
    body('body').trim().notEmpty().withMessage('Post body is required'),
    body('category').optional().isIn(VALID_CATEGORIES).withMessage('Invalid category')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'Organization required' });
        }

        const { body: postBody, category } = req.body;

        const result = await pool.query(
            `INSERT INTO home_base_posts (organization_id, author_id, body, category)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [organizationId, req.userId, postBody, category || 'general']
        );

        // Fetch author info for the response
        const post = result.rows[0];
        const userResult = await pool.query(
            'SELECT first_name, last_name FROM users WHERE id = $1',
            [req.userId]
        );
        post.first_name = userResult.rows[0]?.first_name;
        post.last_name = userResult.rows[0]?.last_name;
        post.comment_count = 0;

        res.status(201).json({ post });
    } catch (error) {
        console.error('Failed to create home base post:', error.message);
        res.status(500).json({ error: 'Failed to create post' });
    }
});

/**
 * DELETE /api/home-base/posts/:id
 * Delete a post. Only the original author OR an admin can delete.
 */
router.delete('/posts/:id', authenticate, async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const postResult = await pool.query(
            'SELECT author_id FROM home_base_posts WHERE id = $1 AND organization_id = $2',
            [req.params.id, organizationId]
        );

        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const isAuthor = postResult.rows[0].author_id === req.userId;
        const admin = await isAdmin(req.userId, organizationId);

        if (!isAuthor && !admin) {
            return res.status(403).json({ error: 'Not authorized to delete this post' });
        }

        await pool.query(
            'DELETE FROM home_base_posts WHERE id = $1 AND organization_id = $2',
            [req.params.id, organizationId]
        );

        res.json({ message: 'Post deleted' });
    } catch (error) {
        console.error('Failed to delete home base post:', error.message);
        res.status(500).json({ error: 'Failed to delete post' });
    }
});

/**
 * PATCH /api/home-base/posts/:id/pin
 * Toggle pin/unpin on a post. Admin only. Max 3 pinned posts.
 */
router.patch('/posts/:id/pin', authenticate, async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const admin = await isAdmin(req.userId, organizationId);
        if (!admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const postResult = await pool.query(
            'SELECT id, pinned FROM home_base_posts WHERE id = $1 AND organization_id = $2',
            [req.params.id, organizationId]
        );

        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const currentlyPinned = postResult.rows[0].pinned;

        // If unpinning, just do it
        if (currentlyPinned) {
            await pool.query(
                'UPDATE home_base_posts SET pinned = false, updated_at = NOW() WHERE id = $1',
                [req.params.id]
            );
            return res.json({ pinned: false });
        }

        // If pinning, check max limit
        const pinnedCount = await pool.query(
            'SELECT COUNT(*) FROM home_base_posts WHERE organization_id = $1 AND pinned = true',
            [organizationId]
        );

        if (parseInt(pinnedCount.rows[0].count) >= MAX_PINNED) {
            return res.status(400).json({
                error: `Maximum ${MAX_PINNED} pinned posts allowed. Unpin one first.`
            });
        }

        await pool.query(
            'UPDATE home_base_posts SET pinned = true, updated_at = NOW() WHERE id = $1',
            [req.params.id]
        );

        res.json({ pinned: true });
    } catch (error) {
        console.error('Failed to toggle pin:', error.message);
        res.status(500).json({ error: 'Failed to toggle pin' });
    }
});

// ── Comments ──────────────────────────────────────────────────────────

/**
 * GET /api/home-base/posts/:id/comments
 * Returns all comments for a post, chronological, with author names.
 */
router.get('/posts/:id/comments', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.id, c.body, c.created_at, c.author_id,
                    u.first_name, u.last_name
             FROM home_base_comments c
             JOIN users u ON u.id = c.author_id
             WHERE c.post_id = $1
             ORDER BY c.created_at ASC`,
            [req.params.id]
        );

        res.json({ comments: result.rows });
    } catch (error) {
        console.error('Failed to get comments:', error.message);
        res.status(500).json({ error: 'Failed to get comments' });
    }
});

/**
 * POST /api/home-base/posts/:id/comments
 * Add a comment. Body: { body }
 */
router.post('/posts/:id/comments', authenticate, [
    body('body').trim().notEmpty().withMessage('Comment body is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        // Verify post exists and belongs to user's org
        const postCheck = await pool.query(
            'SELECT id FROM home_base_posts WHERE id = $1 AND organization_id = $2',
            [req.params.id, req.organizationId]
        );
        if (postCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const result = await pool.query(
            `INSERT INTO home_base_comments (post_id, author_id, body)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [req.params.id, req.userId, req.body.body]
        );

        const comment = result.rows[0];
        const userResult = await pool.query(
            'SELECT first_name, last_name FROM users WHERE id = $1',
            [req.userId]
        );
        comment.first_name = userResult.rows[0]?.first_name;
        comment.last_name = userResult.rows[0]?.last_name;

        res.status(201).json({ comment });
    } catch (error) {
        console.error('Failed to create comment:', error.message);
        res.status(500).json({ error: 'Failed to create comment' });
    }
});

/**
 * DELETE /api/home-base/comments/:id
 * Delete a comment. Only the original author can delete.
 */
router.delete('/comments/:id', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM home_base_comments WHERE id = $1 AND author_id = $2 RETURNING id',
            [req.params.id, req.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Comment not found or not authorized' });
        }

        res.json({ message: 'Comment deleted' });
    } catch (error) {
        console.error('Failed to delete comment:', error.message);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

module.exports = router;
