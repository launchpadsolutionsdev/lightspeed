-- Track discount codes used in orders for the Heartbeat Shopify Intelligence section
CREATE TABLE IF NOT EXISTS order_discount_codes (
    id              BIGSERIAL PRIMARY KEY,
    organization_id UUID NOT NULL,
    order_date      DATE NOT NULL,
    discount_code   VARCHAR(255) NOT NULL,
    discount_amount_cents INTEGER NOT NULL DEFAULT 0,
    discount_type   VARCHAR(50) DEFAULT 'fixed_amount',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_discount_codes_org_date
    ON order_discount_codes (organization_id, order_date DESC);

CREATE INDEX IF NOT EXISTS idx_order_discount_codes_org_code
    ON order_discount_codes (organization_id, discount_code);
