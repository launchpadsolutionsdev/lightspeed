-- Migration 047: Compliance Tool
-- Creates tables for the Compliance Assistant tool

-- Compliance jurisdictions reference table
CREATE TABLE IF NOT EXISTS compliance_jurisdictions (
    code VARCHAR(2) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    regulatory_body VARCHAR(200) NOT NULL,
    regulatory_url VARCHAR(500),
    is_active BOOLEAN DEFAULT false,
    entry_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pre-populate all 13 Canadian provinces and territories
INSERT INTO compliance_jurisdictions (code, name, regulatory_body, regulatory_url, is_active) VALUES
    ('ON', 'Ontario', 'Alcohol and Gaming Commission of Ontario (AGCO)', 'https://www.agco.ca', true),
    ('BC', 'British Columbia', 'Gaming Policy and Enforcement Branch (GPEB)', 'https://www2.gov.bc.ca/gov/content/sports-culture/gambling', false),
    ('AB', 'Alberta', 'Alberta Gaming, Liquor and Cannabis (AGLC)', 'https://aglc.ca', false),
    ('SK', 'Saskatchewan', 'Saskatchewan Liquor and Gaming Authority (SLGA)', 'https://www.slga.com', false),
    ('MB', 'Manitoba', 'Liquor, Gaming and Cannabis Authority of Manitoba (LGCA)', 'https://lgcamb.ca', false),
    ('QC', 'Quebec', 'Régie des alcools, des courses et des jeux (RACJ)', 'https://www.racj.gouv.qc.ca', false),
    ('NB', 'New Brunswick', 'New Brunswick Lotteries and Gaming Corporation', 'https://www.gnb.ca', false),
    ('NS', 'Nova Scotia', 'Nova Scotia Provincial Lotteries and Casino Corporation', 'https://www.novascotia.ca', false),
    ('PE', 'Prince Edward Island', 'PEI Lotteries Commission', 'https://www.princeedwardisland.ca', false),
    ('NL', 'Newfoundland and Labrador', 'Department of Digital Government and Service NL', 'https://www.gov.nl.ca', false),
    ('YT', 'Yukon', 'Department of Community Services', 'https://yukon.ca', false),
    ('NT', 'Northwest Territories', 'Department of Municipal and Community Affairs', 'https://www.gov.nt.ca', false),
    ('NU', 'Nunavut', 'Department of Community and Government Services', 'https://www.gov.nu.ca', false)
ON CONFLICT (code) DO NOTHING;

-- Compliance knowledge base table
CREATE TABLE IF NOT EXISTS compliance_knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction_code VARCHAR(2) NOT NULL REFERENCES compliance_jurisdictions(code),
    jurisdiction_name VARCHAR(100) NOT NULL,
    regulatory_body VARCHAR(200) NOT NULL,
    category VARCHAR(100) NOT NULL,
    title VARCHAR(300) NOT NULL,
    content TEXT NOT NULL,
    source_name VARCHAR(300),
    source_url VARCHAR(500),
    source_section VARCHAR(100),
    last_verified_date DATE DEFAULT CURRENT_DATE,
    verified_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true
);

-- Indexes for compliance knowledge base
CREATE INDEX IF NOT EXISTS idx_compliance_kb_jurisdiction ON compliance_knowledge_base(jurisdiction_code);
CREATE INDEX IF NOT EXISTS idx_compliance_kb_category ON compliance_knowledge_base(category);
CREATE INDEX IF NOT EXISTS idx_compliance_kb_active ON compliance_knowledge_base(is_active);
CREATE INDEX IF NOT EXISTS idx_compliance_kb_jurisdiction_active ON compliance_knowledge_base(jurisdiction_code, is_active);

-- Compliance conversations table
CREATE TABLE IF NOT EXISTS compliance_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    user_id UUID NOT NULL,
    jurisdiction_code VARCHAR(2) NOT NULL REFERENCES compliance_jurisdictions(code),
    title VARCHAR(300),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_conv_user ON compliance_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_compliance_conv_org ON compliance_conversations(org_id);

-- Compliance messages table
CREATE TABLE IF NOT EXISTS compliance_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES compliance_conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    citations JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_msg_conv ON compliance_messages(conversation_id);

-- Add compliance_enabled flag to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS compliance_enabled BOOLEAN DEFAULT false;
