-- Migration 029: Ensure content_calendar table exists
--
-- Migration 028 could fail partway through if the vector extension is not
-- available (the summary_embedding column requires pgvector). When that
-- happens the content_calendar CREATE TABLE that follows never runs.
-- This migration is idempotent and guarantees the table exists.

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
