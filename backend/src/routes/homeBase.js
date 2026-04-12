const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');
const log = require('../services/logger');

const DEFAULT_CATEGORIES = [
    { slug: 'general', label: 'General', color: '#6B7280', sort_order: 0, is_default: true },
    { slug: 'urgent', label: 'Urgent', color: '#DC2626', sort_order: 1 },
    { slug: 'fyi', label: 'FYI', color: '#2563EB', sort_order: 2 },
    { slug: 'draw_update', label: 'Draw Update', color: '#059669', sort_order: 3 },
    { slug: 'campaign', label: 'Campaign', color: '#7C3AED', sort_order: 4 },
];

/** Fetch valid category slugs for an org (falls back to defaults if table doesn't exist yet) */
async function getOrgCategories(organizationId) {
    try {
        const result = await pool.query(
            'SELECT slug, label, color, sort_order, is_default FROM home_base_categories WHERE organization_id = $1 ORDER BY sort_order',
            [organizationId]
        );
        if (result.rows.length > 0) return result.rows;
    } catch (_e) { /* table may not exist yet */ }
    return DEFAULT_CATEGORIES;
}

async function getValidCategorySlugs(organizationId) {
    const cats = await getOrgCategories(organizationId);
    return cats.map(c => c.slug);
}

/** Seed default categories for an org if none exist */
async function seedDefaultCategories(organizationId) {
    try {
        const existing = await pool.query(
            'SELECT COUNT(*)::int AS count FROM home_base_categories WHERE organization_id = $1',
            [organizationId]
        );
        if (existing.rows[0].count > 0) return;
        for (const cat of DEFAULT_CATEGORIES) {
            await pool.query(
                'INSERT INTO home_base_categories (organization_id, slug, label, color, sort_order, is_default) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
                [organizationId, cat.slug, cat.label, cat.color, cat.sort_order, cat.is_default || false]
            );
        }
    } catch (_e) { /* migration may not have run yet */ }
}

const VALID_REACTIONS = ['👍', '✅', '👀', '🎉', '❤️', '😂'];
const MAX_PINNED = 3;
const EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ATTACHMENT_SIZE },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_FILE_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('File type not allowed. Use JPEG, PNG, GIF, WebP, or PDF.'));
        }
    }
});

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

/**
 * Helper: check if user is a super admin.
 */
async function isSuperAdmin(userId) {
    const result = await pool.query(
        'SELECT is_super_admin FROM users WHERE id = $1',
        [userId]
    );
    return result.rows[0]?.is_super_admin === true;
}

/**
 * Helper: check if the is_global column exists on home_base_posts.
 * Cached after first check. Lets the server gracefully fall back to
 * org-only behavior if migration 063 hasn't applied yet.
 */
let _globalColumnChecked = false;
let _globalColumnExists = false;
async function hasGlobalColumn() {
    if (_globalColumnChecked) return _globalColumnExists;
    try {
        const result = await pool.query(
            `SELECT column_name FROM information_schema.columns
             WHERE table_name = 'home_base_posts' AND column_name = 'is_global'`
        );
        _globalColumnExists = result.rows.length > 0;
    } catch (_e) {
        _globalColumnExists = false;
    }
    _globalColumnChecked = true;
    return _globalColumnExists;
}

// ── Categories ────────────────────────────────────────────────────────

/**
 * GET /api/home-base/categories
 * List categories for the current org. Seeds defaults if none exist.
 */
router.get('/categories', authenticate, async (req, res) => {
    try {
        await seedDefaultCategories(req.organizationId);
        const cats = await getOrgCategories(req.organizationId);
        res.json({ categories: cats });
    } catch (error) {
        log.error('Failed to get categories', { error: error.message });
        res.status(500).json({ error: 'Failed to get categories' });
    }
});

/**
 * POST /api/home-base/categories
 * Create a custom category. Admin only. Body: { slug, label, color }
 */
