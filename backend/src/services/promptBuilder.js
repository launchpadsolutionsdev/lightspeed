/**
 * Prompt Builder Service
 *
 * Centralizes the shared logic that was previously duplicated between
 * /api/generate and /api/generate-stream: response rules injection,
 * KB relevance picking, Shopify context injection, conversation memory,
 * cross-tool context, and voice fingerprinting.
 */

const pool = require('../../config/database');
const claudeService = require('./claude');
const shopifyService = require('./shopify');
const { cache, TTL } = require('./cache');
const { truncateEntriesToBudget } = require('./tokenCounter');
const { getConversationMemory, getCrossToolContext } = require('./conversationMemory');
const { getVoiceProfileContext } = require('./voiceFingerprint');
const { embedQuery, formatForPgvector } = require('./embeddingService');
const { getBudgetAllocation } = require('./budgetAllocator');
const { fetchRelevantCorrections, buildCorrectionsContext } = require('./systemPromptBuilder');

/**
 * Inject organization-level response rules into the system prompt.
 * Rules are inserted before the "Knowledge base:" marker if present,
 * otherwise appended.
 */
async function injectResponseRules(system, organizationId) {
    try {
        const cacheKey = `rules:${organizationId}`;
        let rows = cache.get(cacheKey);
        if (rows === undefined) {
            const rulesResult = await pool.query(
                `SELECT rule_text, rule_type FROM response_rules
                 WHERE organization_id = $1 AND is_active = TRUE
                 ORDER BY sort_order, created_at`,
                [organizationId]
            );
            rows = rulesResult.rows;
            cache.set(cacheKey, rows, TTL.RESPONSE_RULES);
        }
        if (rows.length === 0) return system;

        const typeLabels = { always: 'ALWAYS', never: 'NEVER', formatting: 'FORMATTING', general: 'RULE' };
        const rulesBlock = rows
            .map((r, i) => `${i + 1}. [${typeLabels[r.rule_type] || 'RULE'}] ${r.rule_text}`)
            .join('\n');
        const rulesSection = `\n\nORGANIZATION RESPONSE RULES (you MUST follow these):\n${rulesBlock}\n`;

        if (system.includes('Knowledge base:')) {
            return system.replace('Knowledge base:', `${rulesSection}\nKnowledge base:`);
        }
        return system + rulesSection;
    } catch (err) {
        console.warn('Response rules injection failed, continuing without:', err.message);
        return system;
    }
}

/**
 * Fetch KB entries, use Haiku to pick the most relevant ones,
 * and inject them into the system prompt with citation support.
 *
 * @param {string} system - Current system prompt
 * @param {string} inquiry - Customer inquiry text
 * @param {string} organizationId - Organization UUID
 * @param {string} kbType - 'support' | 'internal' | 'all'
 * @param {object} options
 * @param {boolean} options.includeCitations - Whether to add citation instructions (default true)
 * @returns {{ system: string, entries: Array }}
 */
