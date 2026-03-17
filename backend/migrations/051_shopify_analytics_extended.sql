-- Migration 051: Extended Shopify Analytics Tables
-- Adds top customers, city breakdown, and price point tables

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '051_shopify_analytics_extended') THEN

        -- Top customers (whales) - aggregated per store
        CREATE TABLE IF NOT EXISTS shopify_top_customers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            customer_email VARCHAR(255),
            customer_name VARCHAR(255),
            total_spent_cents BIGINT DEFAULT 0,
            order_count INTEGER DEFAULT 0,
            last_order_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(organization_id, customer_email)
        );

        CREATE INDEX IF NOT EXISTS idx_top_customers_org_spent
            ON shopify_top_customers(organization_id, total_spent_cents DESC);

        -- Sales by city
        CREATE TABLE IF NOT EXISTS sales_by_city (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            city VARCHAR(255),
            province VARCHAR(100),
            country VARCHAR(100),
            revenue_cents BIGINT DEFAULT 0,
            order_count INTEGER DEFAULT 0,
            customer_count INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(organization_id, date, city, province)
        );

        CREATE INDEX IF NOT EXISTS idx_sales_city_org_date
            ON sales_by_city(organization_id, date DESC);

        -- Price point performance
        CREATE TABLE IF NOT EXISTS price_point_metrics (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            price_bucket VARCHAR(50) NOT NULL,
            product_title VARCHAR(500),
            unit_price_cents BIGINT DEFAULT 0,
            units_sold INTEGER DEFAULT 0,
            revenue_cents BIGINT DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(organization_id, date, price_bucket, product_title)
        );

        CREATE INDEX IF NOT EXISTS idx_price_points_org_date
            ON price_point_metrics(organization_id, date DESC);

        INSERT INTO _migration_flags (key) VALUES ('051_shopify_analytics_extended');
        RAISE NOTICE 'Migration 051_shopify_analytics_extended applied successfully';
    ELSE
        RAISE NOTICE 'Migration 051_shopify_analytics_extended already applied';
    END IF;
END $$;
