-- Drop the draw_schedules table.
-- Draw/event scheduling is now managed exclusively through the Runway calendar (calendar_events table).
DROP TABLE IF EXISTS draw_schedules;
