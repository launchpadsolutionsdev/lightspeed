-- Migration 026: Semantic search (pgvector), smart chunking, and dynamic budgets
--
-- Three upgrades in one migration:
-- 1. pgvector extension + embedding column on knowledge_base for semantic search
-- 2. kb_chunks table for smart chunking (smaller, self-contained pieces)
-- 3. Both chunks and parent entries get embeddings for vector similarity search

-- ============================================================
-- 1. PGVECTOR EXTENSION
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 2. KB CHUNKS TABLE
-- ============================================================
-- Each knowledge_base entry can be split into smaller chunks.
-- Chunks are the unit of retrieval — not full articles.
CREATE TABLE IF NOT EXISTS kb_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,
    tags TEXT[] DEFAULT '{}',
    kb_type VARCHAR(20) NOT NULL DEFAULT 'support',
    embedding vector(1024),
    search_vector tsvector,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for chunk retrieval
CREATE INDEX IF NOT EXISTS idx_kb_chunks_parent ON kb_chunks(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_org ON kb_chunks(organization_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_org_type ON kb_chunks(organization_id, kb_type);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_search ON kb_chunks USING GIN(search_vector);

-- HNSW index for fast approximate nearest neighbor search on embeddings
-- Using cosine distance (<=>) which works well for normalized embeddings
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding ON kb_chunks USING hnsw(embedding vector_cosine_ops);

-- Auto-update search_vector on chunk insert/update
CREATE OR REPLACE FUNCTION kb_chunk_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B');
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kb_chunk_search_vector_trigger ON kb_chunks;
CREATE TRIGGER kb_chunk_search_vector_trigger
    BEFORE INSERT OR UPDATE OF title, content ON kb_chunks
    FOR EACH ROW EXECUTE FUNCTION kb_chunk_search_vector_update();

-- ============================================================
-- 3. TRACK WHETHER A KB ENTRY HAS BEEN CHUNKED
-- ============================================================
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS is_chunked BOOLEAN DEFAULT FALSE;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS chunk_count INTEGER DEFAULT 0;
