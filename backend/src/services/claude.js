/**
 * Claude AI Service
 * Anthropic API integration
 */

const log = require('./logger');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const HAIKU_MODEL = process.env.HAIKU_MODEL || 'claude-haiku-4-5-20251001';

/**
 * Sanitize a JSON string by replacing escaped lone surrogate code points.
 *
 * JSON.stringify() in Node.js 12+ outputs lone surrogates as \uXXXX escape
 * sequences (e.g. \ud83d). These are regular ASCII characters in the output
 * string, NOT actual surrogate code units, so a character-level scan won't
 * find them. Instead, we regex-match the \uD800-\uDFFF escape patterns.
 *
 * In Node.js 12+, valid surrogate pairs are emitted as their actual UTF-8
 * character (e.g. 😀), so any \uD800-\uDFFF escape in the JSON is lone.
 */
function sanitizeJsonString(jsonStr) {
    if (typeof jsonStr !== 'string') return jsonStr;
    return jsonStr.replace(/\\u[dD][89a-fA-F][0-9a-fA-F]{2}/g, '\\ufffd');
}

/**
 * Generate a response using Claude API
 * @param {Object} options
 * @param {Array} options.messages - Conversation messages
 * @param {string} options.system - System prompt
 * @param {number} options.max_tokens - Maximum tokens to generate
 * @param {Array} options.tools - Optional tool definitions for function calling
 * @param {string} options.model - Optional model override
 * @returns {Promise<Object>} API response
 */
async function generateResponse({ messages, system, staticSystem, dynamicSystem, max_tokens = 1024, tools, model }) {
    if (!ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not configured');
    }

    // Build system blocks with prompt caching
    // When staticSystem + dynamicSystem are provided, cache the static portion
    // (base instructions, tool docs) and leave dynamic portion (KB, rules, memory) uncached.
    let systemBlocks;
    if (staticSystem !== null && staticSystem !== undefined && dynamicSystem !== undefined) {
        systemBlocks = [
            { type: 'text', text: staticSystem, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: dynamicSystem, cache_control: { type: 'ephemeral' } }
        ];
    } else {
        systemBlocks = system ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : '';
    }

    const body = {
        model: model || ANTHROPIC_MODEL,
        max_tokens,
        system: systemBlocks,
        messages
    };

    // Add tools with cache_control on the last tool definition
    // Tools are static across requests so caching saves re-processing them
    if (tools && tools.length > 0) {
        body.tools = tools.map((tool, i) => {
            if (i === tools.length - 1) {
                return { ...tool, cache_control: { type: 'ephemeral' } };
            }
            return tool;
        });
    }

    // Sanitize the final JSON to strip any lone surrogates from all fields
    // (system prompt, messages, KB entries, org profile, conversation history, etc.)
    const jsonBody = sanitizeJsonString(JSON.stringify(body));

    // Check if any tools require server-side execution (e.g., web search)
    const hasServerTools = body.tools && body.tools.some(t => t.type === 'web_search_20250305');

    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
    };

    if (hasServerTools) {
        headers['anthropic-beta'] = 'web-search-2025-03-05';
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: jsonBody
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        log.error('Claude API error', { status: response.status, error: errorData });
        if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after');
            const waitSec = retryAfter ? parseInt(retryAfter, 10) : 60;
            throw new Error(`Rate limited — please wait ${waitSec}s and try again, or reduce the data size.`);
        }
        throw new Error(errorData.error?.message || `API request failed with status ${response.status}`);
    }

    const data = await response.json();

    // Log cache performance when prompt caching is active
    if (data.usage && (data.usage.cache_creation_input_tokens || data.usage.cache_read_input_tokens)) {
        log.info('Prompt cache usage', {
            model: body.model,
            cache_read: data.usage.cache_read_input_tokens || 0,
            cache_write: data.usage.cache_creation_input_tokens || 0,
            input_tokens: data.usage.input_tokens || 0
        });
    }

    return data;
}

/**
 * Generate a response with knowledge base context.
 * Uses Haiku relevance picking to select only the most relevant entries
 * instead of concatenating everything into the prompt.
 *
 * @param {Object} options
 * @param {Array} options.messages - Conversation messages
 * @param {string} options.system - Base system prompt
 * @param {Array} options.knowledgeEntries - Knowledge base entries to include
 * @param {string} options.inquiry - Customer inquiry for relevance filtering
 * @param {number} options.max_tokens - Maximum tokens to generate
 * @returns {Promise<Object>} API response
 */
