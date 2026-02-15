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
 * Stream a response using Claude API with SSE.
 * Calls the Anthropic streaming endpoint and yields events to the caller.
 *
 * @param {Object} options
 * @param {Array} options.messages - Conversation messages
 * @param {string} options.system - System prompt
 * @param {number} options.max_tokens - Maximum tokens to generate
 * @param {Function} options.onText - Called with each text delta chunk
 * @param {Function} options.onDone - Called with the final message_stop event data (usage, etc.)
 * @param {Function} options.onError - Called if an error occurs
 * @returns {Promise<{text: string, usage: Object}>} Full text + usage once stream completes
 */
async function streamResponse({ messages, system, max_tokens = 1024, onText, onDone, onError }) {
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
            messages,
            stream: true
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Claude streaming API error:', response.status, errorData);
        throw new Error(errorData.error?.message || `API request failed with status ${response.status}`);
    }

    let fullText = '';
    let usage = { input_tokens: 0, output_tokens: 0 };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines from buffer
        const lines = buffer.split('\n');
        // Keep the last (potentially incomplete) line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6);
                if (jsonStr === '[DONE]') continue;

                try {
                    const event = JSON.parse(jsonStr);

                    if (event.type === 'content_block_delta' && event.delta?.text) {
                        fullText += event.delta.text;
                        if (onText) onText(event.delta.text);
                    } else if (event.type === 'message_delta' && event.usage) {
                        usage.output_tokens = event.usage.output_tokens || 0;
                    } else if (event.type === 'message_start' && event.message?.usage) {
                        usage.input_tokens = event.message.usage.input_tokens || 0;
                    }
                } catch (e) {
                    // Skip unparseable lines (event: lines, empty lines, etc.)
                }
            }
        }
    }

    if (onDone) onDone({ text: fullText, usage });
    return { text: fullText, usage };
}

module.exports = {
    generateResponse,
    generateWithKnowledge,
    pickRelevantKnowledge,
    streamResponse
};
