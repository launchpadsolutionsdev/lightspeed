-- Migration 028: Per-tool voice profiles, KB gap logging, conversation summaries, content calendar
--
-- 1. Add tool column to voice_profiles for per-tool fingerprints
-- 2. Create kb_gaps table for tracking knowledge base coverage gaps
-- 3. Add running_summary column to conversations for auto-summarization
-- 4. Create content_calendar table for scheduled content planning

-- 1. Per-tool voice profiles
ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS tool VARCHAR(50) DEFAULT 'general';

-- Drop the old unique constraint and add a new one including tool
ALTER TABLE voice_profiles DROP CONSTRAINT IF EXISTS voice_profiles_organization_id_key;
ALTER TABLE voice_profiles ADD CONSTRAINT voice_profiles_org_tool_unique UNIQUE (organization_id, tool);

-- 2. KB gap tracking
CREATE TABLE IF NOT EXISTS kb_gaps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    inquiry TEXT NOT NULL,
    tool VARCHAR(50) DEFAULT 'response_assistant',
    kb_results_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_gaps_org ON kb_gaps (organization_id, created_at DESC);

-- 3. Running summary and semantic embedding for conversation auto-summarization
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS running_summary TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summary_embedding vector(512);

-- 4. Content calendar
CREATE TABLE IF NOT EXISTS content_calendar (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content_type VARCHAR(50) NOT NULL,
    scheduled_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'planned',
    notes TEXT,
    generated_content TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_calendar_org_date ON content_calendar (organization_id, scheduled_date);
