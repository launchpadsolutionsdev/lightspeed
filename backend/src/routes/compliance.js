/**
 * Compliance Tool Routes
 * AI-powered compliance assistant for charitable lottery operators
 * Provides jurisdiction-aware guidance on provincial regulations across Canada
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate, requireSuperAdmin, checkAIRateLimit, checkUsageLimit } = require('../middleware/auth');
const { streamResponse } = require('../services/claude');
const {
    buildComplianceSystemPrompt,
    buildDisclaimer,
    buildStaleWarning,
    buildWelcomeMessage,
    parseCitations,
    MANDATORY_REMINDER
} = require('../services/compliancePromptBuilder');
const log = require('../services/logger');

// ============================================================
// USER-FACING CHAT ENDPOINTS
// ============================================================

/**
 * POST /api/compliance/chat
 * Send a message to the Compliance Assistant
 */
router.post('/chat', authenticate, checkAIRateLimit, checkUsageLimit, async (req, res) => {
    try {
        const { conversation_id, jurisdiction_code, message } = req.body;
        const userId = req.userId;
        const organizationId = req.organizationId;

        if (!jurisdiction_code || !message) {
            return res.status(400).json({ error: 'jurisdiction_code and message are required' });
        }

        // Check if org has compliance enabled
        const orgResult = await pool.query(
            'SELECT compliance_enabled FROM organizations WHERE id = $1',
            [organizationId]
        );
        if (!orgResult.rows[0]?.compliance_enabled && !req.user.is_super_admin) {
            return res.status(403).json({ error: 'Compliance tool is not enabled for your organization' });
        }

        // Get jurisdiction info
        const jurisResult = await pool.query(
            'SELECT * FROM compliance_jurisdictions WHERE code = $1 AND is_active = true',
            [jurisdiction_code]
        );
        if (jurisResult.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid or inactive jurisdiction' });
        }
        const jurisdiction = jurisResult.rows[0];

        // Get or create conversation
        let convId = conversation_id;
        if (!convId) {
            // Create new conversation
            const convResult = await pool.query(
                `INSERT INTO compliance_conversations (org_id, user_id, jurisdiction_code, title)
                 VALUES ($1, $2, $3, $4) RETURNING id`,
                [organizationId, userId, jurisdiction_code, message.substring(0, 200)]
            );
            convId = convResult.rows[0].id;
        } else {
            // Verify conversation belongs to user and has same jurisdiction
            const convCheck = await pool.query(
                'SELECT id, jurisdiction_code FROM compliance_conversations WHERE id = $1 AND user_id = $2',
                [convId, userId]
            );
            if (convCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Conversation not found' });
            }
            if (convCheck.rows[0].jurisdiction_code !== jurisdiction_code) {
                return res.status(400).json({ error: 'Cannot change jurisdiction mid-conversation' });
            }
        }

        // Save user message
        await pool.query(
            `INSERT INTO compliance_messages (conversation_id, role, content)
             VALUES ($1, 'user', $2)`,
            [convId, message]
        );

        // Get conversation history
        const historyResult = await pool.query(
            `SELECT role, content FROM compliance_messages
             WHERE conversation_id = $1 ORDER BY created_at ASC`,
            [convId]
        );

        // Get relevant knowledge base entries for this jurisdiction
        const kbResult = await pool.query(
            `SELECT * FROM compliance_knowledge_base
             WHERE jurisdiction_code = $1 AND is_active = true
             ORDER BY category, title`,
            [jurisdiction_code]
        );

        // Use keyword matching to find relevant entries
        const relevantEntries = findRelevantEntries(message, kbResult.rows, 10);

        // Build system prompt
        const systemPrompt = buildComplianceSystemPrompt({
            jurisdictionName: jurisdiction.name,
            regulatoryBody: jurisdiction.regulatory_body,
            regulatoryUrl: jurisdiction.regulatory_url,
            knowledgeEntries: relevantEntries
        });

        // Build messages array from conversation history
        const messages = historyResult.rows.map(msg => ({
            role: msg.role,
            content: msg.content
        }));

        // Set up SSE streaming
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });

        // Send conversation ID immediately
        res.write(`data: ${JSON.stringify({ type: 'conversation_id', conversation_id: convId })}\n\n`);

        let fullText = '';

        await streamResponse({
            messages,
            system: systemPrompt,
            max_tokens: 4096,
            onText: (text) => {
                fullText += text;
                res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
            },
            onDone: async ({ usage }) => {
                try {
                    // Parse citations from the response
                    const citedIds = parseCitations(fullText);

                    // Validate cited IDs exist in the knowledge base
                    let citedEntries = [];
                    if (citedIds.length > 0) {
                        const citedResult = await pool.query(
                            `SELECT id, title, source_name, source_url, source_section, last_verified_date, content, category
                             FROM compliance_knowledge_base
                             WHERE id = ANY($1) AND jurisdiction_code = $2 AND is_active = true`,
                            [citedIds, jurisdiction_code]
                        );
                        citedEntries = citedResult.rows;
                    }

                    // Ensure mandatory reminder is present
                    if (!fullText.includes(MANDATORY_REMINDER.substring(0, 50))) {
                        fullText += '\n\n' + MANDATORY_REMINDER;
                        res.write(`data: ${JSON.stringify({ type: 'text', text: '\n\n' + MANDATORY_REMINDER })}\n\n`);
                    }

                    // Build disclaimer
                    const latestVerified = citedEntries.length > 0
                        ? citedEntries.reduce((latest, e) => {
                            const d = new Date(e.last_verified_date || '2020-01-01');
                            return d > latest ? d : latest;
                        }, new Date('2020-01-01')).toISOString().split('T')[0]
                        : null;

                    const disclaimer = buildDisclaimer(
                        jurisdiction.regulatory_body,
                        jurisdiction.regulatory_url,
                        latestVerified
                    );

                    const staleWarning = buildStaleWarning(citedEntries, jurisdiction.regulatory_body);

                    // Build citation cards for the frontend
                    const citations = citedEntries.map((entry, i) => {
                        const now = new Date();
                        const verified = new Date(entry.last_verified_date || '2020-01-01');
                        const daysSince = Math.floor((now - verified) / (1000 * 60 * 60 * 24));

                        let freshness = 'current';
                        if (daysSince > 180) freshness = 'outdated';
                        else if (daysSince > 90) freshness = 'verify_recommended';

                        return {
                            index: i + 1,
                            knowledge_base_id: entry.id,
                            title: entry.title,
                            category: entry.category,
                            source_name: entry.source_name,
                            source_url: entry.source_url,
                            source_section: entry.source_section,
                            last_verified_date: entry.last_verified_date,
                            freshness,
                            excerpt: entry.content.substring(0, 500)
                        };
                    });

                    // Save assistant message
                    await pool.query(
                        `INSERT INTO compliance_messages (conversation_id, role, content, citations)
                         VALUES ($1, 'assistant', $2, $3)`,
                        [convId, fullText, JSON.stringify(citedIds)]
                    );

                    // Update conversation timestamp
                    await pool.query(
                        'UPDATE compliance_conversations SET updated_at = NOW() WHERE id = $1',
                        [convId]
                    );

                    // Log usage
                    await pool.query(
                        `INSERT INTO usage_logs (id, organization_id, user_id, tool, total_tokens, created_at)
                         VALUES (gen_random_uuid(), $1, $2, 'compliance', $3, NOW())`,
                        [organizationId, userId, (usage.input_tokens || 0) + (usage.output_tokens || 0)]
                    );

                    // Send metadata event
                    res.write(`data: ${JSON.stringify({
                        type: 'metadata',
                        citations,
                        disclaimer,
                        stale_warning: staleWarning,
                        usage
                    })}\n\n`);

                    res.write('data: [DONE]\n\n');
                    res.end();
                } catch (err) {
                    log.error('Error in compliance chat onDone', { error: err });
                    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to save response' })}\n\n`);
                    res.end();
                }
            }
        });
    } catch (error) {
        log.error('Compliance chat error', { error });
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to generate compliance response' });
        } else {
            res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
            res.end();
        }
    }
});