router.post('/categories', authenticate, [
    body('slug').trim().notEmpty().matches(/^[a-z0-9_]+$/).withMessage('Slug must be lowercase alphanumeric with underscores'),
    body('label').trim().notEmpty().withMessage('Label is required'),
    body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Color must be a hex code')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const admin = await isAdmin(req.userId, req.organizationId);
        if (!admin) return res.status(403).json({ error: 'Admin access required' });

        // Get next sort order
        const maxOrder = await pool.query(
            'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM home_base_categories WHERE organization_id = $1',
            [req.organizationId]
        );

        const result = await pool.query(
            'INSERT INTO home_base_categories (organization_id, slug, label, color, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [req.organizationId, req.body.slug, req.body.label, req.body.color || '#6B7280', maxOrder.rows[0].next]
        );

        res.status(201).json({ category: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Category slug already exists' });
        log.error('Failed to create category', { error: error.message });
        res.status(500).json({ error: 'Failed to create category' });
    }
});

/**
 * PATCH /api/home-base/categories/:id
 * Update a category. Admin only. Body: { label?, color?, sort_order? }
 */
router.patch('/categories/:id', authenticate, async (req, res) => {
    try {
        const admin = await isAdmin(req.userId, req.organizationId);
        if (!admin) return res.status(403).json({ error: 'Admin access required' });

        const { label, color, sort_order } = req.body;
        const updates = [];
        const params = [];
        let idx = 1;

        if (label) { updates.push(`label = $${idx}`); params.push(label); idx++; }
        if (color) { updates.push(`color = $${idx}`); params.push(color); idx++; }
        if (sort_order !== undefined) { updates.push(`sort_order = $${idx}`); params.push(sort_order); idx++; }

        if (updates.length === 0) return res.status(400).json({ error: 'No updates provided' });

        params.push(req.params.id, req.organizationId);
        const result = await pool.query(
            `UPDATE home_base_categories SET ${updates.join(', ')} WHERE id = $${idx} AND organization_id = $${idx + 1} RETURNING *`,
            params
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
        res.json({ category: result.rows[0] });
    } catch (error) {
        log.error('Failed to update category', { error: error.message });
        res.status(500).json({ error: 'Failed to update category' });
    }
});

/**
 * DELETE /api/home-base/categories/:id
 * Delete a custom category. Admin only. Cannot delete default categories.
 * Posts with this category are reassigned to 'general'.
 */
router.delete('/categories/:id', authenticate, async (req, res) => {
    try {
        const admin = await isAdmin(req.userId, req.organizationId);
        if (!admin) return res.status(403).json({ error: 'Admin access required' });

        // Check if it's a default category
        const cat = await pool.query(
            'SELECT slug, is_default FROM home_base_categories WHERE id = $1 AND organization_id = $2',
            [req.params.id, req.organizationId]
        );
        if (cat.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
        if (cat.rows[0].is_default) return res.status(400).json({ error: 'Cannot delete the default category' });

        // Reassign posts with this category to 'general'
        await pool.query(
            "UPDATE home_base_posts SET category = 'general' WHERE organization_id = $1 AND category = $2",
            [req.organizationId, cat.rows[0].slug]
        );

        await pool.query(
            'DELETE FROM home_base_categories WHERE id = $1 AND organization_id = $2',
            [req.params.id, req.organizationId]
        );

        res.json({ message: 'Category deleted' });
    } catch (error) {
        log.error('Failed to delete category', { error: error.message });
        res.status(500).json({ error: 'Failed to delete category' });
    }
});

// ── Link Previews ─────────────────────────────────────────────────────

/**
 * POST /api/home-base/link-preview
 * Fetch Open Graph metadata for a URL. Uses cache to avoid re-fetching.
 * Body: { url }
 */
router.post('/link-preview', authenticate, async (req, res) => {
    try {
        const { url } = req.body;
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'URL is required' });
        }

        // Validate URL format
        let parsed;
        try { parsed = new URL(url); } catch (_e) {
            return res.status(400).json({ error: 'Invalid URL' });
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are supported' });
        }

        // Check cache first (valid for 24 hours)
        try {
            const cached = await pool.query(
                "SELECT title, description, image, site_name FROM home_base_link_previews WHERE url = $1 AND fetched_at > NOW() - INTERVAL '24 hours'",
                [url]
            );
            if (cached.rows.length > 0) {
                return res.json({ preview: cached.rows[0] });
            }
        } catch (_e) { /* cache table may not exist yet */ }

        // Fetch the URL with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; LightspeedBot/1.0)',
                'Accept': 'text/html'
            },
            signal: controller.signal,
            redirect: 'follow'
        });
        clearTimeout(timeout);

        if (!response.ok) {
            return res.json({ preview: null });
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html')) {
            return res.json({ preview: null });
        }

        const html = await response.text();

        // Parse Open Graph and meta tags
        const getMetaContent = (property) => {
            const patterns = [
                new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
                new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
                new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
                new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, 'i'),
            ];
            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match) return match[1];
            }
            return null;
        };

        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);

        const preview = {
            title: getMetaContent('og:title') || getMetaContent('twitter:title') || (titleMatch ? titleMatch[1].trim() : null),
            description: getMetaContent('og:description') || getMetaContent('twitter:description') || getMetaContent('description'),
            image: getMetaContent('og:image') || getMetaContent('twitter:image'),
            site_name: getMetaContent('og:site_name') || parsed.hostname
        };

        // Resolve relative image URLs
        if (preview.image && !preview.image.startsWith('http')) {
            preview.image = new URL(preview.image, url).href;
        }

        // Truncate long descriptions
        if (preview.description && preview.description.length > 200) {
            preview.description = preview.description.substring(0, 200) + '...';
        }

        // Cache the result (upsert)
        try {
            await pool.query(
                `INSERT INTO home_base_link_previews (url, title, description, image, site_name)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (url) DO UPDATE SET title = $2, description = $3, image = $4, site_name = $5, fetched_at = NOW()`,
                [url, preview.title, preview.description, preview.image, preview.site_name]
            );
        } catch (_e) { /* cache write failure is non-critical */ }

        res.json({ preview });
    } catch (error) {
        if (error.name === 'AbortError') {
            return res.json({ preview: null });
        }
        log.error('Link preview error', { error: error.message });
        res.json({ preview: null });
    }
});

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

        const validSlugs = await getValidCategorySlugs(organizationId);
        if (category && category !== 'all' && validSlugs.includes(category)) {
            categoryFilter = ' AND p.category = $2';
            params.push(category);
        }

        const hasGlobal = await hasGlobalColumn();
        const globalSelect = hasGlobal ? 'COALESCE(p.is_global, false) AS is_global,' : 'false AS is_global,';
        const globalWhere = hasGlobal ? '(p.organization_id = $1 OR p.is_global = true)' : 'p.organization_id = $1';

        const result = await pool.query(
            `SELECT p.id, p.body, p.category, p.pinned, COALESCE(p.pin_order, 0) AS pin_order, p.created_at, p.updated_at,
                    p.author_id, p.edited_at, p.requires_ack, ${globalSelect}
                    u.first_name, u.last_name,
                    COALESCE(c.comment_count, 0)::int AS comment_count,
                    COALESCE(a.attachment_count, 0)::int AS attachment_count
             FROM home_base_posts p
             JOIN users u ON u.id = p.author_id
             LEFT JOIN (
                 SELECT post_id, COUNT(*) AS comment_count
                 FROM home_base_comments
                 GROUP BY post_id
             ) c ON c.post_id = p.id
             LEFT JOIN (
                 SELECT post_id, COUNT(*) AS attachment_count
                 FROM home_base_attachments
                 GROUP BY post_id
             ) a ON a.post_id = p.id
             WHERE ${globalWhere}
               AND COALESCE(p.archived, false) = false
               AND COALESCE(p.is_draft, false) = false${categoryFilter}
             ORDER BY p.pinned DESC, p.pin_order ASC, p.created_at DESC`,
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

        // Batch-load attachment metadata (no file_data)
        let attachmentsMap = {};
        if (postIds.length > 0) {
            try {
                const attResult = await pool.query(
                    `SELECT id, post_id, file_name, file_type, file_size
                     FROM home_base_attachments
                     WHERE post_id = ANY($1)
                     ORDER BY created_at`,
                    [postIds]
                );
                for (const a of attResult.rows) {
                    if (!attachmentsMap[a.post_id]) attachmentsMap[a.post_id] = [];
                    attachmentsMap[a.post_id].push({ id: a.id, file_name: a.file_name, file_type: a.file_type, file_size: a.file_size });
                }
            } catch (_e) { /* attachments table may not exist yet */ }
        }

        // Batch-load acknowledgments for posts that require them
        let ackMap = {};
        const ackPostIds = result.rows.filter(p => p.requires_ack).map(p => p.id);
        if (ackPostIds.length > 0) {
            try {
                const ackResult = await pool.query(
                    `SELECT ak.post_id, ak.user_id, u.first_name, u.last_name
                     FROM home_base_acknowledgments ak
                     JOIN users u ON u.id = ak.user_id
                     WHERE ak.post_id = ANY($1)
                     ORDER BY ak.created_at`,
                    [ackPostIds]
                );
                for (const a of ackResult.rows) {
                    if (!ackMap[a.post_id]) ackMap[a.post_id] = [];
                    ackMap[a.post_id].push({ user_id: a.user_id, first_name: a.first_name, last_name: a.last_name });
                }
            } catch (_e) { /* ack table may not exist yet */ }
        }

        // Get org member count for ack progress
        let orgMemberCount = 0;
        if (ackPostIds.length > 0) {
            try {
                const memCount = await pool.query(
                    'SELECT COUNT(*)::int AS count FROM organization_memberships WHERE organization_id = $1',
                    [organizationId]
                );
                orgMemberCount = memCount.rows[0].count;
            } catch (_e) {}
        }

        // Batch-load view counts for all posts
        let viewCountMap = {};
        if (postIds.length > 0) {
            try {
                const viewResult = await pool.query(
                    `SELECT post_id, COUNT(*)::int AS view_count
                     FROM home_base_post_views
                     WHERE post_id = ANY($1)
                     GROUP BY post_id`,
                    [postIds]
                );
                for (const v of viewResult.rows) {
                    viewCountMap[v.post_id] = v.view_count;
                }
            } catch (_e) { /* views table may not exist yet */ }
        }

        // Batch-load bookmark status for current user
        let bookmarkSet = new Set();
        if (postIds.length > 0) {
            try {
                const bmResult = await pool.query(
                    'SELECT post_id FROM home_base_bookmarks WHERE post_id = ANY($1) AND user_id = $2',
                    [postIds, req.userId]
                );
                for (const b of bmResult.rows) {
                    bookmarkSet.add(b.post_id);
                }
            } catch (_e) { /* bookmarks table may not exist yet */ }
        }

        const posts = result.rows.map(p => ({
            ...p,
            reactions: reactionsMap[p.id] || [],
            attachments: attachmentsMap[p.id] || [],
            acks: p.requires_ack ? (ackMap[p.id] || []) : undefined,
            ack_total: p.requires_ack ? orgMemberCount : undefined,
            user_acked: p.requires_ack ? (ackMap[p.id] || []).some(a => a.user_id === req.userId) : undefined,
            view_count: viewCountMap[p.id] || 0,
            bookmarked: bookmarkSet.has(p.id)
        }));

        res.json({ posts });
    } catch (error) {
        log.error('Failed to get home base posts', { error: error.message });
        res.status(500).json({ error: 'Failed to get posts' });
    }
});

