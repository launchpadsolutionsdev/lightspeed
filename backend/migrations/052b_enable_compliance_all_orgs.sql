-- Enable Compliance Assistant for all existing organizations
-- Previously defaulted to false, making the tool invisible to non-super-admins
UPDATE organizations SET compliance_enabled = true WHERE compliance_enabled = false;

-- Change default to true so new organizations also get it enabled
ALTER TABLE organizations ALTER COLUMN compliance_enabled SET DEFAULT true;
