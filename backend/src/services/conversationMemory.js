/**
 * Conversation Memory & Cross-Tool Context Service
 *
 * Provides org-level conversation memory (team-wide past conversations)
 * and cross-tool activity context for Ask Lightspeed prompt injection.
 */

const pool = require('../../config/database');

let embedQuery, formatForPgvector;
try {
    const embeddingService = require('./embeddingService');
    embedQuery = embeddingService.embedQuery;
    formatForPgvector = embeddingService.formatForPgvector;
} catch (_e) {
    // Embedding service not available — semantic search will be skipped
}

/**
 * Retrieve relevant past conversations for org-level memory.
 * Uses a 3-tier search: semantic (embeddings) → FTS → recent fallback.
 */
async function getConversationMemory(inquiry, organizationId, userId) {
    try {
        let conversations = [];

        // Tier 1: Semantic search via embeddings on summaries
        if (inquiry && embedQuery) {
            try {
                const queryEmbedding = await embedQuery(inquiry);
                if (queryEmbedding) {
                    const pgVector = formatForPgvector(queryEmbedding);
                    const semanticResult = await pool.query(
                        `SELECT id, title, summary, user_id, updated_at,
                                summary_embedding <=> $2::vector AS distance
                         FROM conversations
                         WHERE organization_id = $1
                           AND is_archived = FALSE
                           AND summary_embedding IS NOT NULL
                         ORDER BY distance ASC
                         LIMIT 8`,
                        [organizationId, pgVector]
                    );
                    // Only keep results with reasonable similarity (distance < 0.8)
                    conversations = semanticResult.rows.filter(r => r.distance < 0.8);
                }
            } catch (_e) {
                // summary_embedding column may not exist — fall through to FTS
            }
        }

        // Tier 2: Full-text search for relevance-ranked results
        if (conversations.length === 0 && inquiry) {
            try {
                const ftsResult = await pool.query(
                    `SELECT id, title, summary, user_id, updated_at,
                            ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank
                     FROM conversations
                     WHERE organization_id = $1
                       AND is_archived = FALSE
                       AND search_vector @@ plainto_tsquery('english', $2)
                     ORDER BY rank DESC
                     LIMIT 10`,
                    [organizationId, inquiry]
                );
                conversations = ftsResult.rows;
            } catch (_e) {
                // search_vector column may not exist yet
            }
        }

        // Tier 3: Fall back to recent conversations with summaries
        if (conversations.length === 0) {
            const recentResult = await pool.query(
                `SELECT id, title, summary, user_id, updated_at
                 FROM conversations
                 WHERE organization_id = $1
                   AND is_archived = FALSE
                   AND (summary IS NOT NULL OR title IS NOT NULL)
                 ORDER BY updated_at DESC
                 LIMIT 10`,
                [organizationId]
            );
            conversations = recentResult.rows;
        }

        if (conversations.length === 0) return '';

        const entries = conversations.slice(0, 8);
        let memoryContext = '\n\nCONVERSATION MEMORY (previous discussions from your organization — use for continuity and context when relevant):';

        for (let i = 0; i < entries.length; i++) {
            const conv = entries[i];
            const isOwn = conv.user_id === userId;
            const who = isOwn ? 'You' : 'A team member';
            const dateStr = conv.updated_at
                ? new Date(conv.updated_at).toLocaleDateString('en-CA')
                : 'recently';
            memoryContext += `\n${i + 1}. [${dateStr}] ${who} discussed: "${conv.title || 'Untitled conversation'}"`;
            if (conv.summary) {
                const truncatedSummary = conv.summary.length > 300
                    ? conv.summary.substring(0, 300) + '...'
                    : conv.summary;
                memoryContext += `\n   Summary: ${truncatedSummary}`;
            }
        }

        return memoryContext;
    } catch (err) {
        console.warn('Conversation memory retrieval failed, continuing without:', err.message);
        return '';
    }
}

/**
 * Get recent activity across all Lightspeed tools for the current user.
 * Provides cross-tool awareness so Ask Lightspeed can reference drafts,
 * responses, and other work the user did recently.
 *
 * @param {string} organizationId - Organization UUID
 * @param {string} userId - Current user UUID
 * @returns {Promise<string>} Context block to inject into system prompt
 */
async function getCrossToolContext(organizationId, userId) {
    try {
        // Pull the last 5 responses from other tools in the past 24 hours
        const result = await pool.query(
            `SELECT tool, inquiry, response, format, tone, created_at
             FROM response_history
             WHERE organization_id = $1
               AND user_id = $2
               AND tool != 'ask_lightspeed'
               AND created_at > NOW() - INTERVAL '24 hours'
             ORDER BY created_at DESC
             LIMIT 5`,
            [organizationId, userId]
        );

        if (result.rows.length === 0) return '';

        const TOOL_LABELS = {
            response_assistant: 'Response Assistant',
            draft_assistant: 'Draft Assistant',
            insights_engine: 'Insights Engine',
            list_normalizer: 'List Normalizer',
            content_generator: 'Content Generator'
        };

        let context = '\n\nRECENT ACTIVITY (your recent work across Lightspeed tools — reference for continuity):';

        for (let i = 0; i < result.rows.length; i++) {
            const entry = result.rows[i];
            const toolName = TOOL_LABELS[entry.tool] || entry.tool || 'Unknown Tool';
            const timeStr = new Date(entry.created_at).toLocaleTimeString('en-CA', {
                hour: '2-digit', minute: '2-digit'
            });

            // Truncate for token efficiency
            const shortInquiry = (entry.inquiry || '').substring(0, 150);
            const shortResponse = (entry.response || '').substring(0, 200);

            context += `\n${i + 1}. [${toolName}] at ${timeStr}:`;
            context += `\n   Topic: ${shortInquiry}${entry.inquiry?.length > 150 ? '...' : ''}`;
            context += `\n   Output excerpt: ${shortResponse}${entry.response?.length > 200 ? '...' : ''}`;
        }

        return context;
    } catch (err) {
        console.warn('Cross-tool context retrieval failed, continuing without:', err.message);
        return '';
    }
}

module.exports = {
    getConversationMemory,
    getCrossToolContext
};
