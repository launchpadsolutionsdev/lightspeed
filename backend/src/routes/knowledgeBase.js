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
const multer = require('multer');
const mammoth = require('mammoth');
const auditLog = require('../services/auditLog');

// Configure multer for in-memory file uploads (max 10MB)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            file.originalname.endsWith('.docx')) {
            cb(null, true);
        } else {
            cb(new Error('Only .docx files are supported'));
        }
    }
});

/**
 * GET /api/knowledge-base
 * Get knowledge entries for user's organization with pagination.
 * Query params:
 *   ?type=support|internal (optional, returns all if omitted)
 *   ?page=1&limit=50       (optional, defaults to page 1, 50 per page)
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const { type } = req.query;

        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;

        let where = 'WHERE organization_id = $1';
        const params = [organizationId];
        let paramCount = 2;

        if (type && ['support', 'internal'].includes(type)) {
            where += ` AND kb_type = $${paramCount++}`;
            params.push(type);
        }

        // Get total count for pagination metadata
        const countResult = await pool.query(
            `SELECT COUNT(*) FROM knowledge_base ${where}`, params
        );
        const total = parseInt(countResult.rows[0].count);

        // Fetch page
        const dataParams = [...params, limit, offset];
        const result = await pool.query(
            `SELECT * FROM knowledge_base ${where} ORDER BY category, title LIMIT $${paramCount++} OFFSET $${paramCount}`,
            dataParams
        );

        res.json({
            entries: result.rows,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });

    } catch (error) {
        console.error('Get knowledge base error:', error);
        res.status(500).json({ error: 'Failed to get knowledge base' });
    }
});

/**
 * GET /api/knowledge-base/search
 * Search knowledge entries with pagination.
 * Query params: ?q=term&category=faqs&type=support&page=1&limit=50
 */
