-- Migration 017: Rules of Play Generator tables

-- Jurisdictions reference table
CREATE TABLE IF NOT EXISTS jurisdictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country VARCHAR(2) NOT NULL,
    province_state_code VARCHAR(10) NOT NULL,
    province_state_name VARCHAR(100) NOT NULL,
    minimum_age INT NOT NULL DEFAULT 18,
    regulatory_body_name VARCHAR(255),
    regulatory_body_abbreviation VARCHAR(50),
    responsible_gambling_org VARCHAR(255),
    responsible_gambling_phone VARCHAR(50),
    responsible_gambling_url VARCHAR(500),
    geographic_restriction_text VARCHAR(500),
    unclaimed_prize_rule TEXT,
    additional_required_disclosures TEXT,
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jurisdictions_country_code ON jurisdictions(country, province_state_code);

-- Seed Ontario (active)
INSERT INTO jurisdictions (country, province_state_code, province_state_name, minimum_age, regulatory_body_name, regulatory_body_abbreviation, responsible_gambling_org, responsible_gambling_phone, responsible_gambling_url, geographic_restriction_text, unclaimed_prize_rule, is_active)
VALUES ('CA', 'ON', 'Ontario', 18, 'Alcohol and Gaming Commission of Ontario', 'AGCO', 'Problem Gambling Helpline / ConnexOntario', '1-866-531-2600', 'connexontario.ca', 'Ticket purchasers must be physically located in Ontario at the time of purchase', 'Donated to a local charity with approval of the AGCO', TRUE)
ON CONFLICT (country, province_state_code) DO NOTHING;

-- Seed other Canadian provinces (inactive)
INSERT INTO jurisdictions (country, province_state_code, province_state_name, minimum_age, is_active) VALUES
('CA', 'AB', 'Alberta', 18, FALSE),
('CA', 'BC', 'British Columbia', 19, FALSE),
('CA', 'MB', 'Manitoba', 18, FALSE),
('CA', 'NB', 'New Brunswick', 19, FALSE),
('CA', 'NL', 'Newfoundland and Labrador', 19, FALSE),
('CA', 'NS', 'Nova Scotia', 19, FALSE),
('CA', 'NT', 'Northwest Territories', 19, FALSE),
('CA', 'NU', 'Nunavut', 19, FALSE),
('CA', 'PE', 'Prince Edward Island', 19, FALSE),
('CA', 'QC', 'Quebec', 18, FALSE),
('CA', 'SK', 'Saskatchewan', 19, FALSE),
('CA', 'YT', 'Yukon', 19, FALSE)
ON CONFLICT (country, province_state_code) DO NOTHING;

-- Seed US states (inactive)
INSERT INTO jurisdictions (country, province_state_code, province_state_name, minimum_age, is_active) VALUES
('US', 'AL', 'Alabama', 18, FALSE),
('US', 'AK', 'Alaska', 18, FALSE),
('US', 'AZ', 'Arizona', 18, FALSE),
('US', 'AR', 'Arkansas', 18, FALSE),
('US', 'CA', 'California', 18, FALSE),
('US', 'CO', 'Colorado', 18, FALSE),
('US', 'CT', 'Connecticut', 18, FALSE),
('US', 'DE', 'Delaware', 18, FALSE),
('US', 'FL', 'Florida', 18, FALSE),
('US', 'GA', 'Georgia', 18, FALSE),
('US', 'HI', 'Hawaii', 18, FALSE),
('US', 'ID', 'Idaho', 18, FALSE),
('US', 'IL', 'Illinois', 18, FALSE),
('US', 'IN', 'Indiana', 18, FALSE),
('US', 'IA', 'Iowa', 18, FALSE),
('US', 'KS', 'Kansas', 18, FALSE),
('US', 'KY', 'Kentucky', 18, FALSE),
('US', 'LA', 'Louisiana', 18, FALSE),
('US', 'ME', 'Maine', 18, FALSE),
('US', 'MD', 'Maryland', 18, FALSE),
('US', 'MA', 'Massachusetts', 18, FALSE),
('US', 'MI', 'Michigan', 18, FALSE),
('US', 'MN', 'Minnesota', 18, FALSE),
('US', 'MS', 'Mississippi', 18, FALSE),
('US', 'MO', 'Missouri', 18, FALSE),
('US', 'MT', 'Montana', 18, FALSE),
('US', 'NE', 'Nebraska', 18, FALSE),
('US', 'NV', 'Nevada', 18, FALSE),
('US', 'NH', 'New Hampshire', 18, FALSE),
('US', 'NJ', 'New Jersey', 18, FALSE),
('US', 'NM', 'New Mexico', 18, FALSE),
('US', 'NY', 'New York', 18, FALSE),
('US', 'NC', 'North Carolina', 18, FALSE),
('US', 'ND', 'North Dakota', 18, FALSE),
('US', 'OH', 'Ohio', 18, FALSE),
('US', 'OK', 'Oklahoma', 18, FALSE),
('US', 'OR', 'Oregon', 18, FALSE),
('US', 'PA', 'Pennsylvania', 18, FALSE),
('US', 'RI', 'Rhode Island', 18, FALSE),
('US', 'SC', 'South Carolina', 18, FALSE),
('US', 'SD', 'South Dakota', 18, FALSE),
('US', 'TN', 'Tennessee', 18, FALSE),
('US', 'TX', 'Texas', 18, FALSE),
('US', 'UT', 'Utah', 18, FALSE),
('US', 'VT', 'Vermont', 18, FALSE),
('US', 'VA', 'Virginia', 18, FALSE),
('US', 'WA', 'Washington', 18, FALSE),
('US', 'WV', 'West Virginia', 18, FALSE),
('US', 'WI', 'Wisconsin', 18, FALSE),
('US', 'WY', 'Wyoming', 18, FALSE),
('US', 'DC', 'District of Columbia', 18, FALSE)
ON CONFLICT (country, province_state_code) DO NOTHING;

-- Jurisdiction waitlist
CREATE TABLE IF NOT EXISTS jurisdiction_waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    jurisdiction_id UUID NOT NULL REFERENCES jurisdictions(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, jurisdiction_id)
);

-- Rules of Play drafts
CREATE TABLE IF NOT EXISTS rules_of_play_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    raffle_type VARCHAR(20) NOT NULL,
    jurisdiction_id UUID REFERENCES jurisdictions(id),
    form_data JSONB NOT NULL DEFAULT '{}',
    reference_document_text TEXT,
    generated_document TEXT,
    status VARCHAR(20) DEFAULT 'draft',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rop_drafts_org ON rules_of_play_drafts(organization_id);
CREATE INDEX IF NOT EXISTS idx_rop_drafts_status ON rules_of_play_drafts(status);
