-- Add index on usage_logs(user_id) for faster lookups
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
