/**
 * Conversations Routes
 * Server-side conversation storage for Ask Lightspeed
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../../config/database');
const { authenticate } = require('../middleware/auth');
const claudeService = require('../services/claude');

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * GET /api/conversations
 * List user's conversations (most recent first)
 * Query params: ?search=term&limit=50&offset=0&team=true
 */
router.get('/', authenticate, async (req, res) => {
    try {
        const { search, limit = 50, offset = 0, team } = req.query;

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        const organizationId = orgResult.rows[0]?.organization_id;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        let sql, params;

        if (team === 'true') {
            // Team view: all conversations in the org
            sql = `SELECT c.id, c.title, c.tone, c.is_archived, c.created_at, c.updated_at,
                          c.user_id, u.first_name, u.last_name, u.picture,
                          jsonb_array_length(c.messages) as message_count
                   FROM conversations c
                   JOIN users u ON c.user_id = u.id
                   WHERE c.organization_id = $1 AND c.is_archived = FALSE`;
            params = [organizationId];
        } else {
            // Personal view: only user's conversations
            sql = `SELECT c.id, c.title, c.tone, c.is_archived, c.created_at, c.updated_at,
                          jsonb_array_length(c.messages) as message_count
                   FROM conversations c
                   WHERE c.organization_id = $1 AND c.user_id = $2 AND c.is_archived = FALSE`;
            params = [organizationId, req.userId];
        }

        if (search) {
            sql += ` AND (c.title ILIKE $${params.length + 1} OR c.messages::text ILIKE $${params.length + 1})`;
            params.push(`%${search}%`);
        }

        sql += ` ORDER BY c.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(sql, params);
        res.json({ conversations: result.rows });
    } catch (error) {
        console.error('List conversations error:', error);
        res.status(500).json({ error: 'Failed to list conversations' });
    }
});

/**
 * POST /api/conversations
 * Create a new conversation
 */
router.post('/', authenticate, [
    body('messages').isArray().withMessage('Messages array required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { messages, tone = 'professional', title } = req.body;

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        const organizationId = orgResult.rows[0]?.organization_id;
        if (!organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        // Auto-generate title from first user message if not provided
        let conversationTitle = title;
        if (!conversationTitle && messages.length > 0) {
            const firstUserMsg = messages.find(m => m.role === 'user');
            if (firstUserMsg) {
                conversationTitle = await generateTitle(firstUserMsg.content);
            }
        }

        const result = await pool.query(
            `INSERT INTO conversations (organization_id, user_id, title, messages, tone, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
             RETURNING *`,
            [organizationId, req.userId, conversationTitle || 'New conversation', JSON.stringify(messages), tone]
        );

        res.status(201).json({ conversation: result.rows[0] });
    } catch (error) {
        console.error('Create conversation error:', error);
        res.status(500).json({ error: 'Failed to create conversation' });
    }
});

/**
 * GET /api/conversations/:id
 * Get a single conversation with full messages
 */
router.get('/:id', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        const organizationId = orgResult.rows[0]?.organization_id;

        const result = await pool.query(
            `SELECT c.*, u.first_name, u.last_name, u.picture
             FROM conversations c
             JOIN users u ON c.user_id = u.id
             WHERE c.id = $1 AND c.organization_id = $2`,
            [req.params.id, organizationId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        res.json({ conversation: result.rows[0] });
    } catch (error) {
        console.error('Get conversation error:', error);
        res.status(500).json({ error: 'Failed to get conversation' });
    }
});

/**
 * PUT /api/conversations/:id
 * Update conversation (messages, title, tone, archive)
 */
router.put('/:id', authenticate, async (req, res) => {
    try {
        const { messages, title, tone, is_archived } = req.body;

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        const organizationId = orgResult.rows[0]?.organization_id;

        // Verify ownership
        const existing = await pool.query(
            'SELECT id, user_id FROM conversations WHERE id = $1 AND organization_id = $2',
            [req.params.id, organizationId]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        if (existing.rows[0].user_id !== req.userId) {
            return res.status(403).json({ error: 'Not your conversation' });
        }

        const updates = [];
        const params = [];
        let paramIdx = 1;

        if (messages !== undefined) {
            updates.push(`messages = $${paramIdx++}`);
            params.push(JSON.stringify(messages));
        }
        if (title !== undefined) {
            updates.push(`title = $${paramIdx++}`);
            params.push(title);
        }
        if (tone !== undefined) {
            updates.push(`tone = $${paramIdx++}`);
            params.push(tone);
        }
        if (is_archived !== undefined) {
            updates.push(`is_archived = $${paramIdx++}`);
            params.push(is_archived);
        }
        updates.push(`updated_at = NOW()`);

        params.push(req.params.id);
        params.push(organizationId);

        const result = await pool.query(
            `UPDATE conversations SET ${updates.join(', ')} WHERE id = $${paramIdx++} AND organization_id = $${paramIdx}
             RETURNING *`,
            params
        );

        res.json({ conversation: result.rows[0] });
    } catch (error) {
        console.error('Update conversation error:', error);
        res.status(500).json({ error: 'Failed to update conversation' });
    }
});

/**
 * DELETE /api/conversations/:id
 * Delete a conversation
 */
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        const organizationId = orgResult.rows[0]?.organization_id;

        const result = await pool.query(
            'DELETE FROM conversations WHERE id = $1 AND organization_id = $2 AND user_id = $3 RETURNING id',
            [req.params.id, organizationId, req.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        res.json({ deleted: true });
    } catch (error) {
        console.error('Delete conversation error:', error);
        res.status(500).json({ error: 'Failed to delete conversation' });
    }
});

/**
 * POST /api/conversations/:id/summarize
 * Summarize older messages in a conversation using Haiku.
 * Keeps the last `keepRecent` messages verbatim and summarizes the rest.
 */
router.post('/:id/summarize', authenticate, async (req, res) => {
    try {
        const { keepRecent = 6 } = req.body;

        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        const organizationId = orgResult.rows[0]?.organization_id;

        const convResult = await pool.query(
            'SELECT * FROM conversations WHERE id = $1 AND organization_id = $2 AND user_id = $3',
            [req.params.id, organizationId, req.userId]
        );

        if (convResult.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        const conv = convResult.rows[0];
        const messages = conv.messages || [];

        if (messages.length <= keepRecent) {
            return res.json({ summary: conv.summary, messages, summarized: false });
        }

        const olderMessages = messages.slice(0, messages.length - keepRecent);
        const recentMessages = messages.slice(messages.length - keepRecent);

        // Use Haiku to summarize older messages
        const conversationText = olderMessages
            .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n\n');

        const summaryResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: HAIKU_MODEL,
                max_tokens: 500,
                system: 'Summarize the following conversation concisely. Capture the key topics discussed, decisions made, content generated, and any important context. Keep it under 200 words. Return only the summary text.',
                messages: [{
                    role: 'user',
                    content: conversationText
                }]
            })
        });

        if (!summaryResponse.ok) {
            return res.status(500).json({ error: 'Failed to generate summary' });
        }

        const summaryData = await summaryResponse.json();
        const summaryText = summaryData.content?.[0]?.text || '';

        // Update conversation: store summary and keep only recent messages
        await pool.query(
            `UPDATE conversations SET summary = $1, messages = $2, updated_at = NOW()
             WHERE id = $3`,
            [summaryText, JSON.stringify(recentMessages), conv.id]
        );

        res.json({ summary: summaryText, messages: recentMessages, summarized: true });
    } catch (error) {
        console.error('Summarize conversation error:', error);
        res.status(500).json({ error: 'Failed to summarize conversation' });
    }
});

/**
 * POST /api/conversations/:id/title
 * Auto-generate a title for a conversation
 */
router.post('/:id/title', authenticate, async (req, res) => {
    try {
        const orgResult = await pool.query(
            'SELECT organization_id FROM organization_memberships WHERE user_id = $1 LIMIT 1',
            [req.userId]
        );
        const organizationId = orgResult.rows[0]?.organization_id;

        const convResult = await pool.query(
            'SELECT * FROM conversations WHERE id = $1 AND organization_id = $2 AND user_id = $3',
            [req.params.id, organizationId, req.userId]
        );

        if (convResult.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        const messages = convResult.rows[0].messages || [];
        const firstUserMsg = messages.find(m => m.role === 'user');
        if (!firstUserMsg) {
            return res.json({ title: 'New conversation' });
        }

        const title = await generateTitle(firstUserMsg.content);

        await pool.query(
            'UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2',
            [title, req.params.id]
        );

        res.json({ title });
    } catch (error) {
        console.error('Generate title error:', error);
        res.status(500).json({ error: 'Failed to generate title' });
    }
});

/**
 * Generate a short title from a message using Haiku
 */
async function generateTitle(messageText) {
    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: HAIKU_MODEL,
                max_tokens: 30,
                system: 'Generate a short title (3-6 words) for a conversation that starts with this message. Return ONLY the title text, nothing else. No quotes.',
                messages: [{
                    role: 'user',
                    content: messageText.substring(0, 200)
                }]
            })
        });

        if (!response.ok) {
            return messageText.substring(0, 50) + (messageText.length > 50 ? '...' : '');
        }

        const data = await response.json();
        return data.content?.[0]?.text?.trim() || messageText.substring(0, 50);
    } catch (e) {
        return messageText.substring(0, 50) + (messageText.length > 50 ? '...' : '');
    }
}

module.exports = router;
