-- Migration 031: Upgrade calendar_events for Google Calendar-style features
-- Adds: description, all_day, visibility, start_time/end_time (timestamp)

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS all_day BOOLEAN DEFAULT false;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) DEFAULT 'personal';
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS end_time TIME;

-- Migrate existing data: events with event_time set are timed, others are all-day
UPDATE calendar_events SET all_day = true WHERE event_time IS NULL;
UPDATE calendar_events SET all_day = false WHERE event_time IS NOT NULL;
UPDATE calendar_events SET visibility = 'personal' WHERE visibility IS NULL;
