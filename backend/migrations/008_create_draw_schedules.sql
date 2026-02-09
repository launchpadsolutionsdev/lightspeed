-- Create draw_schedules table for org-specific draw schedule management
-- Each organization can upload/manage their own monthly draw schedule
-- which feeds into Response Assistant, Draft Assistant, and Lightspeed AI context

CREATE TABLE IF NOT EXISTS draw_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    draw_name VARCHAR(255) NOT NULL,
    grand_prize_date TIMESTAMP WITH TIME ZONE,
    ticket_sales_start TIMESTAMP WITH TIME ZONE,
    ticket_sales_end TIMESTAMP WITH TIME ZONE,
    guaranteed_prize VARCHAR(100),
    prize_description TEXT,
    early_birds JSONB DEFAULT '[]',
    pricing JSONB DEFAULT '[]',
    raw_source_text TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_draw_schedules_org ON draw_schedules(organization_id);
CREATE INDEX IF NOT EXISTS idx_draw_schedules_active ON draw_schedules(organization_id, is_active) WHERE is_active = TRUE;
