-- Add sessions column to daily_sales_metrics for online store session counts
ALTER TABLE daily_sales_metrics ADD COLUMN IF NOT EXISTS sessions INTEGER DEFAULT 0;
