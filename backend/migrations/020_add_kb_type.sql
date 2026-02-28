-- Migration 020: Add kb_type column to knowledge_base table
-- Splits knowledge base into 'support' (customer-facing) and 'internal' (operations) types

ALTER TABLE knowledge_base
    ADD COLUMN IF NOT EXISTS kb_type VARCHAR(20) NOT NULL DEFAULT 'support';

-- Composite index for fast org + type lookups
CREATE INDEX IF NOT EXISTS idx_knowledge_base_type
    ON knowledge_base(organization_id, kb_type);

-- Auto-classify entries that are clearly internal/brand-related
UPDATE knowledge_base
SET kb_type = 'internal'
WHERE kb_type = 'support'
  AND (
    category IN ('brand_voice', 'terminology', 'internal')
    OR title ILIKE '%brand voice%'
    OR title ILIKE '%terminology%'
    OR title ILIKE '%media contact%'
    OR title ILIKE '%brand guidelines%'
    OR title ILIKE '%style guide%'
  );