async function injectKnowledgeBase(system, inquiry, organizationId, kbType, options = {}) {
    const { includeCitations = true } = options;
    try {
        let kbFilter = "AND kb_type = 'support'";
        if (kbType === 'all') {
            kbFilter = '';
        } else if (kbType === 'internal') {
            kbFilter = "AND kb_type = 'internal'";
        }

        // Dynamic budget allocation based on inquiry complexity
        const { budgets } = getBudgetAllocation(inquiry);
        const kbTokenBudget = budgets.knowledgeBase;
        const maxEntries = budgets.maxKbEntries;

        // --- Strategy: try semantic search on chunks first, then FTS, then full fallback ---
        let kbRows;

        // Tier 1: Semantic search on chunks (best quality)
        kbRows = await semanticChunkSearch(inquiry, organizationId, kbFilter, maxEntries);

        // Tier 2: Full-text search on chunks
        if (kbRows.length === 0) {
            kbRows = await ftsChunkSearch(inquiry, organizationId, kbFilter);
        }

        // Tier 3: Full-text search on parent entries (original behavior)
        if (kbRows.length === 0) {
            try {
                const ftsResult = await pool.query(
                    `SELECT id, title, content, category, tags, updated_at,
                            ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank
                     FROM knowledge_base
                     WHERE organization_id = $1 ${kbFilter}
                       AND search_vector @@ plainto_tsquery('english', $2)
                     ORDER BY rank DESC
                     LIMIT 30`,
                    [organizationId, inquiry]
                );
                kbRows = ftsResult.rows;
            } catch (_e) {
                kbRows = [];
            }
        }

        // Tier 4: Load all entries with tag-match scoring (last resort)
        if (kbRows.length === 0) {
            const allResult = await pool.query(
                `SELECT id, title, content, category, tags, updated_at FROM knowledge_base WHERE organization_id = $1 ${kbFilter} ORDER BY category, title`,
                [organizationId]
            );
            if (allResult.rows.length > 30) {
                kbRows = claudeService.tagMatchFallback(inquiry, allResult.rows, 30);
            } else {
                kbRows = allResult.rows;
            }
        }

        if (kbRows.length === 0) return { system, entries: [] };

        // If we got chunks via semantic/FTS search, skip Haiku picking (already ranked)
        let relevantEntries;
        if (kbRows.length > 0 && kbRows[0]._fromSemanticSearch) {
            relevantEntries = kbRows.slice(0, maxEntries);
        } else {
            relevantEntries = await claudeService.pickRelevantKnowledge(
                inquiry,
                kbRows,
                maxEntries
            );
        }

        if (relevantEntries.length === 0) return { system, entries: [] };

        // Use dynamic budget instead of hardcoded 30000
        const budgetedEntries = truncateEntriesToBudget(relevantEntries, kbTokenBudget);

        const referencedKbEntries = budgetedEntries.map((entry, idx) => ({
            id: entry.id,
            title: entry.title,
            content: entry.content,
            category: entry.category,
            updated_at: entry.updated_at?.toISOString() || null,
            citation_index: idx + 1
        }));

        const knowledgeContext = budgetedEntries
            .map((entry, idx) => {
                const isCorrection = (entry.tags || []).some(t => t === 'source:feedback');
                const label = isCorrection ? 'CORRECTION' : entry.category;
                return `[Source ${idx + 1}] [${label}] ${entry.title}: ${entry.content}`;
            })
            .join('\n\n');

        let citationBlock = '';
        if (includeCitations) {
            citationBlock = '\n\nCITATION RULES: When your response uses information from the knowledge base sources above, include inline citations using the format [Source 1], [Source 2], etc. corresponding to the source numbers. Only cite when you directly use information from a specific source. Do not cite for general knowledge.';
        }

        let updatedSystem;
        if (system.includes('Knowledge base:')) {
            updatedSystem = system.replace(
                'Knowledge base:\n',
                `Knowledge base:\n\n${knowledgeContext}\n${citationBlock}\n`
            );
        } else {
            updatedSystem = system + `\n\nRelevant knowledge base information:\n${knowledgeContext}${citationBlock}`;
        }

        return { system: updatedSystem, entries: referencedKbEntries };
    } catch (err) {
        console.warn('KB relevance picking failed, continuing without:', err.message);
        return { system, entries: [] };
    }
}

/**
 * Search kb_chunks using vector similarity (semantic search).
 * Returns chunks ranked by cosine similarity to the inquiry embedding.
 * Falls back gracefully if pgvector or embeddings are not available.
 */
async function semanticChunkSearch(inquiry, organizationId, kbFilter, limit = 15) {
    try {
        const queryEmbedding = await embedQuery(inquiry);
        if (!queryEmbedding) return [];

        const result = await pool.query(
            `SELECT id, knowledge_base_id, title, content, category, tags, updated_at,
                    1 - (embedding <=> $2::vector) AS similarity
             FROM kb_chunks
             WHERE organization_id = $1 ${kbFilter.replace('kb_type', 'kb_type')}
               AND embedding IS NOT NULL
             ORDER BY embedding <=> $2::vector
             LIMIT $3`,
            [organizationId, formatForPgvector(queryEmbedding), limit]
        );

        // Mark results so we know to skip Haiku picking
        return result.rows.map(r => ({ ...r, _fromSemanticSearch: true }));
    } catch (err) {
        // pgvector extension or kb_chunks table may not exist yet
        if (!err.message.includes('does not exist')) {
            console.warn('[SEMANTIC SEARCH] Error:', err.message);
        }
        return [];
    }
}