/**
 * GET /api/compliance/conversations
 * List user's past compliance conversations
 */
router.get('/conversations', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const result = await pool.query(
            `SELECT c.id, c.jurisdiction_code, c.title, c.created_at, c.updated_at,
                    j.name as jurisdiction_name, j.regulatory_body
             FROM compliance_conversations c
             JOIN compliance_jurisdictions j ON j.code = c.jurisdiction_code
             WHERE c.user_id = $1
             ORDER BY c.updated_at DESC
             LIMIT 50`,
            [userId]
        );
        res.json({ conversations: result.rows });
    } catch (error) {
        log.error('Error listing compliance conversations', { error });
        res.status(500).json({ error: 'Failed to list conversations' });
    }
});

/**
 * GET /api/compliance/conversations/:id
 * Get full conversation history with citations
 */
router.get('/conversations/:id', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const convId = req.params.id;

        // Verify ownership
        const convResult = await pool.query(
            `SELECT c.*, j.name as jurisdiction_name, j.regulatory_body, j.regulatory_url
             FROM compliance_conversations c
             JOIN compliance_jurisdictions j ON j.code = c.jurisdiction_code
             WHERE c.id = $1 AND c.user_id = $2`,
            [convId, userId]
        );
        if (convResult.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        const conversation = convResult.rows[0];

        // Get messages
        const messagesResult = await pool.query(
            `SELECT id, role, content, citations, created_at
             FROM compliance_messages WHERE conversation_id = $1
             ORDER BY created_at ASC`,
            [convId]
        );

        // For each assistant message with citations, fetch the cited KB entries
        const messages = [];
        for (const msg of messagesResult.rows) {
            const msgData = {
                id: msg.id,
                role: msg.role,
                content: msg.content,
                created_at: msg.created_at,
                citations: []
            };

            if (msg.role === 'assistant' && msg.citations && msg.citations.length > 0) {
                const citedResult = await pool.query(
                    `SELECT id, title, category, source_name, source_url, source_section, last_verified_date, content
                     FROM compliance_knowledge_base WHERE id = ANY($1) AND is_active = true`,
                    [msg.citations]
                );

                const now = new Date();
                msgData.citations = citedResult.rows.map((entry, i) => {
                    const verified = new Date(entry.last_verified_date || '2020-01-01');
                    const daysSince = Math.floor((now - verified) / (1000 * 60 * 60 * 24));
                    let freshness = 'current';
                    if (daysSince > 180) freshness = 'outdated';
                    else if (daysSince > 90) freshness = 'verify_recommended';

                    return {
                        index: i + 1,
                        knowledge_base_id: entry.id,
                        title: entry.title,
                        category: entry.category,
                        source_name: entry.source_name,
                        source_url: entry.source_url,
                        source_section: entry.source_section,
                        last_verified_date: entry.last_verified_date,
                        freshness,
                        excerpt: entry.content.substring(0, 500)
                    };
                });
            }

            messages.push(msgData);
        }

        res.json({ conversation, messages });
    } catch (error) {
        log.error('Error getting compliance conversation', { error });
        res.status(500).json({ error: 'Failed to get conversation' });
    }
});

