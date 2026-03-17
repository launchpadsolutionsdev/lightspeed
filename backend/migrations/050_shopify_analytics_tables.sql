-- Migration 050: Shopify Analytics Dashboard Tables
-- Creates pre-computed analytics tables for the dashboard and adds sync tracking columns

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '050_shopify_analytics_tables') THEN

        -- Add analytics sync columns to shopify_stores
        ALTER TABLE shopify_stores
            ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) DEFAULT 'CAD',
            ADD COLUMN IF NOT EXISTS last_full_sync_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS last_incremental_sync_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS analytics_sync_status VARCHAR(20) DEFAULT 'pending',
            ADD COLUMN IF NOT EXISTS analytics_sync_error TEXT;

        -- Daily sales metrics: one row per store per day
        CREATE TABLE IF NOT EXISTS daily_sales_metrics (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            gross_sales_cents BIGINT DEFAULT 0,
            net_sales_cents BIGINT DEFAULT 0,
            refunds_cents BIGINT DEFAULT 0,
            discounts_cents BIGINT DEFAULT 0,
            taxes_cents BIGINT DEFAULT 0,
            shipping_cents BIGINT DEFAULT 0,
            total_orders INTEGER DEFAULT 0,
            total_units_sold INTEGER DEFAULT 0,
            new_customers INTEGER DEFAULT 0,
            returning_customers INTEGER DEFAULT 0,
            average_order_value_cents BIGINT DEFAULT 0,
            fulfilled_orders INTEGER DEFAULT 0,
            unfulfilled_orders INTEGER DEFAULT 0,
            partially_fulfilled_orders INTEGER DEFAULT 0,
            cancelled_orders INTEGER DEFAULT 0,
            refunded_orders INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(organization_id, date)
        );

        CREATE INDEX IF NOT EXISTS idx_daily_sales_org_date
            ON daily_sales_metrics(organization_id, date DESC);

        -- Product sales metrics: per product per day
        CREATE TABLE IF NOT EXISTS product_sales_metrics (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            product_id VARCHAR(255),
            product_title VARCHAR(500),
            variant_title VARCHAR(500),
            revenue_cents BIGINT DEFAULT 0,
            units_sold INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(organization_id, date, product_id)
        );

        CREATE INDEX IF NOT EXISTS idx_product_sales_org_date
            ON product_sales_metrics(organization_id, date DESC);

        -- Sales by channel
        CREATE TABLE IF NOT EXISTS sales_by_channel (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            channel_name VARCHAR(255),
            revenue_cents BIGINT DEFAULT 0,
            order_count INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(organization_id, date, channel_name)
        );

        CREATE INDEX IF NOT EXISTS idx_sales_channel_org_date
            ON sales_by_channel(organization_id, date DESC);

        -- Sales by region
        CREATE TABLE IF NOT EXISTS sales_by_region (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            province VARCHAR(100),
            country VARCHAR(100),
            revenue_cents BIGINT DEFAULT 0,
            order_count INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(organization_id, date, province, country)
        );

        CREATE INDEX IF NOT EXISTS idx_sales_region_org_date
            ON sales_by_region(organization_id, date DESC);

        -- Recent orders cache for live feed (last 100 per org)
        CREATE TABLE IF NOT EXISTS dashboard_recent_orders (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            shopify_order_id VARCHAR(255) NOT NULL,
            order_number VARCHAR(50),
            created_at TIMESTAMPTZ,
            total_price_cents BIGINT,
            currency_code VARCHAR(3),
            financial_status VARCHAR(50),
            fulfillment_status VARCHAR(50),
            customer_name VARCHAR(255),
            customer_email VARCHAR(255),
            province VARCHAR(100),
            country VARCHAR(100),
            line_items_summary JSONB,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(organization_id, shopify_order_id)
        );

        CREATE INDEX IF NOT EXISTS idx_dashboard_recent_orders_org_created
            ON dashboard_recent_orders(organization_id, created_at DESC);

        -- Analytics sync log
        CREATE TABLE IF NOT EXISTS analytics_sync_log (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            sync_type VARCHAR(20) NOT NULL,
            started_at TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            status VARCHAR(20) DEFAULT 'running',
            records_processed INTEGER DEFAULT 0,
            error_message TEXT,
            metadata JSONB
        );

        CREATE INDEX IF NOT EXISTS idx_analytics_sync_log_org
            ON analytics_sync_log(organization_id, started_at DESC);

        INSERT INTO _migration_flags (key) VALUES ('050_shopify_analytics_tables');
        RAISE NOTICE 'Migration 050_shopify_analytics_tables applied successfully';
    ELSE
        RAISE NOTICE 'Migration 050_shopify_analytics_tables already applied';
    END IF;
END $$;
