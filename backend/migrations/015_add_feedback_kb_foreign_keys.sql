-- Add proper foreign key columns to link feedback-created KB entries
-- to the response_history records that spawned them.
-- Replaces the fragile string-marker approach ("[KB entry created: uuid]" in rating_feedback).

-- On knowledge_base: which response_history record prompted this entry
ALTER TABLE knowledge_base
    ADD COLUMN IF NOT EXISTS source_response_id UUID REFERENCES response_history(id) ON DELETE SET NULL;

-- On response_history: which KB entry was created from the feedback
ALTER TABLE response_history
    ADD COLUMN IF NOT EXISTS feedback_kb_entry_id UUID REFERENCES knowledge_base(id) ON DELETE SET NULL;

-- Index for the rated-examples JOIN
CREATE INDEX IF NOT EXISTS idx_response_history_feedback_kb
    ON response_history(feedback_kb_entry_id)
    WHERE feedback_kb_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_base_source_response
    ON knowledge_base(source_response_id)
    WHERE source_response_id IS NOT NULL;
