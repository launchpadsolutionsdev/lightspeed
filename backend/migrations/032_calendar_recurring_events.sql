-- Migration 032: Add recurring event support to calendar_events
-- Adds recurrence_rule (daily/weekly/monthly) and recurrence_end_date columns

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'calendar_events' AND column_name = 'recurrence_rule'
    ) THEN
        ALTER TABLE calendar_events ADD COLUMN recurrence_rule VARCHAR(20) DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'calendar_events' AND column_name = 'recurrence_end_date'
    ) THEN
        ALTER TABLE calendar_events ADD COLUMN recurrence_end_date DATE DEFAULT NULL;
    END IF;
END $$;