/**
 * POST /api/home-base/posts
 * Create a new post. Body: { body, category, requires_ack?, scheduled_for? }
 */
router.post('/posts', authenticate, [
    body('body').trim().notEmpty().withMessage('Post body is required'),
    body('category').optional().isString()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { body: postBody, category, requires_ack, scheduled_for, is_draft, is_global } = req.body;

        // Global posts: super admin only, org is optional
        const hasGlobal = await hasGlobalColumn();
        const isGlobal = !!is_global && hasGlobal;
        let organizationId = req.organizationId;

        if (is_global && !hasGlobal) {
            return res.status(503).json({ error: 'Global posts are not yet available — database migration pending.' });
        }

        if (isGlobal) {
            const superAdmin = await isSuperAdmin(req.userId);
            if (!superAdmin) {
                return res.status(403).json({ error: 'Only super admins can create global posts' });
            }
            // Global posts don't belong to a specific org
            organizationId = null;
        } else if (!organizationId) {
            return res.status(400).json({ error: 'Organization required' });
        }

        // Validate category against org's custom categories (skip for global posts)
        if (category && !isGlobal) {
            const validSlugs = await getValidCategorySlugs(organizationId);
            if (!validSlugs.includes(category)) {
                return res.status(400).json({ error: 'Invalid category' });
            }
        }

        // A post is a draft if explicitly flagged or if scheduled
        const isDraft = !!is_draft || !!scheduled_for;
        const scheduledTime = scheduled_for ? new Date(scheduled_for) : null;

        if (scheduledTime && scheduledTime <= new Date()) {
            return res.status(400).json({ error: 'Scheduled time must be in the future' });
        }

        // Only admins can require acknowledgment (not applicable for global posts)
        if (requires_ack && !isGlobal) {
            const admin = await isAdmin(req.userId, organizationId);
            if (!admin) {
                return res.status(403).json({ error: 'Only admins can require acknowledgment' });
            }
        }

        // Build INSERT conditionally based on whether the is_global column exists.
        // This keeps posts working if migration 063 hasn't been applied yet.
        const result = hasGlobal
            ? await pool.query(
                `INSERT INTO home_base_posts (organization_id, author_id, body, category, requires_ack, scheduled_for, is_draft, is_global)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING *`,
                [organizationId, req.userId, postBody, category || 'general', !!requires_ack, scheduledTime, isDraft, isGlobal]
            )
            : await pool.query(
                `INSERT INTO home_base_posts (organization_id, author_id, body, category, requires_ack, scheduled_for, is_draft)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [organizationId, req.userId, postBody, category || 'general', !!requires_ack, scheduledTime, isDraft]
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

        // Process @mentions (fire-and-forget) — skip for global posts (no single org context)
        if (!isGlobal) {
            const mentions = extractMentions(postBody);
            if (mentions.length > 0) {
                resolveMentions(mentions, organizationId, req.userId).then(ids => {
                    if (ids.length > 0) createMentionNotifications(ids, req.userId, organizationId, post.id, null);
                }).catch(() => {});
            }
        }

        // Log activity
        if (!isDraft && organizationId) logActivity(organizationId, req.userId, 'post', post.id);

        res.status(201).json({ post });
    } catch (error) {
        log.error('Failed to create home base post', { error: error.message, stack: error.stack });
        res.status(500).json({ error: `Failed to create post: ${error.message}` });
    }
});

/**
 * DELETE /api/home-base/posts/:id
 * Archive (soft-delete) a post. Only the original author OR an admin can archive.
 */
router.delete('/posts/:id', authenticate, async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const hasGlobal = await hasGlobalColumn();

        // Try to find the post: either in this org or as a global post (if column exists)
        const selectCols = hasGlobal ? 'author_id, is_global' : 'author_id, false AS is_global';
        const whereClause = hasGlobal
            ? 'id = $1 AND (organization_id = $2 OR is_global = true)'
            : 'id = $1 AND organization_id = $2';

        const postResult = await pool.query(
            `SELECT ${selectCols} FROM home_base_posts
             WHERE ${whereClause}
               AND COALESCE(archived, false) = false`,
            [req.params.id, organizationId]
        );

        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const post = postResult.rows[0];

        // Global posts: only super admins can delete
        if (post.is_global) {
            const superAdmin = await isSuperAdmin(req.userId);
            if (!superAdmin) {
                return res.status(403).json({ error: 'Only super admins can delete global posts' });
            }
        } else {
            const isAuthor = post.author_id === req.userId;
            const admin = await isAdmin(req.userId, organizationId);
            if (!isAuthor && !admin) {
                return res.status(403).json({ error: 'Not authorized to delete this post' });
            }
        }

        await pool.query(
            `UPDATE home_base_posts SET archived = true, archived_at = NOW(), archived_by = $2
             WHERE id = $1`,
            [req.params.id, req.userId]
        );

        res.json({ message: 'Post deleted' });
    } catch (error) {
        log.error('Failed to delete home base post', { error: error.message });
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
        const hasGlobal = await hasGlobalColumn();

        const selectCols = hasGlobal ? 'id, pinned, is_global' : 'id, pinned, false AS is_global';
        const whereClause = hasGlobal
            ? 'id = $1 AND (organization_id = $2 OR is_global = true)'
            : 'id = $1 AND organization_id = $2';

        // Check if this is a global post
        const postResult = await pool.query(
            `SELECT ${selectCols} FROM home_base_posts WHERE ${whereClause}`,
            [req.params.id, organizationId]
        );

        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const post = postResult.rows[0];

        // Global posts: only super admins can pin/unpin
        if (post.is_global) {
            const superAdmin = await isSuperAdmin(req.userId);
            if (!superAdmin) {
                return res.status(403).json({ error: 'Only super admins can pin global posts' });
            }
        } else {
            const admin = await isAdmin(req.userId, organizationId);
            if (!admin) {
                return res.status(403).json({ error: 'Admin access required' });
            }
        }

        const currentlyPinned = post.pinned;

        // If unpinning, just do it and reset pin_order
        if (currentlyPinned) {
            await pool.query(
                'UPDATE home_base_posts SET pinned = false, pin_order = 0, updated_at = NOW() WHERE id = $1',
                [req.params.id]
            );
            return res.json({ pinned: false });
        }

        // If pinning, check max limit (scoped to org + globals if column exists)
        const pinWhere = hasGlobal
            ? '(organization_id = $1 OR is_global = true) AND pinned = true'
            : 'organization_id = $1 AND pinned = true';
        const pinnedCount = await pool.query(
            `SELECT COUNT(*)::int AS count FROM home_base_posts WHERE ${pinWhere}`,
            [organizationId]
        );

        if (pinnedCount.rows[0].count >= MAX_PINNED) {
            return res.status(400).json({
                error: `Maximum ${MAX_PINNED} pinned posts allowed. Unpin one first.`,
                max_pinned: MAX_PINNED
            });
        }

        // Assign next pin_order
        const maxOrder = await pool.query(
            `SELECT COALESCE(MAX(pin_order), 0) + 1 AS next FROM home_base_posts WHERE ${pinWhere}`,
            [organizationId]
        );

        await pool.query(
            'UPDATE home_base_posts SET pinned = true, pin_order = $2, updated_at = NOW() WHERE id = $1',
            [req.params.id, maxOrder.rows[0].next]
        );

        res.json({ pinned: true, pin_order: maxOrder.rows[0].next });
    } catch (error) {
        log.error('Failed to toggle pin', { error: error.message });
        res.status(500).json({ error: 'Failed to toggle pin' });
    }
});

/**
 * PUT /api/home-base/posts/reorder-pins
 * Reorder pinned posts. Admin only. Body: { order: [postId1, postId2, ...] }
 */
router.put('/posts/reorder-pins', authenticate, async (req, res) => {
    try {
        const admin = await isAdmin(req.userId, req.organizationId);
        if (!admin) return res.status(403).json({ error: 'Admin access required' });

        const { order } = req.body;
        if (!Array.isArray(order) || order.length === 0) {
            return res.status(400).json({ error: 'Order array is required' });
        }

        // Update pin_order for each post
        for (let i = 0; i < order.length; i++) {
            await pool.query(
                'UPDATE home_base_posts SET pin_order = $1 WHERE id = $2 AND organization_id = $3 AND pinned = true',
                [i + 1, order[i], req.organizationId]
            );
        }

        res.json({ message: 'Pin order updated' });
    } catch (error) {
        log.error('Failed to reorder pins', { error: error.message });
        res.status(500).json({ error: 'Failed to reorder pins' });
    }
});

/**
 * GET /api/home-base/pin-limit
 * Returns the current max pinned post limit.
 */
router.get('/pin-limit', authenticate, async (req, res) => {
    res.json({ max_pinned: MAX_PINNED });
});

// ── Edit Post ─────────────────────────────────────────────────────────

/**
 * PATCH /api/home-base/posts/:id
 * Edit a post body. Author only, within 15 minute window.
 */
router.patch('/posts/:id', authenticate, [
    body('body').trim().notEmpty().withMessage('Post body is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const organizationId = req.organizationId;
        const hasGlobal = await hasGlobalColumn();

        const selectCols = hasGlobal ? 'author_id, created_at, is_global' : 'author_id, created_at, false AS is_global';
        const whereClause = hasGlobal
            ? 'id = $1 AND (organization_id = $2 OR is_global = true)'
            : 'id = $1 AND organization_id = $2';

        const postResult = await pool.query(
            `SELECT ${selectCols} FROM home_base_posts
             WHERE ${whereClause}
               AND COALESCE(archived, false) = false`,
            [req.params.id, organizationId]
        );

        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const post = postResult.rows[0];

        // Global posts: only super admins can edit (no time window)
        if (post.is_global) {
            const superAdmin = await isSuperAdmin(req.userId);
            if (!superAdmin) {
                return res.status(403).json({ error: 'Only super admins can edit global posts' });
            }
        } else {
            if (post.author_id !== req.userId) {
                return res.status(403).json({ error: 'Only the author can edit this post' });
            }
            const createdAt = new Date(post.created_at);
            if (Date.now() - createdAt.getTime() > EDIT_WINDOW_MS) {
                return res.status(400).json({ error: 'Edit window has expired (15 minutes)' });
            }
        }

        const result = await pool.query(
            `UPDATE home_base_posts SET body = $1, edited_at = NOW(), updated_at = NOW(),
                    search_vector = to_tsvector('english', $1)
             WHERE id = $2
             RETURNING *`,
            [req.body.body, req.params.id]
        );

        res.json({ post: result.rows[0] });
    } catch (error) {
        log.error('Failed to edit post', { error: error.message });
        res.status(500).json({ error: 'Failed to edit post' });
    }
});

// ── Archive / Restore ─────────────────────────────────────────────────

/**
 * PATCH /api/home-base/posts/:id/restore
 * Restore an archived post. Admin only.
 */
router.patch('/posts/:id/restore', authenticate, async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const admin = await isAdmin(req.userId, organizationId);
        if (!admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const result = await pool.query(
            `UPDATE home_base_posts SET archived = false, archived_at = NULL, archived_by = NULL
             WHERE id = $1 AND organization_id = $2 AND archived = true
             RETURNING id`,
            [req.params.id, organizationId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Archived post not found' });
        }

        res.json({ message: 'Post restored' });
    } catch (error) {
        log.error('Failed to restore post', { error: error.message });
        res.status(500).json({ error: 'Failed to restore post' });
    }
});

/**
 * GET /api/home-base/posts/archived
 * List archived posts. Admin only.
 */
router.get('/posts/archived', authenticate, async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const admin = await isAdmin(req.userId, organizationId);
        if (!admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const result = await pool.query(
            `SELECT p.id, p.body, p.category, p.created_at, p.archived_at,
                    u.first_name, u.last_name,
                    ab.first_name AS archived_by_first, ab.last_name AS archived_by_last
             FROM home_base_posts p
             JOIN users u ON u.id = p.author_id
             LEFT JOIN users ab ON ab.id = p.archived_by
             WHERE p.organization_id = $1 AND p.archived = true
             ORDER BY p.archived_at DESC`,
            [organizationId]
        );

        res.json({ posts: result.rows });
    } catch (error) {
        log.error('Failed to get archived posts', { error: error.message });
        res.status(500).json({ error: 'Failed to get archived posts' });
    }
});

// ── Attachments ───────────────────────────────────────────────────────

/**
 * POST /api/home-base/posts/:id/attachments
 * Upload a file attachment to a post. Author only. Max 3 attachments per post.
 */
router.post('/posts/:id/attachments', authenticate, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const organizationId = req.organizationId;
        const postResult = await pool.query(
            'SELECT author_id FROM home_base_posts WHERE id = $1 AND organization_id = $2 AND COALESCE(archived, false) = false',
            [req.params.id, organizationId]
        );

        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }

        if (postResult.rows[0].author_id !== req.userId) {
            return res.status(403).json({ error: 'Only the author can add attachments' });
        }

        // Check max attachments
        const countResult = await pool.query(
            'SELECT COUNT(*)::int AS count FROM home_base_attachments WHERE post_id = $1',
            [req.params.id]
        );
        if (countResult.rows[0].count >= 3) {
            return res.status(400).json({ error: 'Maximum 3 attachments per post' });
        }

        const result = await pool.query(
            `INSERT INTO home_base_attachments (post_id, file_name, file_type, file_size, file_data)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, file_name, file_type, file_size`,
            [req.params.id, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer]
        );

        res.status(201).json({ attachment: result.rows[0] });
    } catch (error) {
        log.error('Failed to upload attachment', { error: error.message });
        if (error.message && error.message.includes('File type not allowed')) {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: 'Failed to upload attachment' });
    }
});

/**
 * GET /api/home-base/attachments/:id
 * Download/view an attachment by ID.
 */
router.get('/attachments/:id', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT a.file_name, a.file_type, a.file_data, a.file_size
             FROM home_base_attachments a
             JOIN home_base_posts p ON p.id = a.post_id
             WHERE a.id = $1 AND p.organization_id = $2`,
            [req.params.id, req.organizationId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        const att = result.rows[0];
        res.setHeader('Content-Type', att.file_type);
        res.setHeader('Content-Disposition', `inline; filename="${att.file_name}"`);
        res.setHeader('Content-Length', att.file_size);
        res.send(att.file_data);
    } catch (error) {
        log.error('Failed to get attachment', { error: error.message });
        res.status(500).json({ error: 'Failed to get attachment' });
    }
});

/**
 * DELETE /api/home-base/attachments/:id
 * Delete an attachment. Author of the post only.
 */
router.delete('/attachments/:id', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `DELETE FROM home_base_attachments a
             USING home_base_posts p
             WHERE a.id = $1 AND a.post_id = p.id AND p.author_id = $2
             RETURNING a.id`,
            [req.params.id, req.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Attachment not found or not authorized' });
        }

        res.json({ message: 'Attachment deleted' });
    } catch (error) {
        log.error('Failed to delete attachment', { error: error.message });
        res.status(500).json({ error: 'Failed to delete attachment' });
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
            `SELECT c.id, c.body, c.created_at, c.author_id, c.reply_to_id,
                    u.first_name, u.last_name,
                    rc.reply_first_name, rc.reply_last_name, rc.reply_body
             FROM home_base_comments c
             JOIN users u ON u.id = c.author_id
             LEFT JOIN LATERAL (
                 SELECT parent.body AS reply_body, pu.first_name AS reply_first_name, pu.last_name AS reply_last_name
                 FROM home_base_comments parent
                 JOIN users pu ON pu.id = parent.author_id
                 WHERE parent.id = c.reply_to_id
             ) rc ON true
             WHERE c.post_id = $1
             ORDER BY c.created_at ASC`,
            [req.params.id]
        );

        // Batch-load comment reactions
        const commentIds = result.rows.map(c => c.id);
        let reactionsMap = {};
        if (commentIds.length > 0) {
            try {
                const reactResult = await pool.query(
                    `SELECT comment_id, emoji, COUNT(*)::int AS count,
                            bool_or(user_id = $2) AS me
                     FROM home_base_comment_reactions
                     WHERE comment_id = ANY($1)
                     GROUP BY comment_id, emoji
                     ORDER BY MIN(created_at)`,
                    [commentIds, req.userId]
                );
                for (const r of reactResult.rows) {
                    if (!reactionsMap[r.comment_id]) reactionsMap[r.comment_id] = [];
                    reactionsMap[r.comment_id].push({ emoji: r.emoji, count: r.count, me: r.me });
                }
            } catch (_e) { /* comment_reactions table may not exist yet */ }
        }

        const comments = result.rows.map(c => ({
            ...c,
            reactions: reactionsMap[c.id] || [],
            reply_to: c.reply_to_id ? {
                author_name: [c.reply_first_name, c.reply_last_name].filter(Boolean).join(' '),
                body: c.reply_body
            } : null
        }));

        // Clean up lateral join columns
        comments.forEach(c => {
            delete c.reply_first_name;
            delete c.reply_last_name;
            delete c.reply_body;
        });

        res.json({ comments });
    } catch (error) {
        log.error('Failed to get comments', { error: error.message });
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

        const replyToId = req.body.reply_to_id || null;

        const result = await pool.query(
            `INSERT INTO home_base_comments (post_id, author_id, body, reply_to_id)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [req.params.id, req.userId, req.body.body, replyToId]
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

        // Log activity
        logActivity(req.organizationId, req.userId, 'comment', req.params.id);

        // Process @mentions in comment (fire-and-forget)
        const mentions = extractMentions(req.body.body);
        if (mentions.length > 0) {
            resolveMentions(mentions, req.organizationId, req.userId).then(ids => {
                if (ids.length > 0) createMentionNotifications(ids, req.userId, req.organizationId, req.params.id, comment.id);
            }).catch(() => {});
        }

        res.status(201).json({ comment });
    } catch (error) {
        log.error('Failed to create comment', { error: error.message });
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
        log.error('Failed to delete comment', { error: error.message });
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
        log.error('Failed to get reactions', { error: error.message });
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

        logActivity(req.organizationId, req.userId, 'reaction', req.params.id);

        res.status(201).json({ toggled: true, emoji });
    } catch (error) {
        log.error('Failed to toggle reaction', { error: error.message });
        res.status(500).json({ error: 'Failed to toggle reaction' });
    }
});

// ── Comment Reactions ─────────────────────────────────────────────────

/**
 * POST /api/home-base/comments/:id/reactions
 * Toggle a reaction on a comment. Body: { emoji }
 */
router.post('/comments/:id/reactions', authenticate, [
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

        // Toggle off if already reacted
        const existing = await pool.query(
            'DELETE FROM home_base_comment_reactions WHERE comment_id = $1 AND user_id = $2 AND emoji = $3 RETURNING id',
            [req.params.id, req.userId, emoji]
        );

        if (existing.rows.length > 0) {
            return res.json({ toggled: false, emoji });
        }

        await pool.query(
            'INSERT INTO home_base_comment_reactions (comment_id, user_id, emoji) VALUES ($1, $2, $3)',
            [req.params.id, req.userId, emoji]
        );

        res.status(201).json({ toggled: true, emoji });
    } catch (error) {
        log.error('Failed to toggle comment reaction', { error: error.message });
        res.status(500).json({ error: 'Failed to toggle comment reaction' });
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
        ).catch(err => log.error('Failed to create mention notification', { error: err.message }));
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
    ).catch(err => log.error('Failed to create reply notification', { error: err.message }));
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
        log.error('Failed to get notifications', { error: error.message });
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
        log.error('Failed to get unread count', { error: error.message });
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
        log.error('Failed to mark notifications read', { error: error.message });
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

        const hasGlobal = await hasGlobalColumn();
        const globalSelect = hasGlobal ? 'COALESCE(p.is_global, false) AS is_global,' : 'false AS is_global,';
        const globalWhere = hasGlobal ? '(p.organization_id = $1 OR p.is_global = true)' : 'p.organization_id = $1';

        const result = await pool.query(
            `SELECT p.id, p.body, p.category, p.pinned, p.created_at, p.updated_at,
                    p.author_id, p.edited_at, ${globalSelect}
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
             WHERE ${globalWhere}
               AND COALESCE(p.archived, false) = false
               AND p.search_vector @@ plainto_tsquery('english', $2)
             ORDER BY rank DESC, p.created_at DESC
             LIMIT 50`,
            [organizationId, q]
        );

        res.json({ posts: result.rows });
    } catch (error) {
        log.error('Failed to search posts', { error: error.message });
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
        log.error('Failed to get members', { error: error.message });
        res.status(500).json({ error: 'Failed to get members' });
    }
});

// ── Acknowledgments ───────────────────────────────────────────────────

/**
 * POST /api/home-base/posts/:id/ack
 * Toggle acknowledgment on a post. Any authenticated user.
 */
router.post('/posts/:id/ack', authenticate, async (req, res) => {
    try {
        // Verify post requires ack and belongs to user's org
        const postCheck = await pool.query(
            'SELECT id, requires_ack FROM home_base_posts WHERE id = $1 AND organization_id = $2',
            [req.params.id, req.organizationId]
        );
        if (postCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }
        if (!postCheck.rows[0].requires_ack) {
            return res.status(400).json({ error: 'This post does not require acknowledgment' });
        }

        // Toggle: if already acked, remove; otherwise add
        const existing = await pool.query(
            'DELETE FROM home_base_acknowledgments WHERE post_id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId]
        );

        if (existing.rows.length > 0) {
            return res.json({ acked: false });
        }

        await pool.query(
            'INSERT INTO home_base_acknowledgments (post_id, user_id) VALUES ($1, $2)',
            [req.params.id, req.userId]
        );

        logActivity(req.organizationId, req.userId, 'ack', req.params.id);

        res.status(201).json({ acked: true });
    } catch (error) {
        log.error('Failed to toggle ack', { error: error.message });
        res.status(500).json({ error: 'Failed to acknowledge post' });
    }
});

/**
 * GET /api/home-base/posts/:id/acks
 * Get list of users who acknowledged a post. Admin only.
 */
router.get('/posts/:id/acks', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT ak.user_id, u.first_name, u.last_name, ak.created_at
             FROM home_base_acknowledgments ak
             JOIN users u ON u.id = ak.user_id
             WHERE ak.post_id = $1
             ORDER BY ak.created_at`,
            [req.params.id]
        );

        // Get total org members for progress
        const memCount = await pool.query(
            'SELECT COUNT(*)::int AS count FROM organization_memberships WHERE organization_id = $1',
            [req.organizationId]
        );

        res.json({
            acks: result.rows,
            total_members: memCount.rows[0].count
        });
    } catch (error) {
        log.error('Failed to get acks', { error: error.message });
        res.status(500).json({ error: 'Failed to get acknowledgments' });
    }
});

