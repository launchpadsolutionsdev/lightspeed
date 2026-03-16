-- Migration 048: Add original_text and plain_summary to compliance knowledge base
-- The guide requires exact regulatory text (original_text) + plain-language summary (plain_summary)
-- The existing 'content' column will be kept as a combined field for AI context

ALTER TABLE compliance_knowledge_base ADD COLUMN IF NOT EXISTS original_text TEXT;
ALTER TABLE compliance_knowledge_base ADD COLUMN IF NOT EXISTS plain_summary TEXT;