/**
 * DELETE /api/compliance/conversations/:id
 * Delete a conversation
 */
router.delete('/conversations/:id', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM compliance_conversations WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        res.json({ success: true });
    } catch (error) {
        log.error('Error deleting compliance conversation', { error });
        res.status(500).json({ error: 'Failed to delete conversation' });
    }
});

/**
 * GET /api/compliance/jurisdictions
 * Get list of available jurisdictions (user-facing, shows active status)
 */
router.get('/jurisdictions', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT code, name, regulatory_body, regulatory_url, is_active, entry_count FROM compliance_jurisdictions ORDER BY name'
        );
        res.json({ jurisdictions: result.rows });
    } catch (error) {
        log.error('Error listing jurisdictions', { error });
        res.status(500).json({ error: 'Failed to list jurisdictions' });
    }
});

/**
 * GET /api/compliance/welcome
 * Get the welcome message for a jurisdiction
 */
router.get('/welcome', authenticate, async (req, res) => {
    try {
        const { jurisdiction_code } = req.query;
        if (!jurisdiction_code) {
            return res.status(400).json({ error: 'jurisdiction_code is required' });
        }

        const jurisResult = await pool.query(
            'SELECT * FROM compliance_jurisdictions WHERE code = $1 AND is_active = true',
            [jurisdiction_code]
        );
        if (jurisResult.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid or inactive jurisdiction' });
        }
        const jurisdiction = jurisResult.rows[0];

        // Get latest verified date
        const dateResult = await pool.query(
            `SELECT MAX(last_verified_date) as latest FROM compliance_knowledge_base
             WHERE jurisdiction_code = $1 AND is_active = true`,
            [jurisdiction_code]
        );
        const latestDate = dateResult.rows[0]?.latest
            ? new Date(dateResult.rows[0].latest).toISOString().split('T')[0]
            : 'N/A';

        const welcomeMessage = buildWelcomeMessage(
            jurisdiction.name,
            jurisdiction.regulatory_body,
            jurisdiction.regulatory_url,
            latestDate
        );

        res.json({
            message: welcomeMessage,
            jurisdiction: {
                code: jurisdiction.code,
                name: jurisdiction.name,
                regulatory_body: jurisdiction.regulatory_body,
                regulatory_url: jurisdiction.regulatory_url
            }
        });
    } catch (error) {
        log.error('Error getting welcome message', { error });
        res.status(500).json({ error: 'Failed to get welcome message' });
    }
});

