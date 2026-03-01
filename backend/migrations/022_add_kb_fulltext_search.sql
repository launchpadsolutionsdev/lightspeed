-- Migration 022: Add full-text search to knowledge_base
--
-- Adds a tsvector column with a GIN index and auto-update trigger so that
-- KB entries can be pre-filtered with PostgreSQL full-text search before
-- sending candidates to Haiku for relevance picking.
--
-- This replaces the previous approach of loading ALL KB entries into memory.

-- 1. Add tsvector column
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Populate from existing data (title weighted higher than content)
UPDATE knowledge_base SET search_vector =
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
WHERE search_vector IS NULL;

-- 3. GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_knowledge_base_search ON knowledge_base USING GIN(search_vector);

-- 4. Trigger to auto-update search_vector on INSERT or UPDATE
CREATE OR REPLACE FUNCTION kb_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B');
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Drop trigger if it already exists (idempotent)
DROP TRIGGER IF EXISTS kb_search_vector_trigger ON knowledge_base;

CREATE TRIGGER kb_search_vector_trigger
    BEFORE INSERT OR UPDATE OF title, content ON knowledge_base
    FOR EACH ROW EXECUTE FUNCTION kb_search_vector_update();