// ── Post Templates ────────────────────────────────────────────────────

/**
 * GET /api/home-base/templates
 * List all templates for the org.
 */
router.get('/templates', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT t.id, t.name, t.body, t.category, t.created_at,
                    u.first_name, u.last_name
             FROM home_base_templates t
             LEFT JOIN users u ON u.id = t.created_by
             WHERE t.organization_id = $1
             ORDER BY t.name`,
            [req.organizationId]
        );
        res.json({ templates: result.rows });
    } catch (error) {
        log.error('Failed to get templates', { error: error.message });
        res.status(500).json({ error: 'Failed to get templates' });
    }
});

/**
 * POST /api/home-base/templates
 * Create a new template. Body: { name, body, category }
 */
router.post('/templates', authenticate, [
    body('name').trim().notEmpty().withMessage('Template name is required'),
    body('body').trim().notEmpty().withMessage('Template body is required'),
    body('category').optional().isString()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const result = await pool.query(
            `INSERT INTO home_base_templates (organization_id, name, body, category, created_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [req.organizationId, req.body.name, req.body.body, req.body.category || 'general', req.userId]
        );

        res.status(201).json({ template: result.rows[0] });
    } catch (error) {
        log.error('Failed to create template', { error: error.message });
        res.status(500).json({ error: 'Failed to create template' });
    }
});