// ============================================================
// SUPER ADMIN KNOWLEDGE BASE MANAGEMENT ENDPOINTS
// ============================================================

/**
 * GET /api/compliance/admin/entries
 * List compliance knowledge base entries (with filters)
 */
router.get('/admin/entries', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { jurisdiction, category, sort_by, sort_order, search } = req.query;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;

        let query = 'SELECT * FROM compliance_knowledge_base WHERE 1=1';
        const params = [];
        let paramCount = 0;

        if (jurisdiction) {
            paramCount++;
            query += ` AND jurisdiction_code = $${paramCount}`;
            params.push(jurisdiction);
        }
        if (category) {
            paramCount++;
            query += ` AND category = $${paramCount}`;
            params.push(category);
        }
        if (search) {
            paramCount++;
            query += ` AND (title ILIKE $${paramCount} OR content ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        // Count total
        const countResult = await pool.query(
            query.replace('SELECT *', 'SELECT COUNT(*)'),
            params
        );
        const total = parseInt(countResult.rows[0].count);

        // Sort
        const validSorts = ['title', 'category', 'last_verified_date', 'created_at', 'updated_at'];
        const sortField = validSorts.includes(sort_by) ? sort_by : 'updated_at';
        const sortDir = sort_order === 'asc' ? 'ASC' : 'DESC';
        query += ` ORDER BY ${sortField} ${sortDir}`;

        // Paginate
        paramCount++;
        query += ` LIMIT $${paramCount}`;
        params.push(limit);
        paramCount++;
        query += ` OFFSET $${paramCount}`;
        params.push(offset);

        const result = await pool.query(query, params);

        res.json({
            entries: result.rows,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        log.error('Error listing compliance KB entries', { error });
        res.status(500).json({ error: 'Failed to list entries' });
    }
});

/**
 * POST /api/compliance/admin/entries
 * Create a new compliance knowledge base entry
 */
router.post('/admin/entries', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const {
            jurisdiction_code, category, title, content,
            original_text, plain_summary,
            source_name, source_url, source_section,
            last_verified_date, verified_by, is_active
        } = req.body;

        // Accept either content directly or original_text + plain_summary
        const effectiveContent = content || [original_text, plain_summary].filter(Boolean).join('\n\n---\n\nPlain Language Summary:\n');

        if (!jurisdiction_code || !category || !title || (!effectiveContent && !original_text)) {
            return res.status(400).json({ error: 'jurisdiction_code, category, title, and content (or original_text) are required' });
        }

        // Get jurisdiction info
        const jurisResult = await pool.query(
            'SELECT name, regulatory_body FROM compliance_jurisdictions WHERE code = $1',
            [jurisdiction_code]
        );
        if (jurisResult.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid jurisdiction code' });
        }

        const result = await pool.query(
            `INSERT INTO compliance_knowledge_base
             (jurisdiction_code, jurisdiction_name, regulatory_body, category, title, content,
              original_text, plain_summary,
              source_name, source_url, source_section, last_verified_date, verified_by, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING *`,
            [
                jurisdiction_code, jurisResult.rows[0].name, jurisResult.rows[0].regulatory_body,
                category, title, effectiveContent,
                original_text || null, plain_summary || null,
                source_name || null, source_url || null, source_section || null,
                last_verified_date || new Date().toISOString().split('T')[0],
                verified_by || req.user.first_name || 'System',
                is_active !== false
            ]
        );

        // Update entry count
        await updateEntryCount(jurisdiction_code);

        res.status(201).json({ entry: result.rows[0] });
    } catch (error) {
        log.error('Error creating compliance KB entry', { error });
        res.status(500).json({ error: 'Failed to create entry' });
    }
});

/**
 * PUT /api/compliance/admin/entries/:id
 * Update a compliance knowledge base entry
 */
router.put('/admin/entries/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            jurisdiction_code, category, title, content,
            original_text, plain_summary,
            source_name, source_url, source_section, is_active, last_verified_date
        } = req.body;

        // Get current entry
        const current = await pool.query('SELECT * FROM compliance_knowledge_base WHERE id = $1', [id]);
        if (current.rows.length === 0) {
            return res.status(404).json({ error: 'Entry not found' });
        }

        const entry = current.rows[0];

        // If jurisdiction changed, get new jurisdiction info
        let jurisdictionName = entry.jurisdiction_name;
        let regulatoryBody = entry.regulatory_body;
        if (jurisdiction_code && jurisdiction_code !== entry.jurisdiction_code) {
            const jurisResult = await pool.query(
                'SELECT name, regulatory_body FROM compliance_jurisdictions WHERE code = $1',
                [jurisdiction_code]
            );
            if (jurisResult.rows.length === 0) {
                return res.status(400).json({ error: 'Invalid jurisdiction code' });
            }
            jurisdictionName = jurisResult.rows[0].name;
            regulatoryBody = jurisResult.rows[0].regulatory_body;
        }

        // Build effective content from original_text + plain_summary if provided
        const effectiveContent = content || (original_text ? [original_text, plain_summary].filter(Boolean).join('\n\n---\n\nPlain Language Summary:\n') : null);

        const result = await pool.query(
            `UPDATE compliance_knowledge_base SET
                jurisdiction_code = $1, jurisdiction_name = $2, regulatory_body = $3,
                category = $4, title = $5, content = $6,
                original_text = $7, plain_summary = $8,
                source_name = $9, source_url = $10, source_section = $11,
                is_active = $12, last_verified_date = $13, updated_at = NOW()
             WHERE id = $14 RETURNING *`,
            [
                jurisdiction_code || entry.jurisdiction_code,
                jurisdictionName,
                regulatoryBody,
                category || entry.category,
                title || entry.title,
                effectiveContent || entry.content,
                original_text !== undefined ? original_text : entry.original_text,
                plain_summary !== undefined ? plain_summary : entry.plain_summary,
                source_name !== undefined ? source_name : entry.source_name,
                source_url !== undefined ? source_url : entry.source_url,
                source_section !== undefined ? source_section : entry.source_section,
                is_active !== undefined ? is_active : entry.is_active,
                last_verified_date || entry.last_verified_date,
                id
            ]
        );

        // Update entry counts if jurisdiction changed
        if (jurisdiction_code && jurisdiction_code !== entry.jurisdiction_code) {
            await updateEntryCount(entry.jurisdiction_code);
            await updateEntryCount(jurisdiction_code);
        } else {
            await updateEntryCount(result.rows[0].jurisdiction_code);
        }

        res.json({ entry: result.rows[0] });
    } catch (error) {
        log.error('Error updating compliance KB entry', { error });
        res.status(500).json({ error: 'Failed to update entry' });
    }
});

/**
 * DELETE /api/compliance/admin/entries/:id
 * Soft-delete a compliance knowledge base entry (sets is_active to false)
 */
router.delete('/admin/entries/:id', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE compliance_knowledge_base SET is_active = false, updated_at = NOW()
             WHERE id = $1 RETURNING jurisdiction_code`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Entry not found' });
        }
        await updateEntryCount(result.rows[0].jurisdiction_code);
        res.json({ success: true });
    } catch (error) {
        log.error('Error deleting compliance KB entry', { error });
        res.status(500).json({ error: 'Failed to delete entry' });
    }
});

