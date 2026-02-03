/**
 * Claude AI Service
 * Anthropic API integration
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

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
 * Stream a response using Claude API
 * Note: Currently returns non-streaming response
 * @param {Object} options
 * @returns {Promise<Object>} API response
 */
async function streamResponse(options) {
    // TODO: Implement streaming with SSE
    // For now, use regular response
    return generateResponse(options);
}

module.exports = {
    generateResponse,
    generateWithKnowledge,
    streamResponse
};