/**
 * PUT /api/home-base/templates/:id
 * Update a template.
 */
router.put('/templates/:id', authenticate, [
    body('name').trim().notEmpty().withMessage('Template name is required'),
    body('body').trim().notEmpty().withMessage('Template body is required'),
    body('category').optional().isString()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const result = await pool.query(
            `UPDATE home_base_templates SET name = $1, body = $2, category = $3, updated_at = NOW()
             WHERE id = $4 AND organization_id = $5
             RETURNING *`,
            [req.body.name, req.body.body, req.body.category || 'general', req.params.id, req.organizationId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Template not found' });
        }

        res.json({ template: result.rows[0] });
    } catch (error) {
        log.error('Failed to update template', { error: error.message });
        res.status(500).json({ error: 'Failed to update template' });
    }
});

/**
 * DELETE /api/home-base/templates/:id
 * Delete a template.
 */
router.delete('/templates/:id', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM home_base_templates WHERE id = $1 AND organization_id = $2 RETURNING id',
            [req.params.id, req.organizationId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Template not found' });
        }

        res.json({ message: 'Template deleted' });
    } catch (error) {
        log.error('Failed to delete template', { error: error.message });
        res.status(500).json({ error: 'Failed to delete template' });
    }
});

// ── Scheduled Posts ───────────────────────────────────────────────────

