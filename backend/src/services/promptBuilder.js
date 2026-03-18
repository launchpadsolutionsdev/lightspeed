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
const { fetchRelevantCorrections, buildCorrectionsContext, buildCalendarContext } = require('./systemPromptBuilder');
const log = require('./logger');

// ─── Per-tool context configuration ─────────────────────────────────
// Each tool declares which context layers it wants injected.
// 'true' = full injection, 'light' = reduced/capped injection, false = skip.
const TOOL_CONTEXT_CONFIG = {
    response_assistant: { kb: true, rules: true, shopify: true, calendar: true, memory: true, crossTool: true, voice: true, corrections: true },
    ask_lightspeed:     { kb: true, rules: true, shopify: true, calendar: true, memory: true, crossTool: true, voice: true, corrections: true },
    draft_assistant:    { kb: true, rules: true, shopify: true, calendar: true, memory: true, crossTool: true, voice: true, corrections: true },
    insights_engine:    { kb: 'light', rules: false, shopify: false, calendar: 'light', memory: false, crossTool: true, voice: true, corrections: true },
    list_normalizer:    { kb: false, rules: false, shopify: false, calendar: false, memory: false, crossTool: false, voice: false, corrections: false },
};

/** Log a KB gap (non-blocking, fire-and-forget) */
function logKbGap(organizationId, inquiry, tool, kbResultsCount) {
    if (!organizationId || !inquiry) return;
    pool.query(
        `INSERT INTO kb_gaps (organization_id, inquiry, tool, kb_results_count)
         VALUES ($1, $2, $3, $4)`,
        [organizationId, inquiry.substring(0, 500), tool || 'response_assistant', kbResultsCount]
    ).catch(() => {}); // Non-fatal — table may not exist yet
}

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
        log.warn('Response rules injection failed, continuing without', { error: err.message });
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
    const { includeCitations = true, _lightMode = false } = options;
    try {
        let kbFilter = "AND kb_type = 'support'";
        if (kbType === 'all') {
            kbFilter = '';
        } else if (kbType === 'internal') {
            kbFilter = "AND kb_type = 'internal'";
        }

        // Dynamic budget allocation based on inquiry complexity
        const { budgets } = getBudgetAllocation(inquiry);
        let kbTokenBudget = budgets.knowledgeBase;
        let maxEntries = budgets.maxKbEntries;

        // Light mode: cap entries and budget for data-heavy tools (e.g., Insights Engine)
        if (_lightMode) {
            maxEntries = Math.min(maxEntries, 3);
            kbTokenBudget = Math.min(kbTokenBudget, 5000);
        }

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

        if (kbRows.length === 0) {
            logKbGap(organizationId, inquiry, options.tool, 0);
            return { system, entries: [] };
        }

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

        if (relevantEntries.length === 0) {
            logKbGap(organizationId, inquiry, options.tool, kbRows.length);
            return { system, entries: [] };
        }

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
        log.warn('KB relevance picking failed, continuing without', { error: err.message });
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
            log.warn('[SEMANTIC SEARCH] Error', { error: err.message });
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
        log.warn('Shopify context injection failed, continuing without', { error: err.message });
    }
    return system;
}

/**
 * Build the enhanced system prompt with org rules, KB entries, and Shopify context.
 *
 * This is the single function both /generate and /generate-stream should call,
 * eliminating the previous code duplication. Now config-driven via TOOL_CONTEXT_CONFIG.
 *
 * @param {string} baseSystem - The system prompt (from frontend or server-built)
 * @param {string} inquiry - The customer inquiry
 * @param {string} organizationId - The org UUID
 * @param {object} options
 * @param {string} options.kb_type - 'support' | 'internal' | 'all'
 * @param {boolean} options.includeCitations - Whether to add citation rules
 * @param {string} options.userId - Current user UUID (for memory and cross-tool context)
 * @param {string} options.tool - Tool identifier for config lookup
 * @returns {Promise<{ system: string, referencedKbEntries: Array, contextSummary: object }>}
 */
