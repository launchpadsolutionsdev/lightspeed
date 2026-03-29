-- Add token tracking columns to usage_logs for admin dashboard analytics.
-- These columns allow per-request input/output token counts to be recorded
-- alongside existing usage data.

ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS input_tokens INTEGER;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS output_tokens INTEGER;