/**
 * GET /api/home-base/posts/scheduled
 * List all draft posts (both scheduled and unscheduled) for the current user.
 */
router.get('/posts/scheduled', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.id, p.body, p.category, p.requires_ack, p.scheduled_for, p.created_at, p.updated_at,
                    u.first_name, u.last_name
             FROM home_base_posts p
             JOIN users u ON u.id = p.author_id
             WHERE p.organization_id = $1 AND p.is_draft = true AND p.author_id = $2
               AND COALESCE(p.archived, false) = false
             ORDER BY COALESCE(p.scheduled_for, p.updated_at) ASC`,
            [req.organizationId, req.userId]
        );
        res.json({ posts: result.rows });
    } catch (error) {
        log.error('Failed to get scheduled posts', { error: error.message });
        res.status(500).json({ error: 'Failed to get scheduled posts' });
    }
});

/**
 * DELETE /api/home-base/posts/:id/schedule
 * Cancel a scheduled post (delete the draft).
 */
router.delete('/posts/:id/schedule', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM home_base_posts WHERE id = $1 AND author_id = $2 AND is_draft = true RETURNING id',
            [req.params.id, req.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Scheduled post not found' });
        }

        res.json({ message: 'Scheduled post cancelled' });
    } catch (error) {
        log.error('Failed to cancel scheduled post', { error: error.message });
        res.status(500).json({ error: 'Failed to cancel scheduled post' });
    }
});

// ── Draft Management ─────────────────────────────────────────────────

/**
 * PATCH /api/home-base/posts/:id/draft
 * Update a draft post (body, category). No time limit — drafts are always editable.
 */
router.patch('/posts/:id/draft', authenticate, [
    body('body').trim().notEmpty().withMessage('Post body is required'),
    body('category').optional().isString()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const postResult = await pool.query(
            'SELECT author_id, is_draft FROM home_base_posts WHERE id = $1 AND organization_id = $2',
            [req.params.id, req.organizationId]
        );

        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'Draft not found' });
        }
        if (postResult.rows[0].author_id !== req.userId) {
            return res.status(403).json({ error: 'Only the author can edit this draft' });
        }
        if (!postResult.rows[0].is_draft) {
            return res.status(400).json({ error: 'Post is not a draft' });
        }

        const updates = ['body = $1', 'updated_at = NOW()', "search_vector = to_tsvector('english', $1)"];
        const params = [req.body.body];
        let paramIdx = 2;

        if (req.body.category) {
            updates.push(`category = $${paramIdx}`);
            params.push(req.body.category);
            paramIdx++;
        }

        params.push(req.params.id, req.organizationId);
        const result = await pool.query(
            `UPDATE home_base_posts SET ${updates.join(', ')} WHERE id = $${paramIdx} AND organization_id = $${paramIdx + 1} RETURNING *`,
            params
        );

        res.json({ post: result.rows[0] });
    } catch (error) {
        log.error('Failed to update draft', { error: error.message });
        res.status(500).json({ error: 'Failed to update draft' });
    }
});

/**
 * POST /api/home-base/posts/:id/publish
 * Publish a draft post (set is_draft=false, update created_at to now).
 */
router.post('/posts/:id/publish', authenticate, async (req, res) => {
    try {
        const postResult = await pool.query(
            'SELECT author_id, is_draft, body, organization_id FROM home_base_posts WHERE id = $1 AND organization_id = $2',
            [req.params.id, req.organizationId]
        );

        if (postResult.rows.length === 0) {
            return res.status(404).json({ error: 'Draft not found' });
        }
        if (postResult.rows[0].author_id !== req.userId) {
            return res.status(403).json({ error: 'Only the author can publish this draft' });
        }
        if (!postResult.rows[0].is_draft) {
            return res.status(400).json({ error: 'Post is already published' });
        }

        const result = await pool.query(
            `UPDATE home_base_posts SET is_draft = false, scheduled_for = NULL, created_at = NOW(), updated_at = NOW()
             WHERE id = $1 RETURNING *`,
            [req.params.id]
        );

        const post = result.rows[0];

        // Process @mentions (fire-and-forget)
        const mentions = extractMentions(post.body);
        if (mentions.length > 0) {
            resolveMentions(mentions, req.organizationId, req.userId).then(ids => {
                if (ids.length > 0) createMentionNotifications(ids, req.userId, req.organizationId, post.id, null);
            }).catch(() => {});
        }

        logActivity(req.organizationId, req.userId, 'post', post.id);

        res.json({ post });
    } catch (error) {
        log.error('Failed to publish draft', { error: error.message });
        res.status(500).json({ error: 'Failed to publish draft' });
    }
});

// ── Post Views (Read Receipts / "Seen by") ──────────────────────────

/**
 * POST /api/home-base/posts/:id/view
 * Record that the current user viewed a post. Idempotent (UPSERT).
 */
router.post('/posts/:id/view', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `INSERT INTO home_base_post_views (post_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (post_id, user_id) DO UPDATE SET viewed_at = NOW()
             RETURNING (xmax = 0) AS is_new`,
            [req.params.id, req.userId]
        );
        // Only log first view, not re-views
        if (result.rows[0]?.is_new) {
            logActivity(req.organizationId, req.userId, 'view', req.params.id);
        }
        res.json({ viewed: true });
    } catch (error) {
        log.error('Failed to record view', { error: error.message });
        res.status(500).json({ error: 'Failed to record view' });
    }
});

/**
 * GET /api/home-base/posts/:id/views
 * Get list of users who have viewed a post with timestamps.
 */
router.get('/posts/:id/views', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT pv.user_id, u.first_name, u.last_name, pv.viewed_at
             FROM home_base_post_views pv
             JOIN users u ON u.id = pv.user_id
             WHERE pv.post_id = $1
             ORDER BY pv.viewed_at DESC`,
            [req.params.id]
        );

        const total = await pool.query(
            'SELECT COUNT(*)::int AS count FROM organization_memberships WHERE organization_id = $1',
            [req.organizationId]
        );

        res.json({
            views: result.rows,
            view_count: result.rows.length,
            total_members: total.rows[0].count
        });
    } catch (error) {
        log.error('Failed to get views', { error: error.message });
        res.status(500).json({ error: 'Failed to get views' });
    }
});

