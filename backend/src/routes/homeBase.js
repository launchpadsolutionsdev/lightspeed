const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');

const VALID_CATEGORIES = ['urgent', 'fyi', 'draw_update', 'campaign', 'general'];
const VALID_REACTIONS = ['👍', '✅', '👀', '🎉', '❤️', '😂'];
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

        // Batch-load reactions for all posts
        const postIds = result.rows.map(p => p.id);
        let reactionsMap = {};
        if (postIds.length > 0) {
            try {
                const reactResult = await pool.query(
                    `SELECT post_id, emoji, COUNT(*)::int AS count,
                            bool_or(user_id = $2) AS me
                     FROM home_base_reactions
                     WHERE post_id = ANY($1)
                     GROUP BY post_id, emoji
                     ORDER BY MIN(created_at)`,
                    [postIds, req.userId]
                );
                for (const r of reactResult.rows) {
                    if (!reactionsMap[r.post_id]) reactionsMap[r.post_id] = [];
                    reactionsMap[r.post_id].push({ emoji: r.emoji, count: r.count, me: r.me });
                }
            } catch (_e) { /* reactions table may not exist yet */ }
        }

        const posts = result.rows.map(p => ({
            ...p,
            reactions: reactionsMap[p.id] || []
        }));

        res.json({ posts });
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
        post.reactions = [];

        // Process @mentions (fire-and-forget)
        const mentions = extractMentions(postBody);
        if (mentions.length > 0) {
            resolveMentions(mentions, organizationId, req.userId).then(ids => {
                if (ids.length > 0) createMentionNotifications(ids, req.userId, organizationId, post.id, null);
            }).catch(() => {});
        }

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
            'SELECT id, author_id FROM home_base_posts WHERE id = $1 AND organization_id = $2',
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

        // Notify post author of reply (fire-and-forget)
        const postAuthorId = postCheck.rows[0].author_id;
        createReplyNotification(postAuthorId, req.userId, req.organizationId, req.params.id, comment.id);

        // Process @mentions in comment (fire-and-forget)
        const mentions = extractMentions(req.body.body);
        if (mentions.length > 0) {
            resolveMentions(mentions, req.organizationId, req.userId).then(ids => {
                if (ids.length > 0) createMentionNotifications(ids, req.userId, req.organizationId, req.params.id, comment.id);
            }).catch(() => {});
        }

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

// ── Reactions ─────────────────────────────────────────────────────────

/**
 * GET /api/home-base/posts/:id/reactions
 * Returns reaction counts and which ones the current user has toggled.
 */
router.get('/posts/:id/reactions', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT emoji, COUNT(*)::int AS count,
                    bool_or(user_id = $2) AS me
             FROM home_base_reactions
             WHERE post_id = $1
             GROUP BY emoji
             ORDER BY MIN(created_at)`,
            [req.params.id, req.userId]
        );
        res.json({ reactions: result.rows });
    } catch (error) {
        console.error('Failed to get reactions:', error.message);
        res.status(500).json({ error: 'Failed to get reactions' });
    }
});

/**
 * POST /api/home-base/posts/:id/reactions
 * Toggle a reaction on a post. Body: { emoji }
 */
router.post('/posts/:id/reactions', authenticate, [
    body('emoji').notEmpty().withMessage('Emoji is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { emoji } = req.body;
        if (!VALID_REACTIONS.includes(emoji)) {
            return res.status(400).json({ error: 'Invalid reaction emoji' });
        }

        // Check if already reacted — toggle off
        const existing = await pool.query(
            'DELETE FROM home_base_reactions WHERE post_id = $1 AND user_id = $2 AND emoji = $3 RETURNING id',
            [req.params.id, req.userId, emoji]
        );

        if (existing.rows.length > 0) {
            return res.json({ toggled: false, emoji });
        }

        // Add reaction
        await pool.query(
            'INSERT INTO home_base_reactions (post_id, user_id, emoji) VALUES ($1, $2, $3)',
            [req.params.id, req.userId, emoji]
        );

        res.status(201).json({ toggled: true, emoji });
    } catch (error) {
        console.error('Failed to toggle reaction:', error.message);
        res.status(500).json({ error: 'Failed to toggle reaction' });
    }
});

// ── Mentions & Notifications ──────────────────────────────────────────

/**
 * Extract @mentions from text. Returns array of {first_name, last_name} pairs.
 * Matches @FirstName LastName or @FirstName patterns.
 */
function extractMentions(text) {
    if (!text) return [];
    const matches = text.match(/@([\w]+(?:\s[\w]+)?)/g);
    if (!matches) return [];
    return matches.map(m => {
        const parts = m.slice(1).split(/\s+/);
        return { first: parts[0], last: parts[1] || null };
    });
}

/**
 * Resolve mention names to user IDs within an organization.
 */
async function resolveMentions(mentions, organizationId, excludeUserId) {
    if (mentions.length === 0) return [];
    const userIds = [];

    for (const mention of mentions) {
        let query, params;
        if (mention.last) {
            query = `SELECT u.id FROM users u
                     JOIN organization_memberships om ON om.user_id = u.id
                     WHERE om.organization_id = $1
                       AND LOWER(u.first_name) = LOWER($2)
                       AND LOWER(u.last_name) = LOWER($3)
                       AND u.id != $4
                     LIMIT 1`;
            params = [organizationId, mention.first, mention.last, excludeUserId];
        } else {
            query = `SELECT u.id FROM users u
                     JOIN organization_memberships om ON om.user_id = u.id
                     WHERE om.organization_id = $1
                       AND LOWER(u.first_name) = LOWER($2)
                       AND u.id != $3
                     LIMIT 1`;
            params = [organizationId, mention.first, excludeUserId];
        }
        const result = await pool.query(query, params);
        if (result.rows.length > 0) {
            userIds.push(result.rows[0].id);
        }
    }

    return [...new Set(userIds)]; // dedupe
}

/**
 * Create notifications for mentioned users. Fire-and-forget.
 */
async function createMentionNotifications(recipientIds, actorId, organizationId, postId, commentId) {
    for (const recipientId of recipientIds) {
        pool.query(
            `INSERT INTO home_base_notifications (recipient_id, actor_id, organization_id, type, post_id, comment_id)
             VALUES ($1, $2, $3, 'mention', $4, $5)`,
            [recipientId, actorId, organizationId, postId, commentId || null]
        ).catch(err => console.error('Failed to create mention notification:', err.message));
    }
}

/**
 * Create a reply notification for the post author when someone comments.
 */
async function createReplyNotification(postAuthorId, commenterId, organizationId, postId, commentId) {
    if (postAuthorId === commenterId) return; // don't notify yourself
    pool.query(
        `INSERT INTO home_base_notifications (recipient_id, actor_id, organization_id, type, post_id, comment_id)
         VALUES ($1, $2, $3, 'reply', $4, $5)`,
        [postAuthorId, commenterId, organizationId, postId, commentId]
    ).catch(err => console.error('Failed to create reply notification:', err.message));
}

/**
 * GET /api/home-base/notifications
 * Returns notifications for the current user, newest first.
 */
router.get('/notifications', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT n.id, n.type, n.post_id, n.comment_id, n.read, n.created_at,
                    a.first_name AS actor_first_name, a.last_name AS actor_last_name,
                    p.body AS post_body
             FROM home_base_notifications n
             JOIN users a ON a.id = n.actor_id
             LEFT JOIN home_base_posts p ON p.id = n.post_id
             WHERE n.recipient_id = $1 AND n.organization_id = $2
             ORDER BY n.created_at DESC
             LIMIT 50`,
            [req.userId, req.organizationId]
        );

        res.json({ notifications: result.rows });
    } catch (error) {
        console.error('Failed to get notifications:', error.message);
        res.status(500).json({ error: 'Failed to get notifications' });
    }
});

