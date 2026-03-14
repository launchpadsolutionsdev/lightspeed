/**
 * Test the chunking logic directly.
 * We extract the pure splitIntoChunks function to avoid importing
 * database dependencies that aren't available in test environment.
 */

// Inline the pure chunking logic for testing (mirrors chunkingService.js)
const MIN_CHUNK_CHARS = 200;
const TARGET_CHUNK_CHARS = 1600;
const MAX_CHUNK_CHARS = 3200;

function splitIntoChunks(text) {
    if (!text || text.trim().length === 0) return [];
    if (text.length <= MAX_CHUNK_CHARS) return [text.trim()];

    const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);

    const segments = [];
    for (const para of paragraphs) {
        if (para.length <= MAX_CHUNK_CHARS) {
            segments.push(para);
        } else {
            const sentences = para.match(/[^.!?]+[.!?]+\s*/g) || [para];
            let current = '';
            for (const sentence of sentences) {
                if (current.length + sentence.length > MAX_CHUNK_CHARS && current.length > 0) {
                    segments.push(current.trim());
                    current = '';
                }
                current += sentence;
            }
            if (current.trim().length > 0) segments.push(current.trim());
        }
    }

    const chunks = [];
    let currentChunk = '';

    for (const segment of segments) {
        if (currentChunk.length === 0) {
            currentChunk = segment;
        } else if (currentChunk.length + segment.length + 2 <= TARGET_CHUNK_CHARS) {
            currentChunk += '\n\n' + segment;
        } else {
            if (currentChunk.length >= MIN_CHUNK_CHARS) {
                chunks.push(currentChunk);
            } else if (chunks.length > 0) {
                chunks[chunks.length - 1] += '\n\n' + currentChunk;
            } else {
                chunks.push(currentChunk);
            }
            currentChunk = segment;
        }
    }

    if (currentChunk.length > 0) {
        if (currentChunk.length >= MIN_CHUNK_CHARS || chunks.length === 0) {
            chunks.push(currentChunk);
        } else if (chunks.length > 0) {
            chunks[chunks.length - 1] += '\n\n' + currentChunk;
        }
    }

    return chunks;
}

describe('chunkingService - splitIntoChunks', () => {
    it('returns empty array for empty input', () => {
        expect(splitIntoChunks('')).toEqual([]);
        expect(splitIntoChunks(null)).toEqual([]);
        expect(splitIntoChunks(undefined)).toEqual([]);
    });

    it('returns single chunk for short text', () => {
        const text = 'This is a short article about return policies.';
        const chunks = splitIntoChunks(text);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toBe(text);
    });

    it('returns single chunk for text within MAX_CHUNK_CHARS', () => {
        const text = 'A'.repeat(3000);
        const chunks = splitIntoChunks(text);
        expect(chunks).toHaveLength(1);
    });

    it('splits long text on paragraph boundaries', () => {
        const paragraphs = Array.from({ length: 10 }, (_, i) =>
            `Paragraph ${i + 1}. ${'This is filler content. '.repeat(20)}`
        );
        const text = paragraphs.join('\n\n');
        const chunks = splitIntoChunks(text);

        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.length).toBeLessThan(10);
    });

    it('splits oversized paragraphs on sentence boundaries', () => {
        const sentences = Array.from({ length: 50 }, (_, i) =>
            `This is sentence number ${i + 1} with some additional filler content to make it longer.`
        );
        const text = sentences.join(' ');
        const chunks = splitIntoChunks(text);

        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(3400); // Small tolerance
        }
    });

    it('merges tiny paragraphs together', () => {
        const text = 'Yes.\n\nNo.\n\nMaybe.\n\nOk.\n\n' + 'This is a longer paragraph that has real content. '.repeat(5);
        const chunks = splitIntoChunks(text);
        expect(chunks.length).toBeLessThan(5);
    });

    it('preserves all content (no data loss)', () => {
        const paragraphs = Array.from({ length: 8 }, (_, i) =>
            `Section ${i + 1}: ${'Important information. '.repeat(15)}`
        );
        const text = paragraphs.join('\n\n');
        const chunks = splitIntoChunks(text);
        const reconstructed = chunks.join('\n\n');

        for (let i = 1; i <= 8; i++) {
            expect(reconstructed).toContain(`Section ${i}:`);
        }
    });

    it('handles text with no paragraph breaks but sentence endings', () => {
        const text = 'This is a sentence. '.repeat(200); // ~4000 chars, sentences but no paragraphs
        const chunks = splitIntoChunks(text);
        expect(chunks.length).toBeGreaterThan(1);
    });
});