/**
 * POST /api/compliance/admin/entries/:id/verify
 * Mark an entry as verified (update last_verified_date to now)
 */
router.post('/admin/entries/:id/verify', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE compliance_knowledge_base
             SET last_verified_date = CURRENT_DATE, verified_by = $1, updated_at = NOW()
             WHERE id = $2 RETURNING *`,
            [req.user.first_name || 'System', req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Entry not found' });
        }
        res.json({ entry: result.rows[0] });
    } catch (error) {
        log.error('Error verifying compliance KB entry', { error });
        res.status(500).json({ error: 'Failed to verify entry' });
    }
});

/**
 * POST /api/compliance/admin/entries/bulk-verify
 * Bulk-verify multiple entries
 */
router.post('/admin/entries/bulk-verify', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { entry_ids } = req.body;
        if (!entry_ids || !Array.isArray(entry_ids) || entry_ids.length === 0) {
            return res.status(400).json({ error: 'entry_ids array is required' });
        }

        const result = await pool.query(
            `UPDATE compliance_knowledge_base
             SET last_verified_date = CURRENT_DATE, verified_by = $1, updated_at = NOW()
             WHERE id = ANY($2) RETURNING id`,
            [req.user.first_name || 'System', entry_ids]
        );

        res.json({ updated: result.rowCount });
    } catch (error) {
        log.error('Error bulk-verifying compliance KB entries', { error });
        res.status(500).json({ error: 'Failed to bulk verify' });
    }
});

/**
 * POST /api/compliance/admin/entries/bulk-deactivate
 * Bulk-deactivate multiple entries
 */
router.post('/admin/entries/bulk-deactivate', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { entry_ids } = req.body;
        if (!entry_ids || !Array.isArray(entry_ids) || entry_ids.length === 0) {
            return res.status(400).json({ error: 'entry_ids array is required' });
        }

        const result = await pool.query(
            `UPDATE compliance_knowledge_base
             SET is_active = false, updated_at = NOW()
             WHERE id = ANY($1) RETURNING jurisdiction_code`,
            [entry_ids]
        );

        // Update entry counts for affected jurisdictions
        const codes = [...new Set(result.rows.map(r => r.jurisdiction_code))];
        for (const code of codes) {
            await updateEntryCount(code);
        }

        res.json({ updated: result.rowCount });
    } catch (error) {
        log.error('Error bulk-deactivating compliance KB entries', { error });
        res.status(500).json({ error: 'Failed to bulk deactivate' });
    }
});

/**
 * POST /api/compliance/admin/entries/bulk-import
 * Bulk-import multiple entries at once (for populating from PDF processing)
 */
router.post('/admin/entries/bulk-import', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { entries } = req.body;
        if (!entries || !Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ error: 'entries array is required' });
        }

        const imported = [];
        const errors = [];

        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            try {
                if (!e.jurisdiction_code || !e.category || !e.title || (!e.content && !e.original_text)) {
                    errors.push({ index: i, title: e.title, error: 'Missing required fields' });
                    continue;
                }

                // Get jurisdiction info
                const jurisResult = await pool.query(
                    'SELECT name, regulatory_body FROM compliance_jurisdictions WHERE code = $1',
                    [e.jurisdiction_code]
                );
                if (jurisResult.rows.length === 0) {
                    errors.push({ index: i, title: e.title, error: 'Invalid jurisdiction code' });
                    continue;
                }

                const effectiveContent = e.content || [e.original_text, e.plain_summary].filter(Boolean).join('\n\n---\n\nPlain Language Summary:\n');

                const result = await pool.query(
                    `INSERT INTO compliance_knowledge_base
                     (jurisdiction_code, jurisdiction_name, regulatory_body, category, title, content,
                      original_text, plain_summary,
                      source_name, source_url, source_section, last_verified_date, verified_by, is_active)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                     RETURNING id, title`,
                    [
                        e.jurisdiction_code, jurisResult.rows[0].name, jurisResult.rows[0].regulatory_body,
                        e.category, e.title, effectiveContent,
                        e.original_text || null, e.plain_summary || null,
                        e.source_name || null, e.source_url || null, e.source_section || null,
                        e.last_verified_date || new Date().toISOString().split('T')[0],
                        e.verified_by || req.user.first_name || 'System',
                        e.is_active !== false
                    ]
                );
                imported.push(result.rows[0]);
            } catch (entryErr) {
                errors.push({ index: i, title: e.title, error: entryErr.message });
            }
        }

        // Update entry counts for affected jurisdictions
        const codes = [...new Set(entries.map(e => e.jurisdiction_code).filter(Boolean))];
        for (const code of codes) {
            await updateEntryCount(code);
        }

        res.json({
            imported: imported.length,
            errors: errors.length,
            imported_entries: imported,
            error_details: errors
        });
    } catch (error) {
        log.error('Error bulk-importing compliance KB entries', { error });
        res.status(500).json({ error: 'Failed to bulk import' });
    }
});

/**
 * GET /api/compliance/admin/jurisdictions
 * List all jurisdictions for admin management
 */
router.get('/admin/jurisdictions', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM compliance_jurisdictions ORDER BY name'
        );
        res.json({ jurisdictions: result.rows });
    } catch (error) {
        log.error('Error listing jurisdictions for admin', { error });
        res.status(500).json({ error: 'Failed to list jurisdictions' });
    }
});

/**
 * PUT /api/compliance/admin/jurisdictions/:code
 * Activate or deactivate a jurisdiction
 */
router.put('/admin/jurisdictions/:code', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const { is_active } = req.body;
        const result = await pool.query(
            `UPDATE compliance_jurisdictions SET is_active = $1, updated_at = NOW()
             WHERE code = $2 RETURNING *`,
            [is_active, req.params.code]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Jurisdiction not found' });
        }
        res.json({ jurisdiction: result.rows[0] });
    } catch (error) {
        log.error('Error updating jurisdiction', { error });
        res.status(500).json({ error: 'Failed to update jurisdiction' });
    }
});

/**
 * GET /api/compliance/admin/dashboard
 * Get overview stats for the compliance admin dashboard
 */
router.get('/admin/dashboard', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        // Total entries by jurisdiction
        const byJurisdiction = await pool.query(
            `SELECT jurisdiction_code, jurisdiction_name, COUNT(*) as total,
                    COUNT(*) FILTER (WHERE is_active) as active
             FROM compliance_knowledge_base
             GROUP BY jurisdiction_code, jurisdiction_name
             ORDER BY jurisdiction_name`
        );

        // Entries needing verification (90+ days)
        const needsVerification = await pool.query(
            `SELECT COUNT(*) FROM compliance_knowledge_base
             WHERE is_active = true AND last_verified_date < CURRENT_DATE - INTERVAL '90 days'`
        );

        // Critically overdue (180+ days)
        const criticallyOverdue = await pool.query(
            `SELECT COUNT(*) FROM compliance_knowledge_base
             WHERE is_active = true AND last_verified_date < CURRENT_DATE - INTERVAL '180 days'`
        );

        // Recently updated
        const recentlyUpdated = await pool.query(
            `SELECT id, title, category, jurisdiction_code, updated_at
             FROM compliance_knowledge_base
             ORDER BY updated_at DESC LIMIT 10`
        );

        // Total active entries
        const totalActive = await pool.query(
            'SELECT COUNT(*) FROM compliance_knowledge_base WHERE is_active = true'
        );

        res.json({
            total_active: parseInt(totalActive.rows[0].count),
            by_jurisdiction: byJurisdiction.rows,
            needs_verification: parseInt(needsVerification.rows[0].count),
            critically_overdue: parseInt(criticallyOverdue.rows[0].count),
            recently_updated: recentlyUpdated.rows
        });
    } catch (error) {
        log.error('Error getting compliance dashboard', { error });
        res.status(500).json({ error: 'Failed to get dashboard data' });
    }
});

/**
 * GET /api/compliance/admin/categories
 * List all unique categories used in the knowledge base
 */
router.get('/admin/categories', authenticate, requireSuperAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT DISTINCT category FROM compliance_knowledge_base ORDER BY category'
        );
        res.json({ categories: result.rows.map(r => r.category) });
    } catch (error) {
        log.error('Error listing categories', { error });
        res.status(500).json({ error: 'Failed to list categories' });
    }
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Find the most relevant knowledge base entries for a query using keyword matching
 * @param {string} query - User's question
 * @param {Array} entries - All KB entries for the jurisdiction
 * @param {number} maxEntries - Maximum entries to return
 * @returns {Array} Sorted relevant entries
 */
function findRelevantEntries(query, entries, maxEntries = 10) {
    if (!entries || entries.length === 0) return [];
    if (entries.length <= maxEntries) return entries;

    const queryLower = query.toLowerCase();
    const queryTokens = queryLower
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2);

    const scored = entries.map(entry => {
        let score = 0;
        const titleLower = entry.title.toLowerCase();
        const contentLower = entry.content.toLowerCase();
        const categoryLower = entry.category.toLowerCase();

        // Exact phrase match in title (highest signal)
        if (titleLower.includes(queryLower)) score += 10;

        // Category match
        for (const token of queryTokens) {
            if (categoryLower.includes(token)) score += 3;
        }

        // Title keyword matches
        for (const token of queryTokens) {
            if (titleLower.includes(token)) score += 5;
        }

        // Content keyword matches
        for (const token of queryTokens) {
            if (contentLower.includes(token)) score += 2;
        }

        return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxEntries).map(s => s.entry);
}

/**
 * Update the cached entry count for a jurisdiction
 */
async function updateEntryCount(jurisdictionCode) {
    try {
        await pool.query(
            `UPDATE compliance_jurisdictions SET entry_count = (
                SELECT COUNT(*) FROM compliance_knowledge_base
                WHERE jurisdiction_code = $1 AND is_active = true
             ), updated_at = NOW()
             WHERE code = $1`,
            [jurisdictionCode]
        );
    } catch (error) {
        log.error('Error updating entry count', { error, jurisdictionCode });
    }
}

module.exports = router;