/**
 * Search kb_chunks using PostgreSQL full-text search.
 * Fallback when embeddings are not available but chunks exist.
 */
async function ftsChunkSearch(inquiry, organizationId, kbFilter) {
    try {
        const result = await pool.query(
            `SELECT id, knowledge_base_id, title, content, category, tags, updated_at,
                    ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank
             FROM kb_chunks
             WHERE organization_id = $1 ${kbFilter.replace('kb_type', 'kb_type')}
               AND search_vector @@ plainto_tsquery('english', $2)
             ORDER BY rank DESC
             LIMIT 30`,
            [organizationId, inquiry]
        );

        return result.rows.map(r => ({ ...r, _fromSemanticSearch: true }));
    } catch (_e) {
        // kb_chunks table may not exist yet
        return [];
    }
}

/**
 * Inject Shopify order/customer context if the org has a connected store.
 */
async function injectShopifyContext(system, inquiry, organizationId) {
    try {
        const shopifyContext = await shopifyService.buildContextForInquiry(organizationId, inquiry);
        if (shopifyContext) {
            return system + shopifyContext;
        }
    } catch (err) {
        console.warn('Shopify context injection failed, continuing without:', err.message);
    }
    return system;
}

/**
 * Build the enhanced system prompt with org rules, KB entries, and Shopify context.
 *
 * This is the single function both /generate and /generate-stream should call,
 * eliminating the previous code duplication.
 *
 * @param {string} baseSystem - The system prompt (from frontend or server-built)
 * @param {string} inquiry - The customer inquiry
 * @param {string} organizationId - The org UUID
 * @param {object} options
 * @param {string} options.kb_type - 'support' | 'internal' | 'all'
 * @param {boolean} options.includeCitations - Whether to add citation rules
 * @param {string} options.userId - Current user UUID (for memory and cross-tool context)
 * @returns {Promise<{ system: string, referencedKbEntries: Array }>}
 */
async function buildEnhancedPrompt(baseSystem, inquiry, organizationId, options = {}) {
    let system = baseSystem || '';
    let referencedKbEntries = [];

    // 1. Inject response rules
    if (organizationId) {
        system = await injectResponseRules(system, organizationId);
    }

    // 2. KB relevance picking
    if (inquiry && organizationId) {
        const kbResult = await injectKnowledgeBase(system, inquiry, organizationId, options.kb_type, {
            includeCitations: options.includeCitations !== false
        });
        system = kbResult.system;
        referencedKbEntries = kbResult.entries;
    }

    // 3. Shopify context
    if (inquiry && organizationId) {
        system = await injectShopifyContext(system, inquiry, organizationId);
    }

    // 4. Conversation memory — org-wide past conversation context
    if (inquiry && organizationId && options.userId) {
        const memoryContext = await getConversationMemory(inquiry, organizationId, options.userId);
        if (memoryContext) system += memoryContext;
    }

    // 5. Cross-tool activity — recent work across other Lightspeed tools
    if (organizationId && options.userId) {
        const crossToolContext = await getCrossToolContext(organizationId, options.userId);
        if (crossToolContext) system += crossToolContext;
    }

    // 6. Voice fingerprint — org-specific communication style
    if (organizationId) {
        const voiceContext = await getVoiceProfileContext(organizationId);
        if (voiceContext) system += voiceContext;
    }

    // 7. Corrections from past feedback — highest priority context
    if (inquiry && organizationId) {
        try {
            const tool = options.tool || 'response_assistant';
            const corrections = await fetchRelevantCorrections(organizationId, inquiry, tool, options.format);
            const correctionsCtx = buildCorrectionsContext(corrections);
            if (correctionsCtx) system += correctionsCtx;
        } catch (_e) {
            // Continue without corrections
        }
    }

    return { system, referencedKbEntries };
}

module.exports = {
    buildEnhancedPrompt,
    injectResponseRules,
    injectKnowledgeBase,
    injectShopifyContext,
    semanticChunkSearch,
    ftsChunkSearch
};
