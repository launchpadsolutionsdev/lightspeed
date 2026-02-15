/**
 * Claude AI Service
 * Anthropic API integration
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Generate a response using Claude API
 * @param {Object} options
 * @param {Array} options.messages - Conversation messages
 * @param {string} options.system - System prompt
 * @param {number} options.max_tokens - Maximum tokens to generate
 * @returns {Promise<Object>} API response
 */
async function generateResponse({ messages, system, max_tokens = 1024 }) {
    if (!ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: ANTHROPIC_MODEL,
            max_tokens,
            system: system || '',
            messages
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Claude API error:', response.status, errorData);
        throw new Error(errorData.error?.message || `API request failed with status ${response.status}`);
    }

    return response.json();
}

/**
 * Generate a response with knowledge base context
 * @param {Object} options
 * @param {Array} options.messages - Conversation messages
 * @param {string} options.system - Base system prompt
 * @param {Array} options.knowledgeEntries - Knowledge base entries to include
 * @param {number} options.max_tokens - Maximum tokens to generate
 * @returns {Promise<Object>} API response
 */
async function generateWithKnowledge({ messages, system, knowledgeEntries, max_tokens = 1024 }) {
    let enhancedSystem = system || '';

    if (knowledgeEntries && knowledgeEntries.length > 0) {
        const knowledgeContext = knowledgeEntries
            .map(entry => `[${entry.category}] ${entry.title}: ${entry.content}`)
            .join('\n\n');

        enhancedSystem += `\n\nRelevant knowledge base information:\n${knowledgeContext}`;
    }

    return generateResponse({
        messages,
        system: enhancedSystem,
        max_tokens
    });
}

/**
 * Score KB entries by keyword/tag overlap with the inquiry.
 * Used as a fallback when Haiku is unavailable.
 *
 * @param {string} inquiry - The customer inquiry text
 * @param {Array} knowledgeEntries - All KB entries for the organization
 * @param {number} maxEntries - Maximum entries to return
 * @returns {Array} Entries sorted by tag-match score (descending)
 */
function tagMatchFallback(inquiry, knowledgeEntries, maxEntries) {
    const inquiryLower = inquiry.toLowerCase();
    const inquiryTokens = inquiryLower.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);

    const scored = knowledgeEntries.map(entry => {
        let score = 0;
        const tags = entry.tags || [];

        for (const tag of tags) {
            // Extract the value after the prefix (keyword:xxx, lottery:xxx)
            const value = tag.includes(':') ? tag.split(':').slice(1).join(':').toLowerCase() : tag.toLowerCase();

            // Direct substring match: inquiry contains the tag value
            if (inquiryLower.includes(value)) {
                score += 3;
            } else {
                // Token overlap: any inquiry word matches a word in the tag value
                const tagWords = value.split(/\s+/);
                for (const token of inquiryTokens) {
                    if (tagWords.some(tw => tw.includes(token) || token.includes(tw))) {
                        score += 1;
                    }
                }
            }
        }

        // Light boost for title keyword matches
        const titleLower = entry.title.toLowerCase();
        for (const token of inquiryTokens) {
            if (titleLower.includes(token)) {
                score += 1;
            }
        }

        return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxEntries).map(s => s.entry);
}

/**
 * Format tags for display in the Haiku catalogue.
 * Extracts keyword values and returns a short summary.
 */
function formatTagsForCatalogue(tags) {
    if (!tags || tags.length === 0) return '';
    const keywords = tags
        .filter(t => t.startsWith('keyword:'))
        .map(t => t.replace('keyword:', ''))
        .slice(0, 5);
    const lotteryTags = tags
        .filter(t => t.startsWith('lottery:'))
        .map(t => t.replace('lottery:', ''));
    const parts = [...lotteryTags, ...keywords];
    return parts.length > 0 ? ` [tags: ${parts.join(', ')}]` : '';
}

/**
 * Pick the most relevant knowledge base entries for a customer inquiry using Haiku.
 * Returns a filtered subset of entries sorted by relevance.
 * Falls back to tag-match scoring if the Haiku picker call fails.
 *
 * @param {string} inquiry - The customer inquiry text
 * @param {Array} knowledgeEntries - All KB entries for the organization
 * @param {number} maxEntries - Maximum entries to return (default 8)
 * @returns {Promise<Array>} Filtered and ranked KB entries
 */
async function pickRelevantKnowledge(inquiry, knowledgeEntries, maxEntries = 8) {
    if (!knowledgeEntries || knowledgeEntries.length === 0) {
        return [];
    }

    // If we have fewer entries than the max, just return them all
    if (knowledgeEntries.length <= maxEntries) {
        return knowledgeEntries;
    }

    try {
        // Build a numbered catalogue including tags for better Haiku decisions
        const catalogue = knowledgeEntries.map((entry, i) =>
            `[${i}] ${entry.title} (${entry.category})${formatTagsForCatalogue(entry.tags)}: ${entry.content.substring(0, 150)}`
        ).join('\n');

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: HAIKU_MODEL,
                max_tokens: 200,
                system: `You are a relevance picker. Given a customer inquiry and a numbered list of knowledge base entries, return ONLY the index numbers of the most relevant entries as a JSON array. Pick up to ${maxEntries} entries. Return ONLY the JSON array, nothing else. Example: [0, 3, 7]`,
                messages: [{
                    role: 'user',
                    content: `Customer inquiry: ${inquiry}\n\nKnowledge base entries:\n${catalogue}`
                }]
            })
        });

        if (!response.ok) {
            console.warn('Haiku relevance picker failed, using tag-match fallback');
            return tagMatchFallback(inquiry, knowledgeEntries, maxEntries);
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || '';

        // Extract the JSON array from the response
        const match = text.match(/\[[\d,\s]*\]/);
        if (!match) {
            console.warn('Haiku relevance picker returned unexpected format, using tag-match fallback');
            return tagMatchFallback(inquiry, knowledgeEntries, maxEntries);
        }

        const indices = JSON.parse(match[0]);
        const validIndices = indices
            .filter(i => typeof i === 'number' && i >= 0 && i < knowledgeEntries.length)
            .slice(0, maxEntries);

        if (validIndices.length === 0) {
            return tagMatchFallback(inquiry, knowledgeEntries, maxEntries);
        }

        return validIndices.map(i => knowledgeEntries[i]);

    } catch (error) {
        console.warn('Haiku relevance picker error, using tag-match fallback:', error.message);
        return tagMatchFallback(inquiry, knowledgeEntries, maxEntries);
    }
}

/**
 * Stream a response using Claude API
 * Note: Currently returns non-streaming response
 * @param {Object} options
 * @returns {Promise<Object>} API response
 */
async function streamResponse(options) {
    return generateResponse(options);
}

module.exports = {
    generateResponse,
    generateWithKnowledge,
    pickRelevantKnowledge,
    streamResponse
};
