-- Migration 033: Add category column to calendar_events
-- Supports preset categories (Ad Launch, Social Post, Email Campaign, Deadline, Meeting) and custom labels

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'calendar_events' AND column_name = 'category'
    ) THEN
        ALTER TABLE calendar_events ADD COLUMN category VARCHAR(50) DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'calendar_events' AND column_name = 'reminder_minutes'
    ) THEN
        ALTER TABLE calendar_events ADD COLUMN reminder_minutes INTEGER DEFAULT NULL;
    END IF;
END $$;
