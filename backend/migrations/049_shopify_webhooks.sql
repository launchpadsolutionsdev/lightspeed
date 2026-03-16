-- Migration 049: Shopify Webhooks
-- Adds webhook tracking columns to shopify_stores for real-time sync support

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE key = '049_shopify_webhooks') THEN

        -- Add webhook tracking columns to shopify_stores
        ALTER TABLE shopify_stores
            ADD COLUMN IF NOT EXISTS webhooks_registered BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS webhook_url VARCHAR(512);

        INSERT INTO _migration_flags (key) VALUES ('049_shopify_webhooks');
        RAISE NOTICE 'Migration 049_shopify_webhooks applied successfully';
    ELSE
        RAISE NOTICE 'Migration 049_shopify_webhooks already applied';
    END IF;
END $$;
