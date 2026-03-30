-- Migration: 0004_add_legacy_tenant_fks_and_indexes
-- Description: Add relationships and optimize performance for tenant-aware queries.

-- 1. Foreign Keys (Deferred Enforcement)
ALTER TABLE contact_center.campaigns ADD CONSTRAINT fk_campaigns_tenant FOREIGN KEY (tenant_id) REFERENCES platform_core.tenants(id);
ALTER TABLE contact_center.leads ADD CONSTRAINT fk_leads_tenant FOREIGN KEY (tenant_id) REFERENCES platform_core.tenants(id);
ALTER TABLE contact_center.calls ADD CONSTRAINT fk_calls_tenant FOREIGN KEY (tenant_id) REFERENCES platform_core.tenants(id);
ALTER TABLE contact_center.call_messages ADD CONSTRAINT fk_call_messages_tenant FOREIGN KEY (tenant_id) REFERENCES platform_core.tenants(id);
ALTER TABLE contact_center.call_human_messages ADD CONSTRAINT fk_call_human_messages_tenant FOREIGN KEY (tenant_id) REFERENCES platform_core.tenants(id);
ALTER TABLE contact_center.call_analysis ADD CONSTRAINT fk_call_analysis_tenant FOREIGN KEY (tenant_id) REFERENCES platform_core.tenants(id);
ALTER TABLE contact_center.campaign_products ADD CONSTRAINT fk_campaign_products_tenant FOREIGN KEY (tenant_id) REFERENCES platform_core.tenants(id);
ALTER TABLE contact_center.notifications_log ADD CONSTRAINT fk_notifications_log_tenant FOREIGN KEY (tenant_id) REFERENCES platform_core.tenants(id);
ALTER TABLE contact_center.recordings ADD CONSTRAINT fk_recordings_tenant FOREIGN KEY (tenant_id) REFERENCES platform_core.tenants(id);

-- 2. Performance Indexes (Mandatory for multi-tenancy access)
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON contact_center.campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant ON contact_center.leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calls_tenant ON contact_center.calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_call_messages_tenant ON contact_center.call_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_call_human_messages_tenant ON contact_center.call_human_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_log_tenant ON contact_center.notifications_log(tenant_id);

-- 3. Composite Indexes (Common Query Patterns)
CREATE INDEX IF NOT EXISTS idx_leads_tenant_campaign ON contact_center.leads(tenant_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_calls_tenant_lead ON contact_center.calls(tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_call_messages_tenant_call ON contact_center.call_messages(tenant_id, call_id);
