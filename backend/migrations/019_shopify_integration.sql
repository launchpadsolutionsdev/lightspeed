-- Migration 019: Shopify Integration
-- Adds tables for Shopify store connections, product cache, order cache, and sync logs

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '019_shopify_integration') THEN

        -- Shopify store connections (one per organization)
        CREATE TABLE shopify_stores (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
            shop_domain VARCHAR(255) NOT NULL,          -- e.g., mystore.myshopify.com
            access_token VARCHAR(512) NOT NULL,          -- Shopify API access token
            scope TEXT,                                   -- Comma-separated granted scopes
            installed_at TIMESTAMPTZ DEFAULT NOW(),
            is_active BOOLEAN DEFAULT TRUE,
            last_products_sync_at TIMESTAMPTZ,
            last_orders_sync_at TIMESTAMPTZ,
            last_customers_sync_at TIMESTAMPTZ,
            sync_settings JSONB DEFAULT '{"auto_sync_products": true, "auto_sync_orders": true, "auto_sync_customers": true, "sync_interval_minutes": 60}',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX idx_shopify_stores_org ON shopify_stores(organization_id);
        CREATE INDEX idx_shopify_stores_domain ON shopify_stores(shop_domain);

        -- Cached Shopify products
        CREATE TABLE shopify_products (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            shopify_product_id BIGINT NOT NULL,
            title VARCHAR(500) NOT NULL,
            body_html TEXT,
            vendor VARCHAR(255),
            product_type VARCHAR(255),
            handle VARCHAR(255),
            status VARCHAR(50),                          -- active, archived, draft
            tags TEXT[],
            variants JSONB DEFAULT '[]',                 -- [{id, title, price, sku, inventory_quantity, ...}]
            images JSONB DEFAULT '[]',                   -- [{id, src, alt, ...}]
            featured_image_url VARCHAR(1000),
            created_at_shopify TIMESTAMPTZ,
            updated_at_shopify TIMESTAMPTZ,
            synced_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE UNIQUE INDEX idx_shopify_products_org_pid ON shopify_products(organization_id, shopify_product_id);
        CREATE INDEX idx_shopify_products_org ON shopify_products(organization_id);
        CREATE INDEX idx_shopify_products_status ON shopify_products(organization_id, status);

        -- Cached Shopify orders (recent orders for context)
        CREATE TABLE shopify_orders (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            shopify_order_id BIGINT NOT NULL,
            order_number VARCHAR(50),                    -- Human-readable order number (#1001)
            email VARCHAR(255),
            financial_status VARCHAR(50),                -- paid, pending, refunded, partially_refunded
            fulfillment_status VARCHAR(50),              -- fulfilled, partial, unfulfilled, null
            total_price DECIMAL(10,2),
            subtotal_price DECIMAL(10,2),
            currency VARCHAR(10) DEFAULT 'CAD',
            customer_name VARCHAR(255),
            customer_email VARCHAR(255),
            line_items JSONB DEFAULT '[]',               -- [{title, quantity, price, sku, ...}]
            shipping_address JSONB,
            note TEXT,
            tags TEXT[],
            created_at_shopify TIMESTAMPTZ,
            updated_at_shopify TIMESTAMPTZ,
            synced_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE UNIQUE INDEX idx_shopify_orders_org_oid ON shopify_orders(organization_id, shopify_order_id);
        CREATE INDEX idx_shopify_orders_org ON shopify_orders(organization_id);
        CREATE INDEX idx_shopify_orders_email ON shopify_orders(organization_id, customer_email);
        CREATE INDEX idx_shopify_orders_number ON shopify_orders(organization_id, order_number);
        CREATE INDEX idx_shopify_orders_created ON shopify_orders(organization_id, created_at_shopify DESC);

        -- Cached Shopify customers
        CREATE TABLE shopify_customers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            shopify_customer_id BIGINT NOT NULL,
            email VARCHAR(255),
            first_name VARCHAR(255),
            last_name VARCHAR(255),
            phone VARCHAR(50),
            orders_count INTEGER DEFAULT 0,
            total_spent DECIMAL(10,2) DEFAULT 0,
            tags TEXT[],
            city VARCHAR(255),
            province VARCHAR(255),
            country VARCHAR(10),
            zip VARCHAR(20),
            created_at_shopify TIMESTAMPTZ,
            updated_at_shopify TIMESTAMPTZ,
            synced_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE UNIQUE INDEX idx_shopify_customers_org_cid ON shopify_customers(organization_id, shopify_customer_id);
        CREATE INDEX idx_shopify_customers_org ON shopify_customers(organization_id);
        CREATE INDEX idx_shopify_customers_email ON shopify_customers(organization_id, email);

        -- Sync activity logs
        CREATE TABLE shopify_sync_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            sync_type VARCHAR(50) NOT NULL,              -- products, orders, customers, full
            status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, running, success, error
            records_synced INTEGER DEFAULT 0,
            error_message TEXT,
            started_at TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX idx_shopify_sync_logs_org ON shopify_sync_logs(organization_id);
        CREATE INDEX idx_shopify_sync_logs_created ON shopify_sync_logs(created_at DESC);

        INSERT INTO _migration_flags (key) VALUES ('019_shopify_integration');
        RAISE NOTICE 'Migration 019_shopify_integration applied successfully';
    ELSE
        RAISE NOTICE 'Migration 019_shopify_integration already applied';
    END IF;
END $$;
