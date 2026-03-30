-- Migration: 0003_add_tenant_id_to_legacy_mvp
-- Description: Implement tenant isolation on the existing MVP codebase.

ALTER TABLE contact_center.campaigns ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE contact_center.leads ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE contact_center.calls ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE contact_center.call_messages ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE contact_center.call_human_messages ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE contact_center.call_analysis ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE contact_center.campaign_products ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE contact_center.notifications_log ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE contact_center.recordings ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Comment for data engineering
COMMENT ON COLUMN contact_center.campaigns.tenant_id IS 'Isolation identifier for multi-tenancy support.';
COMMENT ON COLUMN contact_center.leads.tenant_id IS 'Isolation identifier for multi-tenancy support.';
COMMENT ON COLUMN contact_center.calls.tenant_id IS 'Isolation identifier for multi-tenancy support.';
COMMENT ON COLUMN contact_center.call_messages.tenant_id IS 'Isolation identifier for multi-tenancy support.';
COMMENT ON COLUMN contact_center.call_human_messages.tenant_id IS 'Isolation identifier for multi-tenancy support.';
COMMENT ON COLUMN contact_center.call_analysis.tenant_id IS 'Isolation identifier for multi-tenancy support.';
COMMENT ON COLUMN contact_center.recordings.tenant_id IS 'Isolation identifier for multi-tenancy support.';
COMMENT ON COLUMN contact_center.campaign_products.tenant_id IS 'Isolation identifier for multi-tenancy support.';
COMMENT ON COLUMN contact_center.notifications_log.tenant_id IS 'Isolation identifier for multi-tenancy support.';
