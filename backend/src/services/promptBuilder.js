/**
 * Prompt Builder Service
 *
 * Centralizes the shared logic that was previously duplicated between
 * /api/generate and /api/generate-stream: response rules injection,
 * KB relevance picking, and Shopify context injection.
 */

const pool = require('../../config/database');
const claudeService = require('./claude');
const shopifyService = require('./shopify');
const { cache, TTL } = require('./cache');
const { truncateEntriesToBudget } = require('./tokenCounter');

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

        // Try full-text search pre-filtering first (scales to 100K+ entries)
        let kbRows;
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
        } catch (ftsErr) {
            // search_vector column may not exist yet (migration not run)
            kbRows = [];
        }

        // Fall back to loading all entries only if FTS returned nothing.
        // If FTS found 1-4 results, those are still the most relevant — don't
        // dilute them by loading the entire KB alphabetically.
        if (kbRows.length === 0) {
            const allResult = await pool.query(
                `SELECT id, title, content, category, tags, updated_at FROM knowledge_base WHERE organization_id = $1 ${kbFilter} ORDER BY category, title`,
                [organizationId]
            );
            // Pre-filter large KBs with tag-match scoring so Haiku gets a
            // manageable, pre-ranked pool instead of hundreds of unsorted entries
            if (allResult.rows.length > 30) {
                kbRows = claudeService.tagMatchFallback(inquiry, allResult.rows, 30);
            } else {
                kbRows = allResult.rows;
            }
        }

        if (kbRows.length === 0) return { system, entries: [] };

        const relevantEntries = await claudeService.pickRelevantKnowledge(
            inquiry,
            kbRows,
            8
        );

        if (relevantEntries.length === 0) return { system, entries: [] };

        // Truncate entries that are too long (>3K chars) to prevent context overflow
        const budgetedEntries = truncateEntriesToBudget(relevantEntries, 30000);

        const referencedKbEntries = budgetedEntries.map((entry, idx) => ({
            id: entry.id,
            title: entry.title,
            content: entry.content,
            category: entry.category,
            updated_at: entry.updated_at?.toISOString() || null,
            citation_index: idx + 1
        }));

        const knowledgeContext = budgetedEntries
            .map((entry, idx) => `[Source ${idx + 1}] [${entry.category}] ${entry.title}: ${entry.content}`)
            .join('\n\n');

        let citationBlock = '';
        if (includeCitations) {
            citationBlock = '\n\nCITATION RULES: When your response uses information from the knowledge base sources above, include inline citations using the format [1], [2], etc. corresponding to the source numbers. Only cite when you directly use information from a specific source. Do not cite for general knowledge.';
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

    return { system, referencedKbEntries };
}

module.exports = {
    buildEnhancedPrompt,
    injectResponseRules,
    injectKnowledgeBase,
    injectShopifyContext
};
