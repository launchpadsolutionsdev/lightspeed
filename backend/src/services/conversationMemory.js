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
 * Provides cross-tool awareness so tools can reference drafts,
 * responses, and other work the user did recently.
 *
 * Enhanced: 72-hour window, excludes current tool, content type tags,
 * structured summaries with truncation.
 *
 * @param {string} organizationId - Organization UUID
 * @param {string} userId - Current user UUID
 * @param {object} options
 * @param {string} options.tool - Current tool name (to exclude from results)
 * @returns {Promise<string>} Context block to inject into system prompt
 */
async function getCrossToolContext(organizationId, userId, options = {}) {
    try {
        const currentTool = options.tool || 'ask_lightspeed';

        // Pull the last 8 responses from other tools in the past 72 hours
        const result = await pool.query(
            `SELECT tool, inquiry, response, format, tone, content_type, created_at
             FROM response_history
             WHERE organization_id = $1
               AND user_id = $2
               AND tool != $3
               AND created_at > NOW() - INTERVAL '72 hours'
             ORDER BY created_at DESC
             LIMIT 8`,
            [organizationId, userId, currentTool]
        );

        if (result.rows.length === 0) return '';

        const TOOL_LABELS = {
            response_assistant: 'Response Assistant',
            draft_assistant: 'Draft Assistant',
            insights_engine: 'Insights Engine',
            list_normalizer: 'List Normalizer',
            ask_lightspeed: 'Ask Lightspeed',
            content_generator: 'Content Generator'
        };

        let context = '\n\nRECENT ACTIVITY (your recent work across Lightspeed tools — reference for continuity):';

        for (let i = 0; i < result.rows.length; i++) {
            const entry = result.rows[i];
            const toolName = TOOL_LABELS[entry.tool] || entry.tool || 'Unknown Tool';
            const created = new Date(entry.created_at);
            const now = new Date();
            const hoursAgo = Math.round((now - created) / (1000 * 60 * 60));
            const timeLabel = hoursAgo < 1 ? 'just now' :
                              hoursAgo < 24 ? `${hoursAgo}h ago` :
                              `${Math.round(hoursAgo / 24)}d ago`;

            // Content type tag for relevance matching
            const typeTag = entry.content_type ? ` (${entry.content_type})` : '';

            // Truncate for token efficiency — longer excerpts for Ask Lightspeed context
            const maxInquiry = 200;
            const maxResponse = 250;
            const shortInquiry = (entry.inquiry || '').substring(0, maxInquiry);
            const shortResponse = (entry.response || '').substring(0, maxResponse);

            context += `\n${i + 1}. [${toolName}]${typeTag} ${timeLabel}:`;
            context += `\n   Topic: ${shortInquiry}${entry.inquiry?.length > maxInquiry ? '...' : ''}`;
            context += `\n   Output: ${shortResponse}${entry.response?.length > maxResponse ? '...' : ''}`;
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
