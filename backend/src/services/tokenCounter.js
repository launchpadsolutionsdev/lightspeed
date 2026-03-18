/**
 * Token Counter Service
 *
 * Provides token estimation and context window budget management.
 * Uses a simple chars/4 approximation — accurate enough for budget
 * enforcement without requiring a tokenizer dependency.
 */

// Claude model context windows
const MODEL_CONTEXT_WINDOWS = {
    'claude-sonnet-4-6': 200000,
    'claude-opus-4-6': 200000,
    'claude-haiku-4-5-20251001': 200000,
};

const log = require('./logger');
const DEFAULT_CONTEXT_WINDOW = 200000;
const SAFETY_MARGIN = 0.75; // Use at most 75% of context window for input

/**
 * Estimate the number of tokens in a string.
 * Uses chars/4 as a rough approximation (slightly overestimates for English,
 * which is safer than underestimating).
 */
function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

/**
 * Calculate the token budget for a prompt and enforce limits.
 *
 * @param {object} params
 * @param {string} params.systemPrompt - The system prompt
 * @param {string} params.userPrompt - The user message
 * @param {number} params.maxOutputTokens - Reserved output tokens
 * @param {string} params.model - Model name (for context window lookup)
 * @returns {{ totalInputTokens: number, budgetRemaining: number, withinBudget: boolean, contextWindow: number }}
 */
function checkTokenBudget({ systemPrompt, userPrompt, maxOutputTokens = 1024, model }) {
    const contextWindow = MODEL_CONTEXT_WINDOWS[model] || DEFAULT_CONTEXT_WINDOW;
    const maxInputTokens = Math.floor(contextWindow * SAFETY_MARGIN);

    const systemTokens = estimateTokens(systemPrompt);
    const userTokens = estimateTokens(userPrompt);
    const totalInputTokens = systemTokens + userTokens;
    const budgetRemaining = maxInputTokens - totalInputTokens - maxOutputTokens;

    if (totalInputTokens > 100000) {
        log.warn(`[TOKEN BUDGET] Large prompt detected: ~${totalInputTokens} estimated tokens`);
    }

    return {
        totalInputTokens,
        budgetRemaining,
        withinBudget: budgetRemaining > 0,
        contextWindow
    };
}

/**
 * Truncate KB entries to fit within a token budget.
 * Removes entries from the end and truncates long entries.
 *
 * @param {Array} entries - KB entries to potentially truncate
 * @param {number} maxTokens - Maximum total tokens for all entries combined
 * @returns {Array} Truncated entries
 */
function truncateEntriesToBudget(entries, maxTokens) {
    const MAX_ENTRY_CHARS = 12000; // ~3000 tokens per entry max
    let totalTokens = 0;
    const result = [];

    for (const entry of entries) {
        let content = entry.content || '';

        // Truncate individual long entries
        if (content.length > MAX_ENTRY_CHARS) {
            content = content.substring(0, MAX_ENTRY_CHARS) + '\n[...truncated]';
        }

        const entryTokens = estimateTokens(`${entry.title}: ${content}`);

        if (totalTokens + entryTokens > maxTokens) {
            break; // Stop adding entries
        }

        totalTokens += entryTokens;
        result.push({ ...entry, content });
    }

    return result;
}

module.exports = {
    estimateTokens,
    checkTokenBudget,
    truncateEntriesToBudget,
    MODEL_CONTEXT_WINDOWS
};
