/**
 * Chunking Service
 *
 * Splits knowledge base articles into smaller, self-contained chunks
 * for more precise retrieval. Each chunk carries its parent's metadata
 * (category, tags, kb_type) so it can be used independently.
 *
 * Chunking strategy:
 * 1. Split on double newlines (paragraph boundaries)
 * 2. Merge small paragraphs together to avoid tiny chunks
 * 3. Split oversized paragraphs on sentence boundaries
 * 4. Each chunk targets 300-800 tokens (~1200-3200 chars)
 */

const pool = require('../../config/database');
const { generateEmbeddings, formatForPgvector } = require('./embeddingService');
const { estimateTokens } = require('./tokenCounter');

const MIN_CHUNK_CHARS = 200;   // ~50 tokens — too small to be useful alone
const TARGET_CHUNK_CHARS = 1600; // ~400 tokens — sweet spot for retrieval
const MAX_CHUNK_CHARS = 3200;  // ~800 tokens — upper limit per chunk

/**
 * Split text into chunks at natural boundaries.
 *
 * @param {string} text - The full article text
 * @param {string} title - The article title (prepended to first chunk for context)
 * @returns {string[]} Array of chunk texts
 */
function splitIntoChunks(text) {
    if (!text || text.trim().length === 0) return [];

    // If the entire text is small enough, return as a single chunk
    if (text.length <= MAX_CHUNK_CHARS) {
        return [text.trim()];
    }

    // Step 1: Split on double newlines (paragraph boundaries)
    const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);

    // Step 2: Further split oversized paragraphs on sentence boundaries
    const segments = [];
    for (const para of paragraphs) {
        if (para.length <= MAX_CHUNK_CHARS) {
            segments.push(para);
        } else {
            // Split on sentence endings
            const sentences = para.match(/[^.!?]+[.!?]+\s*/g) || [para];
            let current = '';
            for (const sentence of sentences) {
                if (current.length + sentence.length > MAX_CHUNK_CHARS && current.length > 0) {
                    segments.push(current.trim());
                    current = '';
                }
                current += sentence;
            }
            if (current.trim().length > 0) {
                segments.push(current.trim());
            }
        }
    }

    // Step 3: Merge small segments together to avoid tiny chunks
    const chunks = [];
    let currentChunk = '';

    for (const segment of segments) {
        if (currentChunk.length === 0) {
            currentChunk = segment;
        } else if (currentChunk.length + segment.length + 2 <= TARGET_CHUNK_CHARS) {
            currentChunk += '\n\n' + segment;
        } else {
            // Current chunk is big enough, finalize it
            if (currentChunk.length >= MIN_CHUNK_CHARS) {
                chunks.push(currentChunk);
            } else if (chunks.length > 0) {
                // Too small on its own — append to previous chunk
                chunks[chunks.length - 1] += '\n\n' + currentChunk;
            } else {
                chunks.push(currentChunk);
            }
            currentChunk = segment;
        }
    }

    // Finalize the last chunk
    if (currentChunk.length > 0) {
        if (currentChunk.length >= MIN_CHUNK_CHARS || chunks.length === 0) {
            chunks.push(currentChunk);
        } else if (chunks.length > 0) {
            chunks[chunks.length - 1] += '\n\n' + currentChunk;
        }
    }

    return chunks;
}

/**
 * Chunk a knowledge base entry and store the chunks in the database.
 * Generates embeddings for each chunk if VOYAGE_API_KEY is configured.
 *
 * @param {object} entry - The KB entry { id, organization_id, title, content, category, tags, kb_type }
 * @returns {Promise<number>} Number of chunks created
 */
async function chunkAndStore(entry) {
    const { id, organization_id, title, content, category, tags, kb_type } = entry;

    // Delete existing chunks for this entry (re-chunking on update)
    await pool.query('DELETE FROM kb_chunks WHERE knowledge_base_id = $1', [id]);

    const chunkTexts = splitIntoChunks(content);
    if (chunkTexts.length === 0) return 0;

    // Generate embeddings for all chunks in one batch
    const textsForEmbedding = chunkTexts.map((text, i) =>
        `${title}${i > 0 ? ` (part ${i + 1})` : ''}: ${text}`
    );
    const embeddings = await generateEmbeddings(textsForEmbedding, 'document');

    // Insert chunks
    for (let i = 0; i < chunkTexts.length; i++) {
        const chunkTitle = chunkTexts.length === 1
            ? title
            : `${title} (part ${i + 1}/${chunkTexts.length})`;

        const embedding = embeddings ? embeddings[i] : null;

        if (embedding) {
            await pool.query(
                `INSERT INTO kb_chunks (knowledge_base_id, organization_id, chunk_index, title, content, category, tags, kb_type, embedding)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [id, organization_id, i, chunkTitle, chunkTexts[i], category, tags || [], kb_type || 'support', formatForPgvector(embedding)]
            );
        } else {
            await pool.query(
                `INSERT INTO kb_chunks (knowledge_base_id, organization_id, chunk_index, title, content, category, tags, kb_type)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [id, organization_id, i, chunkTitle, chunkTexts[i], category, tags || [], kb_type || 'support']
            );
        }
    }

    // Mark the parent entry as chunked
    await pool.query(
        'UPDATE knowledge_base SET is_chunked = TRUE, chunk_count = $1 WHERE id = $2',
        [chunkTexts.length, id]
    );

    return chunkTexts.length;
}

/**
 * Re-chunk all KB entries for an organization.
 * Useful for backfilling after enabling the chunking feature.
 *
 * @param {string} organizationId
 * @returns {Promise<{processed: number, totalChunks: number}>}
 */
async function rechunkAllEntries(organizationId) {
    const result = await pool.query(
        'SELECT id, organization_id, title, content, category, tags, kb_type FROM knowledge_base WHERE organization_id = $1',
        [organizationId]
    );

    let totalChunks = 0;
    for (const entry of result.rows) {
        const count = await chunkAndStore(entry);
        totalChunks += count;
    }

    return { processed: result.rows.length, totalChunks };
}

module.exports = {
    splitIntoChunks,
    chunkAndStore,
    rechunkAllEntries
};