router.get('/search', authenticate, async (req, res) => {
    try {
        const { q, category } = req.query;

        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;

        const { type } = req.query;
        let where = `WHERE organization_id = $1`;
        const params = [organizationId];
        let paramCount = 2;

        if (type && ['support', 'internal'].includes(type)) {
            where += ` AND kb_type = $${paramCount}`;
            params.push(type);
            paramCount++;
        }

        if (q) {
            where += ` AND (title ILIKE $${paramCount} OR content ILIKE $${paramCount})`;
            params.push(`%${q}%`);
            paramCount++;
        }

        if (category && category !== 'all') {
            where += ` AND category = $${paramCount}`;
            params.push(category);
            paramCount++;
        }

        // Count
        const countResult = await pool.query(`SELECT COUNT(*) FROM knowledge_base ${where}`, params);
        const total = parseInt(countResult.rows[0].count);

        // Fetch page
        const dataParams = [...params, limit, offset];
        const result = await pool.query(
            `SELECT * FROM knowledge_base ${where} ORDER BY category, title LIMIT $${paramCount++} OFFSET $${paramCount}`,
            dataParams
        );

        res.json({
            entries: result.rows,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });

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
    body('category').notEmpty().withMessage('Category required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { title, content, category, tags, lottery, keywords, kb_type } = req.body;

        // Validate kb_type
        const validKbType = ['support', 'internal'].includes(kb_type) ? kb_type : 'support';

        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }
        const entryId = uuidv4();

        // Combine keywords and lottery into tags for storage
        const combinedTags = [...(tags || [])];
        if (lottery) combinedTags.push(`lottery:${lottery}`);
        if (keywords && keywords.length > 0) {
            keywords.forEach(k => combinedTags.push(`keyword:${k}`));
        }

        const result = await pool.query(
            `INSERT INTO knowledge_base (id, organization_id, title, content, category, tags, kb_type, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
             RETURNING *`,
            [entryId, organizationId, title, content, category, combinedTags, validKbType, req.userId]
        );

        auditLog.logAction({ orgId: organizationId, userId: req.userId, action: 'KB_ENTRY_CREATED', resourceType: 'KNOWLEDGE_BASE', resourceId: entryId, changes: { title, category }, req });
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

        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

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
    body('category').optional().notEmpty().withMessage('Category cannot be empty')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { id } = req.params;
        const { title, content, category, tags, kb_type } = req.body;

        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

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
        if (kb_type !== undefined && ['support', 'internal'].includes(kb_type)) {
            updates.push(`kb_type = $${paramCount++}`);
            values.push(kb_type);
        }

        // Optimistic concurrency check
        if (req.body.expected_updated_at) {
            const current = await pool.query('SELECT updated_at FROM knowledge_base WHERE id = $1 AND organization_id = $2', [id, organizationId]);
            if (current.rows.length > 0 && current.rows[0].updated_at?.toISOString() !== req.body.expected_updated_at) {
                return res.status(409).json({ error: 'conflict', message: 'This entry was modified by someone else. Please refresh and try again.' });
            }
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

        auditLog.logAction({ orgId: organizationId, userId: req.userId, action: 'KB_ENTRY_UPDATED', resourceType: 'KNOWLEDGE_BASE', resourceId: id, changes: { title, content: content?.substring(0, 100), category }, req });
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

        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const result = await pool.query(
            'DELETE FROM knowledge_base WHERE id = $1 AND organization_id = $2 RETURNING id, title',
            [id, organizationId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Entry not found' });
        }

        auditLog.logAction({ orgId: organizationId, userId: req.userId, action: 'KB_ENTRY_DELETED', resourceType: 'KNOWLEDGE_BASE', resourceId: id, changes: { title: result.rows[0].title }, req });
        res.json({ message: 'Entry deleted' });

    } catch (error) {
        console.error('Delete knowledge entry error:', error);
        res.status(500).json({ error: 'Failed to delete entry' });
    }
});

/**
 * POST /api/knowledge-base/from-feedback
 * Create a KB entry from user feedback on a bad response.
 * Links the entry back to the response_history record.
 */
router.post('/from-feedback', authenticate, async (req, res) => {
    try {
        const { responseHistoryId, title, content, category, force } = req.body;

        if (!title || !content) {
            return res.status(400).json({ error: 'Title and content are required' });
        }

        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        // --- Duplicate detection ---
        // Skip if the caller explicitly wants to force-create (e.g. user chose "Create anyway")
        if (!force) {
            // Check for existing entries with similar titles in the same org.
            const duplicateCheck = await pool.query(
                `SELECT id, title, content FROM knowledge_base
                 WHERE organization_id = $1 AND kb_type = 'support' AND title ILIKE $2
                 LIMIT 5`,
                [organizationId, `%${title.substring(0, 100)}%`]
            );

            if (duplicateCheck.rows.length > 0) {
                // Return the potential duplicates so the frontend can let the user decide
                return res.status(409).json({
                    error: 'duplicate_found',
                    message: 'Similar knowledge base entries already exist.',
                    duplicates: duplicateCheck.rows.map(d => ({ id: d.id, title: d.title, content: d.content.substring(0, 200) }))
                });
            }
        }

        const entryId = uuidv4();

        // Auto-extract keywords from the title (words > 3 chars)
        const autoKeywords = title.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 3)
            .slice(0, 8)
            .map(k => `keyword:${k}`);

        const tags = ['source:feedback', ...autoKeywords];

        const result = await pool.query(
            `INSERT INTO knowledge_base (id, organization_id, title, content, category, tags, kb_type, created_by, source_response_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'support', $7, $8, NOW(), NOW())
             RETURNING *`,
            [entryId, organizationId, title, content, category || 'faqs', tags, req.userId, responseHistoryId || null]
        );

        // Link the response_history record back to this KB entry via proper FK
        if (responseHistoryId) {
            try {
                await pool.query(
                    `UPDATE response_history SET feedback_kb_entry_id = $1
                     WHERE id = $2 AND organization_id = $3`,
                    [entryId, responseHistoryId, organizationId]
                );
            } catch (linkErr) {
                console.warn('Could not link KB entry to response history:', linkErr);
            }
        }

        res.status(201).json({ entry: result.rows[0] });

    } catch (error) {
        console.error('Create KB from feedback error:', error);
        res.status(500).json({ error: 'Failed to create knowledge base entry' });
    }
});

/**
 * POST /api/knowledge-base/import
 * Import multiple knowledge entries
 */
router.post('/import', authenticate, async (req, res) => {
    try {
        const { entries, kb_type } = req.body;
        const validKbType = ['support', 'internal'].includes(kb_type) ? kb_type : 'support';

        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ error: 'Entries array required' });
        }

        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

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
                    `INSERT INTO knowledge_base (id, organization_id, title, content, category, tags, kb_type, created_by, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
                     RETURNING *`,
                    [entryId, organizationId, entry.title, entry.content, entry.category, entry.tags || [], validKbType, req.userId]
                );
                imported.push(result.rows[0]);
            } catch (err) {
                errors.push({ entry, error: err.message });
            }
        }

        auditLog.logAction({ orgId: organizationId, userId: req.userId, action: 'KB_BULK_IMPORTED', resourceType: 'KNOWLEDGE_BASE', changes: { imported_count: imported.length, error_count: errors.length }, req });
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
        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const { type } = req.query;
        let sql = `SELECT title, content, category, tags, kb_type FROM knowledge_base WHERE organization_id = $1`;
        const params = [organizationId];

        if (type && ['support', 'internal'].includes(type)) {
            sql += ' AND kb_type = $2';
            params.push(type);
        }

        sql += ' ORDER BY category, title';

        const result = await pool.query(sql, params);

        res.json({ entries: result.rows });

    } catch (error) {
        console.error('Export knowledge base error:', error);
        res.status(500).json({ error: 'Failed to export entries' });
    }
});