async function generateWithKnowledge({ messages, system, knowledgeEntries, inquiry, max_tokens = 1024 }) {
    let enhancedSystem = system || '';

    if (knowledgeEntries && knowledgeEntries.length > 0) {
        // Use relevance picking to filter down to the most relevant entries
        const relevantEntries = inquiry
            ? await pickRelevantKnowledge(inquiry, knowledgeEntries, 8)
            : knowledgeEntries.slice(0, 8);

        if (relevantEntries.length > 0) {
            const knowledgeContext = relevantEntries
                .map(entry => `[${entry.category}] ${entry.title}: ${entry.content}`)
                .join('\n\n');

            enhancedSystem += `\n\nRelevant knowledge base information:\n${knowledgeContext}`;
        }
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
            `[${i}] ${entry.title} (${entry.category})${formatTagsForCatalogue(entry.tags)}: ${entry.content.substring(0, 500)}`
        ).join('\n');

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: sanitizeJsonString(JSON.stringify({
                model: HAIKU_MODEL,
                max_tokens: 200,
                system: `You are a relevance picker. Given a customer inquiry and a numbered list of knowledge base entries, return ONLY the index numbers of the most relevant entries as a JSON array. Pick up to ${maxEntries} entries. Return ONLY the JSON array, nothing else. Example: [0, 3, 7]`,
                messages: [{
                    role: 'user',
                    content: `Customer inquiry: ${inquiry}\n\nKnowledge base entries:\n${catalogue}`
                }]
            }))
        });

        if (!response.ok) {
            log.warn('Haiku relevance picker failed, using tag-match fallback');
            return tagMatchFallback(inquiry, knowledgeEntries, maxEntries);
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || '';

        // Extract the JSON array from the response
        const match = text.match(/\[[\d,\s]*\]/);
        if (!match) {
            log.warn('Haiku relevance picker returned unexpected format, using tag-match fallback');
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
        log.warn('Haiku relevance picker error, using tag-match fallback', { error: error.message });
        return tagMatchFallback(inquiry, knowledgeEntries, maxEntries);
    }
}

/**
 * Pick rated examples relevant to the current inquiry using Haiku.
 * Takes a larger pool of positive/negative examples and returns only
 * those that are topically relevant to the customer's question.
 *
 * @param {string} inquiry - The current customer inquiry
 * @param {Array} positiveExamples - Pool of positively-rated examples
 * @param {Array} negativeExamples - Pool of negatively-rated examples
 * @param {number} maxPositive - Max positive examples to return (default 5)
 * @param {number} maxNegative - Max negative examples to return (default 3)
 * @returns {Promise<{positive: Array, negative: Array}>} Filtered examples
 */
