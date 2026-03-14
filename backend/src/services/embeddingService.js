/**
 * Embedding Service
 *
 * Generates text embeddings using Voyager (via the Anthropic ecosystem)
 * for semantic search over knowledge base chunks.
 *
 * Uses the Voyage AI embeddings API (voyage-3-lite, 512 dimensions)
 * which is optimized for retrieval tasks.
 */

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const VOYAGE_MODEL = 'voyage-3-lite';
const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';

/**
 * Generate embeddings for one or more texts.
 *
 * @param {string[]} texts - Array of text strings to embed
 * @param {string} inputType - 'document' for KB content, 'query' for search queries
 * @returns {Promise<number[][]>} Array of embedding vectors (512 dimensions each)
 */
async function generateEmbeddings(texts, inputType = 'document') {
    if (!VOYAGE_API_KEY) {
        console.warn('[EMBEDDING] VOYAGE_API_KEY not configured, skipping embedding generation');
        return null;
    }

    if (!texts || texts.length === 0) return [];

    // Voyage API supports batching up to 128 texts at once
    const BATCH_SIZE = 128;
    const allEmbeddings = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);

        const response = await fetch(VOYAGE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${VOYAGE_API_KEY}`
            },
            body: JSON.stringify({
                model: VOYAGE_MODEL,
                input: batch,
                input_type: inputType
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            console.warn('[EMBEDDING] Voyage API error:', response.status, errData);
            return null;
        }

        const data = await response.json();
        const embeddings = data.data.map(d => d.embedding);
        allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
}

/**
 * Generate a single embedding for a search query.
 *
 * @param {string} query - The search query text
 * @returns {Promise<number[]|null>} Embedding vector or null if unavailable
 */
async function embedQuery(query) {
    const result = await generateEmbeddings([query], 'query');
    return result ? result[0] : null;
}

/**
 * Format an embedding vector for PostgreSQL pgvector insertion.
 * pgvector expects the format: '[0.1, 0.2, ...]'
 *
 * @param {number[]} embedding - The embedding vector
 * @returns {string} Formatted string for SQL
 */
function formatForPgvector(embedding) {
    return `[${embedding.join(',')}]`;
}

module.exports = {
    generateEmbeddings,
    embedQuery,
    formatForPgvector
};
