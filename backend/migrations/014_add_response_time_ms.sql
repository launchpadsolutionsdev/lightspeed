-- Add response_time_ms column to usage_logs for real performance metrics
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS response_time_ms INTEGER;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS success BOOLEAN DEFAULT TRUE;
