-- Migration 025: Conversation Memory + Voice Fingerprinting
--
-- Adds full-text search to conversations for memory retrieval,
-- and a voice_profiles table for per-org tone fingerprinting.

-- 1. Full-text search on conversations (title + summary)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_conversations_search ON conversations USING GIN (search_vector);

CREATE OR REPLACE FUNCTION conversations_search_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector := to_tsvector('english', COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.summary, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS conversations_search_trigger ON conversations;
CREATE TRIGGER conversations_search_trigger
    BEFORE INSERT OR UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION conversations_search_update();

-- Backfill existing rows
UPDATE conversations SET search_vector = to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(summary, ''));

-- 2. Voice profiles table (one per org)
CREATE TABLE IF NOT EXISTS voice_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    profile_text TEXT NOT NULL,
    source_count INTEGER DEFAULT 0,
    last_analyzed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id)
);

CREATE INDEX IF NOT EXISTS idx_voice_profiles_org ON voice_profiles (organization_id);
