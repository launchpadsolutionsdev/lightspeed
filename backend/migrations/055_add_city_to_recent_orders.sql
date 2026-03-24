-- Migration 055: Add city column to dashboard_recent_orders
-- Enables geo fallback from recent orders when sales_by_city has no data for today

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '055_add_city_to_recent_orders') THEN

        ALTER TABLE dashboard_recent_orders
            ADD COLUMN IF NOT EXISTS city VARCHAR(255);

        INSERT INTO _migration_flags (key) VALUES ('055_add_city_to_recent_orders');
        RAISE NOTICE 'Migration 055_add_city_to_recent_orders applied successfully';
    ELSE
        RAISE NOTICE 'Migration 055_add_city_to_recent_orders already applied';
    END IF;
END $$;