/**
 * POST /api/knowledge-base/upload-doc
 * Upload a Word document (.docx) and parse it into knowledge base entries.
 * Splits on headings (H1/H2/H3) — each heading becomes a KB entry title,
 * and the text below it becomes the content.
 */
router.post('/upload-doc', authenticate, upload.single('document'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No .docx file uploaded' });
        }

        const organizationId = req.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        // Parse the Word document
        const result = await mammoth.convertToHtml({ buffer: req.file.buffer });
        const html = result.value;

        // Split on headings to create KB entries
        // Each heading becomes a title, the content below becomes the entry
        const entries = [];
        const headingRegex = /<h([1-3])[^>]*>(.*?)<\/h[1-3]>/gi;
        const parts = html.split(headingRegex);

        // parts array: [pre-heading text, level, title, content, level, title, content, ...]
        // If there's content before the first heading, capture it
        if (parts[0] && parts[0].trim().replace(/<[^>]*>/g, '').trim()) {
            entries.push({
                title: req.file.originalname.replace('.docx', ''),
                content: parts[0].replace(/<[^>]*>/g, '').trim()
            });
        }

        // Process heading/content pairs
        for (let i = 1; i < parts.length; i += 3) {
            const title = parts[i + 1] ? parts[i + 1].replace(/<[^>]*>/g, '').trim() : '';
            const content = parts[i + 2] ? parts[i + 2].replace(/<[^>]*>/g, '').trim() : '';
            if (title && content) {
                entries.push({ title, content });
            }
        }

        // If no headings were found, treat the entire document as one entry
        if (entries.length === 0) {
            const plainText = html.replace(/<[^>]*>/g, '').trim();
            if (plainText) {
                entries.push({
                    title: req.file.originalname.replace('.docx', ''),
                    content: plainText
                });
            }
        }

        // Insert all entries into the knowledge base
        const category = req.body.category || 'general';
        const kbType = ['support', 'internal'].includes(req.body.kb_type) ? req.body.kb_type : 'support';
        const imported = [];

        for (const entry of entries) {
            const entryId = uuidv4();
            const dbResult = await pool.query(
                `INSERT INTO knowledge_base (id, organization_id, title, content, category, tags, kb_type, created_by, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
                 RETURNING *`,
                [entryId, organizationId, entry.title, entry.content, category, ['imported', 'docx'], kbType, req.userId]
            );
            imported.push(dbResult.rows[0]);
        }

        auditLog.logAction({ orgId: organizationId, userId: req.userId, action: 'KB_DOC_UPLOADED', resourceType: 'KNOWLEDGE_BASE', changes: { filename: req.file.originalname, entries_created: imported.length }, req });
        res.json({
            message: `Successfully imported ${imported.length} entries from ${req.file.originalname}`,
            imported: imported.length,
            entries: imported
        });

    } catch (error) {
        console.error('Upload document error:', error);
        res.status(500).json({ error: error.message || 'Failed to process document' });
    }
});

module.exports = router;