async function buildEnhancedPrompt(baseSystem, inquiry, organizationId, options = {}) {
    let system = baseSystem || '';
    let referencedKbEntries = [];
    const toolName = options.tool || 'response_assistant';
    const config = TOOL_CONTEXT_CONFIG[toolName] || TOOL_CONTEXT_CONFIG.response_assistant;

    // Track which context layers were actually injected
    const contextSummary = { rules: 0, kb: 0, shopify: false, memory: 0, crossTool: 0, voice: false, corrections: 0, calendar: false };

    // 1. Inject response rules
    if (config.rules && organizationId) {
        const before = system.length;
        system = await injectResponseRules(system, organizationId);
        if (system.length > before) contextSummary.rules = 1;
    }

    // 2. KB relevance picking
    if (config.kb && inquiry && organizationId) {
        const kbOptions = { includeCitations: options.includeCitations !== false, tool: toolName };
        // 'light' mode: cap at 3 entries with smaller budget
        if (config.kb === 'light') {
            kbOptions._lightMode = true;
        }
        const kbResult = await injectKnowledgeBase(system, inquiry, organizationId, options.kb_type, kbOptions);
        system = kbResult.system;
        referencedKbEntries = kbResult.entries;
        contextSummary.kb = referencedKbEntries.length;
    }

    // 3. Shopify context
    if (config.shopify && inquiry && organizationId) {
        const before = system.length;
        system = await injectShopifyContext(system, inquiry, organizationId);
        if (system.length > before) contextSummary.shopify = true;
    }

    // 4. Calendar context (server-side, for tools that don't build it frontend-side)
    if (config.calendar && organizationId && options._injectCalendar) {
        try {
            let calendarContext;
            if (config.calendar === 'light') {
                // Light mode: only next 7 days
                calendarContext = await buildCalendarContext(organizationId, { days: 7 });
            } else {
                calendarContext = await buildCalendarContext(organizationId);
            }
            if (calendarContext) {
                system += '\n\n' + calendarContext;
                contextSummary.calendar = true;
            }
        } catch (_e) {
            // Continue without calendar
        }
    }

    // 5. Conversation memory — org-wide past conversation context
    if (config.memory && inquiry && organizationId && options.userId) {
        const memoryContext = await getConversationMemory(inquiry, organizationId, options.userId);
        if (memoryContext) {
            system += memoryContext;
            contextSummary.memory = 1;
        }
    }

    // 6. Cross-tool activity — recent work across other Lightspeed tools
    if (config.crossTool && organizationId && options.userId) {
        const crossToolContext = await getCrossToolContext(organizationId, options.userId, { tool: toolName });
        if (crossToolContext) {
            system += crossToolContext;
            contextSummary.crossTool = 1;
        }
    }

    // 7. Voice fingerprint — org-specific communication style (tool-aware)
    if (config.voice && organizationId) {
        const voiceTool = options.tool || 'general';
        const voiceContext = await getVoiceProfileContext(organizationId, voiceTool);
        if (voiceContext) {
            system += voiceContext;
            contextSummary.voice = true;
        }
    }

    // 8. Corrections from past feedback — highest priority context
    if (config.corrections && inquiry && organizationId) {
        try {
            const corrections = await fetchRelevantCorrections(organizationId, inquiry, toolName, options.format);
            const correctionsCtx = buildCorrectionsContext(corrections);
            if (correctionsCtx) {
                system += correctionsCtx;
                contextSummary.corrections = corrections.length;
            }
        } catch (_e) {
            // Continue without corrections
        }
    }

    return { system, referencedKbEntries, contextSummary };
}

module.exports = {
    buildEnhancedPrompt,
    injectResponseRules,
    injectKnowledgeBase,
    injectShopifyContext,
    semanticChunkSearch,
    ftsChunkSearch,
    TOOL_CONTEXT_CONFIG
};