// ── Bookmarks ────────────────────────────────────────────────────────

/**
 * POST /api/home-base/posts/:id/bookmark
 * Toggle bookmark on a post. Returns { bookmarked: true/false }.
 */
router.post('/posts/:id/bookmark', authenticate, async (req, res) => {
    try {
        // Toggle: if already bookmarked, remove; otherwise add
        const existing = await pool.query(
            'DELETE FROM home_base_bookmarks WHERE post_id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId]
        );

        if (existing.rows.length > 0) {
            return res.json({ bookmarked: false });
        }

        await pool.query(
            'INSERT INTO home_base_bookmarks (post_id, user_id) VALUES ($1, $2)',
            [req.params.id, req.userId]
        );

        logActivity(req.organizationId, req.userId, 'bookmark', req.params.id);

        res.status(201).json({ bookmarked: true });
    } catch (error) {
        log.error('Failed to toggle bookmark', { error: error.message });
        res.status(500).json({ error: 'Failed to toggle bookmark' });
    }
});

/**
 * GET /api/home-base/bookmarks
 * List all bookmarked posts for the current user.
 */
router.get('/bookmarks', authenticate, async (req, res) => {
    try {
        const organizationId = req.organizationId;

        const result = await pool.query(
            `SELECT p.id, p.body, p.category, p.pinned, p.created_at, p.updated_at,
                    p.author_id, p.edited_at, p.requires_ack,
                    u.first_name, u.last_name,
                    COALESCE(c.comment_count, 0)::int AS comment_count,
                    b.created_at AS bookmarked_at
             FROM home_base_bookmarks b
             JOIN home_base_posts p ON p.id = b.post_id
             JOIN users u ON u.id = p.author_id
             LEFT JOIN (
                 SELECT post_id, COUNT(*) AS comment_count
                 FROM home_base_comments
                 GROUP BY post_id
             ) c ON c.post_id = p.id
             WHERE b.user_id = $1 AND p.organization_id = $2
               AND COALESCE(p.archived, false) = false
               AND COALESCE(p.is_draft, false) = false
             ORDER BY b.created_at DESC`,
            [req.userId, organizationId]
        );

        // Batch-load reactions
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
            } catch (_e) {}
        }

        const posts = result.rows.map(p => ({
            ...p,
            reactions: reactionsMap[p.id] || [],
            bookmarked: true
        }));

        res.json({ posts });
    } catch (error) {
        log.error('Failed to get bookmarks', { error: error.message });
        res.status(500).json({ error: 'Failed to get bookmarks' });
    }
});

// ── Activity Logging (fire-and-forget) ──────────────────────────────

function logActivity(organizationId, userId, action, postId) {
    pool.query(
        'INSERT INTO home_base_activity_log (organization_id, user_id, action, post_id) VALUES ($1, $2, $3, $4)',
        [organizationId, userId, action, postId || null]
    ).catch(() => {});
}

// ── Activity Feed (Admin only) ──────────────────────────────────────

/**
 * GET /api/home-base/activity?days=7
 * Returns engagement stats for the admin dashboard.
 */
router.get('/activity', authenticate, async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const admin = await isAdmin(req.userId, organizationId);
        if (!admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const days = Math.min(parseInt(req.query.days) || 7, 30);
        const since = new Date();
        since.setDate(since.getDate() - days);

        // Summary counts by action type
        const summaryResult = await pool.query(
            `SELECT action, COUNT(*)::int AS count
             FROM home_base_activity_log
             WHERE organization_id = $1 AND created_at >= $2
             GROUP BY action
             ORDER BY count DESC`,
            [organizationId, since]
        );

        // Daily activity trend
        const trendResult = await pool.query(
            `SELECT DATE(created_at) AS day, COUNT(*)::int AS count
             FROM home_base_activity_log
             WHERE organization_id = $1 AND created_at >= $2
             GROUP BY DATE(created_at)
             ORDER BY day`,
            [organizationId, since]
        );

        // Top contributors (most actions)
        const contributorsResult = await pool.query(
            `SELECT al.user_id, u.first_name, u.last_name, COUNT(*)::int AS actions
             FROM home_base_activity_log al
             JOIN users u ON u.id = al.user_id
             WHERE al.organization_id = $1 AND al.created_at >= $2
             GROUP BY al.user_id, u.first_name, u.last_name
             ORDER BY actions DESC
             LIMIT 10`,
            [organizationId, since]
        );

        // Most engaging posts (most reactions + comments)
        const topPostsResult = await pool.query(
            `SELECT al.post_id, p.body, u.first_name, u.last_name, COUNT(*)::int AS engagement
             FROM home_base_activity_log al
             JOIN home_base_posts p ON p.id = al.post_id
             JOIN users u ON u.id = p.author_id
             WHERE al.organization_id = $1 AND al.created_at >= $2
               AND al.action IN ('comment', 'reaction', 'ack')
               AND al.post_id IS NOT NULL
             GROUP BY al.post_id, p.body, u.first_name, u.last_name
             ORDER BY engagement DESC
             LIMIT 5`,
            [organizationId, since]
        );

        // Total org members for engagement rate
        const memberCount = await pool.query(
            'SELECT COUNT(*)::int AS count FROM organization_memberships WHERE organization_id = $1',
            [organizationId]
        );

        // Active users (users who did at least one action)
        const activeUsers = await pool.query(
            `SELECT COUNT(DISTINCT user_id)::int AS count
             FROM home_base_activity_log
             WHERE organization_id = $1 AND created_at >= $2`,
            [organizationId, since]
        );

        res.json({
            period_days: days,
            summary: summaryResult.rows,
            trend: trendResult.rows,
            top_contributors: contributorsResult.rows,
            top_posts: topPostsResult.rows,
            total_members: memberCount.rows[0].count,
            active_users: activeUsers.rows[0].count
        });
    } catch (error) {
        log.error('Failed to get activity feed', { error: error.message });
        res.status(500).json({ error: 'Failed to get activity feed' });
    }
});

// ── Digest Email Preferences ────────────────────────────────────────

/**
 * GET /api/home-base/digest
 * Returns current user's digest preference.
 */
router.get('/digest', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT frequency FROM home_base_digest_preferences WHERE user_id = $1 AND organization_id = $2',
            [req.userId, req.organizationId]
        );
        res.json({ frequency: result.rows[0]?.frequency || 'off' });
    } catch (error) {
        log.error('Failed to get digest pref', { error: error.message });
        res.status(500).json({ error: 'Failed to get digest preference' });
    }
});

/**
 * PUT /api/home-base/digest
 * Update digest preference. Body: { frequency: 'off' | 'daily' | 'weekly' }
 */
