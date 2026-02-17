-- 018: Conversations & Collaboration
-- Adds server-side conversation storage and shared prompts for team collaboration

-- ===== Conversations Table =====
-- Stores full Ask Lightspeed conversation threads server-side
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255),
    messages JSONB DEFAULT '[]'::jsonb,
    summary TEXT,
    tone VARCHAR(50) DEFAULT 'professional',
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_org ON conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_org_user ON conversations(organization_id, user_id);

-- ===== Shared Prompts Table =====
-- Organization-wide prompt library for team collaboration
CREATE TABLE IF NOT EXISTS shared_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    prompt_text TEXT NOT NULL,
    category VARCHAR(50) DEFAULT 'general',
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shared_prompts_org ON shared_prompts(organization_id);
CREATE INDEX IF NOT EXISTS idx_shared_prompts_usage ON shared_prompts(organization_id, usage_count DESC);
