-- Migration 027: Fix embedding dimension mismatch
--
-- voyage-3-lite produces 512-dimensional embeddings, not 1024.
-- This migration corrects the column type and rebuilds the HNSW index.

-- 1. Drop the existing HNSW index
DROP INDEX IF EXISTS idx_kb_chunks_embedding;

-- 2. Alter the column from vector(1024) to vector(512)
ALTER TABLE kb_chunks ALTER COLUMN embedding TYPE vector(512);

-- 3. Recreate the HNSW index with correct dimensions
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding ON kb_chunks USING hnsw(embedding vector_cosine_ops);