router.put('/digest', authenticate, [
    body('frequency').isIn(['off', 'daily', 'weekly']).withMessage('Invalid frequency')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        await pool.query(
            `INSERT INTO home_base_digest_preferences (user_id, organization_id, frequency)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, organization_id)
             DO UPDATE SET frequency = $3, updated_at = NOW()`,
            [req.userId, req.organizationId, req.body.frequency]
        );

        res.json({ frequency: req.body.frequency });
    } catch (error) {
        log.error('Failed to update digest pref', { error: error.message });
        res.status(500).json({ error: 'Failed to update digest preference' });
    }
});

// ── Scheduled Tasks ─────────────────────────────────────────────────

/**
 * Publish scheduled posts that are past their scheduled time.
 * Called on an interval from index.js (every 60 seconds).
 */
async function publishScheduledPosts() {
    try {
        const result = await pool.query(
            `UPDATE home_base_posts
             SET is_draft = false, created_at = NOW()
             WHERE is_draft = true AND scheduled_for IS NOT NULL AND scheduled_for <= NOW()
               AND COALESCE(archived, false) = false
             RETURNING id, organization_id, author_id, body`
        );

        if (result.rows.length > 0) {
            log.info(`[HOME BASE] Published ${result.rows.length} scheduled post(s)`);
        }
    } catch (error) {
        log.error('[HOME BASE] Failed to publish scheduled posts', { error: error.message });
    }
}

/**
 * Send digest emails. Called hourly from index.js.
 * Daily digests: sent at ~9 AM (checks last_sent_at > 20 hours ago)
 * Weekly digests: sent on Mondays at ~9 AM (checks last_sent_at > 6 days ago)
 */
async function sendDigestEmails() {
    const { sendEmail } = require('../services/email');
    const now = new Date();
    const hour = now.getUTCHours();

    // Only send between 13-15 UTC (~9 AM EST)
    if (hour < 13 || hour > 15) return;

    const isMonday = now.getUTCDay() === 1;

    try {
        // Get users who need a digest
        const dailyThreshold = new Date(now.getTime() - 20 * 60 * 60 * 1000); // 20 hours ago
        const weeklyThreshold = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000); // 6 days ago

        // Daily subscribers
        const dailySubs = await pool.query(
            `SELECT dp.user_id, dp.organization_id, u.email, u.first_name, o.name AS org_name
             FROM home_base_digest_preferences dp
             JOIN users u ON u.id = dp.user_id
             JOIN organizations o ON o.id = dp.organization_id
             WHERE dp.frequency = 'daily'
               AND (dp.last_sent_at IS NULL OR dp.last_sent_at < $1)`,
            [dailyThreshold]
        );

        // Weekly subscribers (only on Mondays)
        let weeklySubs = { rows: [] };
        if (isMonday) {
            weeklySubs = await pool.query(
                `SELECT dp.user_id, dp.organization_id, u.email, u.first_name, o.name AS org_name
                 FROM home_base_digest_preferences dp
                 JOIN users u ON u.id = dp.user_id
                 JOIN organizations o ON o.id = dp.organization_id
                 WHERE dp.frequency = 'weekly'
                   AND (dp.last_sent_at IS NULL OR dp.last_sent_at < $1)`,
                [weeklyThreshold]
            );
        }

        const allSubs = [...dailySubs.rows, ...weeklySubs.rows];
        if (allSubs.length === 0) return;

        for (const sub of allSubs) {
            try {
                const lookback = sub.frequency === 'weekly' ? 7 : 1;
                const since = new Date(now.getTime() - lookback * 24 * 60 * 60 * 1000);

                // Get recent posts
                const posts = await pool.query(
                    `SELECT p.body, p.category, p.created_at, u.first_name, u.last_name,
                            COALESCE(c.cnt, 0)::int AS comments, COALESCE(r.cnt, 0)::int AS reactions
                     FROM home_base_posts p
                     JOIN users u ON u.id = p.author_id
                     LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM home_base_comments GROUP BY post_id) c ON c.post_id = p.id
                     LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM home_base_reactions GROUP BY post_id) r ON r.post_id = p.id
                     WHERE p.organization_id = $1 AND p.created_at >= $2
                       AND COALESCE(p.archived, false) = false AND COALESCE(p.is_draft, false) = false
                     ORDER BY p.created_at DESC
                     LIMIT 15`,
                    [sub.organization_id, since]
                );

                if (posts.rows.length === 0) continue; // skip if nothing new

                const periodLabel = lookback === 7 ? 'this week' : 'today';
                const catLabels = { urgent: 'Urgent', fyi: 'FYI', draw_update: 'Draw Update', campaign: 'Campaign', general: 'General' };

                const postListHtml = posts.rows.map(p => {
                    const author = [p.first_name, p.last_name].filter(Boolean).join(' ');
                    const preview = (p.body || '').substring(0, 120) + ((p.body || '').length > 120 ? '...' : '');
                    const cat = catLabels[p.category] || 'General';
                    const stats = [];
                    if (p.comments > 0) stats.push(`${p.comments} comment${p.comments !== 1 ? 's' : ''}`);
                    if (p.reactions > 0) stats.push(`${p.reactions} reaction${p.reactions !== 1 ? 's' : ''}`);
                    return `<tr>
                        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9">
                            <div style="font-weight:600;font-size:13px;color:#1e293b">${author} <span style="font-weight:400;color:#94a3b8;font-size:12px">[${cat}]</span></div>
                            <div style="font-size:13px;color:#475569;margin-top:2px">${preview}</div>
                            ${stats.length ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px">${stats.join(' · ')}</div>` : ''}
                        </td>
                    </tr>`;
                }).join('');

                const html = `<!DOCTYPE html><html><head><style>body{font-family:Arial,sans-serif;margin:0;padding:0;background:#f8fafc}
                .wrap{max-width:600px;margin:0 auto;padding:20px}
                .card{background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0}
                .header{background:#1e293b;color:#fff;padding:20px 24px}
                .header h1{margin:0;font-size:18px;font-weight:600}
                .header p{margin:4px 0 0;font-size:13px;opacity:0.8}
                .footer{text-align:center;padding:16px;font-size:11px;color:#94a3b8}</style></head>
                <body><div class="wrap"><div class="card">
                <div class="header"><h1>Home Base Digest</h1><p>${posts.rows.length} new post${posts.rows.length !== 1 ? 's' : ''} ${periodLabel} in ${sub.org_name}</p></div>
                <table style="width:100%;border-collapse:collapse">${postListHtml}</table>
                </div><div class="footer">You're receiving this because you subscribed to ${lookback === 7 ? 'weekly' : 'daily'} digests. Log in to Home Base to change your preferences.</div></div></body></html>`;

                const text = `Home Base Digest — ${posts.rows.length} new post(s) ${periodLabel} in ${sub.org_name}. Log in to see the latest updates.`;

                await sendEmail({
                    to: sub.email,
                    subject: `Home Base: ${posts.rows.length} new post${posts.rows.length !== 1 ? 's' : ''} ${periodLabel}`,
                    text,
                    html
                });

                // Update last_sent_at
                await pool.query(
                    'UPDATE home_base_digest_preferences SET last_sent_at = NOW() WHERE user_id = $1 AND organization_id = $2',
                    [sub.user_id, sub.organization_id]
                );
            } catch (subErr) {
                log.error(`[HOME BASE DIGEST] Failed for user ${sub.user_id}:`, subErr.message);
            }
        }

        if (allSubs.length > 0) {
            log.info(`[HOME BASE DIGEST] Processed ${allSubs.length} digest subscriber(s)`);
        }
    } catch (error) {
        log.error('[HOME BASE DIGEST] Failed', { error: error.message });
    }
}

// Expose for interval setup in index.js
router.publishScheduledPosts = publishScheduledPosts;
router.sendDigestEmails = sendDigestEmails;
router.logActivity = logActivity;

module.exports = router;