async function pickRelevantRatedExamples(inquiry, positiveExamples, negativeExamples, maxPositive = 5, maxNegative = 3) {
    const allExamples = [
        ...positiveExamples.map((ex, i) => ({ ...ex, _idx: i, _type: 'positive' })),
        ...negativeExamples.map((ex, i) => ({ ...ex, _idx: i, _type: 'negative' }))
    ];

    // If the pool is small enough, no filtering needed
    if (positiveExamples.length <= maxPositive && negativeExamples.length <= maxNegative) {
        return { positive: positiveExamples, negative: negativeExamples };
    }

    if (allExamples.length === 0) {
        return { positive: [], negative: [] };
    }

    try {
        const catalogue = allExamples.map((ex, i) =>
            `[${i}] (${ex._type}) Customer asked: "${ex.inquiry.substring(0, 120)}"`
        ).join('\n');

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: sanitizeJsonString(JSON.stringify({
                model: HAIKU_MODEL,
                max_tokens: 200,
                system: `You are a relevance picker. Given a new customer inquiry and a numbered list of past customer inquiries (each marked positive or negative), return ONLY the index numbers of past inquiries that are on a SIMILAR TOPIC to the new inquiry. Only pick examples where the subject matter is clearly related. Return ONLY a JSON array of index numbers. If none are relevant, return an empty array []. Example: [0, 3, 7]`,
                messages: [{
                    role: 'user',
                    content: `New customer inquiry: ${inquiry}\n\nPast rated inquiries:\n${catalogue}`
                }]
            }))
        });

        if (!response.ok) {
            log.warn('Haiku rated-example picker failed, returning most recent');
            return {
                positive: positiveExamples.slice(0, maxPositive),
                negative: negativeExamples.slice(0, maxNegative)
            };
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || '';

        const match = text.match(/\[[\d,\s]*\]/);
        if (!match) {
            log.warn('Haiku rated-example picker returned unexpected format, returning most recent');
            return {
                positive: positiveExamples.slice(0, maxPositive),
                negative: negativeExamples.slice(0, maxNegative)
            };
        }

        const indices = JSON.parse(match[0]);
        const validIndices = indices.filter(i => typeof i === 'number' && i >= 0 && i < allExamples.length);

        const pickedPositive = [];
        const pickedNegative = [];

        for (const idx of validIndices) {
            const ex = allExamples[idx];
            if (ex._type === 'positive' && pickedPositive.length < maxPositive) {
                const { _idx, _type, ...clean } = ex;
                pickedPositive.push(clean);
            } else if (ex._type === 'negative' && pickedNegative.length < maxNegative) {
                const { _idx, _type, ...clean } = ex;
                pickedNegative.push(clean);
            }
        }

        return { positive: pickedPositive, negative: pickedNegative };

    } catch (error) {
        log.warn('Haiku rated-example picker error, returning most recent', { error: error.message });
        return {
            positive: positiveExamples.slice(0, maxPositive),
            negative: negativeExamples.slice(0, maxNegative)
        };
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
async function streamResponse({ messages, system, staticSystem, dynamicSystem, max_tokens = 1024, model, onText, onDone, onError }) {
    if (!ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not configured');
    }

    // Layer 1 (static) is cached across all requests via cache_control.
    // Layer 2 (dynamic: org, tone, language, KB, rules, Shopify) also gets cache_control
    // so that within a single conversation the dynamic context is cached too.
    let systemBlocks;
    if (staticSystem !== null && staticSystem !== undefined && dynamicSystem !== undefined) {
        systemBlocks = [
            { type: 'text', text: staticSystem, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: dynamicSystem, cache_control: { type: 'ephemeral' } }
        ];
    } else {
        const systemText = system || dynamicSystem || '';
        systemBlocks = systemText ? [{
            type: 'text',
            text: systemText,
            cache_control: { type: 'ephemeral' }
        }] : [];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
        },
        body: sanitizeJsonString(JSON.stringify({
            model: model || ANTHROPIC_MODEL,
            max_tokens,
            system: systemBlocks.length > 0 ? systemBlocks : '',
            messages,
            stream: true
        }))
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        log.error('Claude streaming API error', { status: response.status, error: errorData });
        if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after');
            const waitSec = retryAfter ? parseInt(retryAfter, 10) : 60;
            throw new Error(`Rate limited — please wait ${waitSec}s and try again, or reduce the data size.`);
        }
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
                        // Log cache performance from streaming responses
                        const u = event.message.usage;
                        if (u.cache_creation_input_tokens || u.cache_read_input_tokens) {
                            log.info('Prompt cache usage (stream)', {
                                cache_read: u.cache_read_input_tokens || 0,
                                cache_write: u.cache_creation_input_tokens || 0,
                                input_tokens: u.input_tokens || 0
                            });
                        }
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

/**
 * Generate a streaming response from Claude with full tool support.
 * Streams text deltas in real-time via onText callback while buffering
 * tool_use blocks. Returns a response object compatible with processResponse.
 *
 * @param {Object} options
 * @param {Array} options.messages - Conversation messages
 * @param {string} [options.system] - System prompt (single block)
 * @param {string} [options.staticSystem] - Static system (cached)
 * @param {string} [options.dynamicSystem] - Dynamic system (KB, rules, etc.)
 * @param {number} [options.max_tokens=4096] - Max tokens
 * @param {Array} [options.tools] - Tool definitions
 * @param {string} [options.model] - Model override
 * @param {Function} options.onText - Callback for each text chunk: (chunk: string) => void
 * @returns {Promise<Object>} Response object with { content, usage, stop_reason } matching non-streaming shape
 */
async function generateResponseStream({ messages, system, staticSystem, dynamicSystem, max_tokens = 4096, tools, model, onText }) {
    if (!ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not configured');
    }

    // Build system blocks with prompt caching (same logic as generateResponse)
    let systemBlocks;
    if (staticSystem !== null && staticSystem !== undefined && dynamicSystem !== undefined) {
        systemBlocks = [
            { type: 'text', text: staticSystem, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: dynamicSystem, cache_control: { type: 'ephemeral' } }
        ];
    } else {
        const systemText = system || '';
        systemBlocks = systemText ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }] : '';
    }

    const body = {
        model: model || ANTHROPIC_MODEL,
        max_tokens,
        system: systemBlocks,
        messages,
        stream: true
    };

    // Add tools with cache_control on last tool definition
    if (tools && tools.length > 0) {
        body.tools = tools.map((tool, i) => {
            if (i === tools.length - 1) {
                return { ...tool, cache_control: { type: 'ephemeral' } };
            }
            return tool;
        });
    }

    const jsonBody = sanitizeJsonString(JSON.stringify(body));

    const hasServerTools = body.tools && body.tools.some(t => t.type === 'web_search_20250305');

    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
    };

    if (hasServerTools) {
        headers['anthropic-beta'] = 'web-search-2025-03-05';
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: jsonBody
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        log.error('Claude streaming API error', { status: response.status, error: errorData });
        if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after');
            const waitSec = retryAfter ? parseInt(retryAfter, 10) : 60;
            throw new Error(`Rate limited — please wait ${waitSec}s and try again, or reduce the data size.`);
        }
        throw new Error(errorData.error?.message || `API request failed with status ${response.status}`);
    }

    // Parse SSE stream — accumulate content blocks to build a response object
    // matching the non-streaming shape: { content: [...], usage: {...}, stop_reason }
    const contentBlocks = []; // Final content array
    let currentBlock = null;  // Block being assembled
    let usage = { input_tokens: 0, output_tokens: 0 };
    let stopReason = null;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6);
            if (jsonStr === '[DONE]') continue;

            let event;
            try { event = JSON.parse(jsonStr); } catch (_e) { continue; }

            switch (event.type) {
                case 'message_start':
                    if (event.message?.usage) {
                        usage.input_tokens = event.message.usage.input_tokens || 0;
                        if (event.message.usage.cache_creation_input_tokens || event.message.usage.cache_read_input_tokens) {
                            log.info('Prompt cache usage (stream)', {
                                cache_read: event.message.usage.cache_read_input_tokens || 0,
                                cache_write: event.message.usage.cache_creation_input_tokens || 0,
                                input_tokens: event.message.usage.input_tokens || 0
                            });
                        }
                    }
                    break;

                case 'content_block_start':
                    if (event.content_block.type === 'text') {
                        currentBlock = { type: 'text', text: '' };
                    } else if (event.content_block.type === 'tool_use') {
                        currentBlock = { type: 'tool_use', id: event.content_block.id, name: event.content_block.name, input: '' };
                    } else if (event.content_block.type === 'server_tool_use') {
                        currentBlock = { type: 'server_tool_use', id: event.content_block.id, name: event.content_block.name, input: '' };
                    } else {
                        currentBlock = { ...event.content_block };
                    }
                    break;

                case 'content_block_delta':
                    if (!currentBlock) break;
                    if (event.delta.type === 'text_delta' && currentBlock.type === 'text') {
                        currentBlock.text += event.delta.text;
                        if (onText) onText(event.delta.text);
                    } else if (event.delta.type === 'input_json_delta' && (currentBlock.type === 'tool_use' || currentBlock.type === 'server_tool_use')) {
                        currentBlock.input += event.delta.partial_json;
                    }
                    break;

                case 'content_block_stop':
                    if (currentBlock) {
                        // Parse accumulated JSON input for tool_use blocks
                        if ((currentBlock.type === 'tool_use' || currentBlock.type === 'server_tool_use') && typeof currentBlock.input === 'string') {
                            try { currentBlock.input = JSON.parse(currentBlock.input); } catch (_e) { currentBlock.input = {}; }
                        }
                        contentBlocks.push(currentBlock);
                        currentBlock = null;
                    }
                    break;

                case 'message_delta':
                    if (event.usage) {
                        usage.output_tokens = event.usage.output_tokens || 0;
                    }
                    if (event.delta?.stop_reason) {
                        stopReason = event.delta.stop_reason;
                    }
                    break;
            }
        }
    }

    return {
        content: contentBlocks,
        usage,
        stop_reason: stopReason
    };
}

module.exports = {
    generateResponse,
    generateResponseStream,
    generateWithKnowledge,
    pickRelevantKnowledge,
    pickRelevantRatedExamples,
    tagMatchFallback,
    streamResponse
};
