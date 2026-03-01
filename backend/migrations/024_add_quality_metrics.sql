-- Migration 024: Add quality metrics columns to response_history
--
-- Tracks per-response quality signals so the stats endpoint can report
-- on response quality trends, not just volume.

ALTER TABLE response_history
    ADD COLUMN IF NOT EXISTS char_count INTEGER,
    ADD COLUMN IF NOT EXISTS word_count INTEGER,
    ADD COLUMN IF NOT EXISTS kb_entries_used INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quality_violations JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS response_time_ms INTEGER;

-- Backfill char_count and word_count for existing rows
UPDATE response_history
SET char_count = LENGTH(response),
    word_count = array_length(regexp_split_to_array(trim(response), '\s+'), 1)
WHERE char_count IS NULL AND response IS NOT NULL;