/**
 * GET /api/home-base/notifications/unread-count
 * Returns unread notification count for sidebar badge.
 */
router.get('/notifications/unread-count', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM home_base_notifications
             WHERE recipient_id = $1 AND organization_id = $2 AND read = false`,
            [req.userId, req.organizationId]
        );
        res.json({ count: result.rows[0].count });
    } catch (error) {
        console.error('Failed to get unread count:', error.message);
        res.status(500).json({ error: 'Failed to get unread count' });
    }
});

/**
 * PATCH /api/home-base/notifications/read
 * Mark notifications as read. Body: { ids: [...] } or { all: true }
 */
router.patch('/notifications/read', authenticate, async (req, res) => {
    try {
        if (req.body.all) {
            await pool.query(
                `UPDATE home_base_notifications SET read = true
                 WHERE recipient_id = $1 AND organization_id = $2 AND read = false`,
                [req.userId, req.organizationId]
            );
        } else if (req.body.ids && Array.isArray(req.body.ids)) {
            await pool.query(
                `UPDATE home_base_notifications SET read = true
                 WHERE id = ANY($1) AND recipient_id = $2`,
                [req.body.ids, req.userId]
            );
        }
        res.json({ message: 'Notifications marked as read' });
    } catch (error) {
        console.error('Failed to mark notifications read:', error.message);
        res.status(500).json({ error: 'Failed to update notifications' });
    }
});

// ── Search ────────────────────────────────────────────────────────────

/**
 * GET /api/home-base/search?q=term
 * Full-text search across posts within the organization.
 */
router.get('/search', authenticate, async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q) {
            return res.json({ posts: [] });
        }

        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'Organization required' });
        }

        const result = await pool.query(
            `SELECT p.id, p.body, p.category, p.pinned, p.created_at, p.updated_at,
                    p.author_id,
                    u.first_name, u.last_name,
                    COALESCE(c.comment_count, 0)::int AS comment_count,
                    ts_rank(p.search_vector, plainto_tsquery('english', $2)) AS rank
             FROM home_base_posts p
             JOIN users u ON u.id = p.author_id
             LEFT JOIN (
                 SELECT post_id, COUNT(*) AS comment_count
                 FROM home_base_comments
                 GROUP BY post_id
             ) c ON c.post_id = p.id
             WHERE p.organization_id = $1
               AND p.search_vector @@ plainto_tsquery('english', $2)
             ORDER BY rank DESC, p.created_at DESC
             LIMIT 50`,
            [organizationId, q]
        );

        res.json({ posts: result.rows });
    } catch (error) {
        console.error('Failed to search posts:', error.message);
        res.status(500).json({ error: 'Failed to search posts' });
    }
});

// ── Team members (for @mention autocomplete) ─────────────────────────

/**
 * GET /api/home-base/members
 * Returns team members for @mention autocomplete.
 */
router.get('/members', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.first_name, u.last_name
             FROM users u
             JOIN organization_memberships om ON om.user_id = u.id
             WHERE om.organization_id = $1
             ORDER BY u.first_name, u.last_name`,
            [req.organizationId]
        );
        res.json({ members: result.rows });
    } catch (error) {
        console.error('Failed to get members:', error.message);
        res.status(500).json({ error: 'Failed to get members' });
    }
});

module.exports = router;
