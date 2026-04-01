-- Migration: 0020_lead_dedup_merge_policy_mvp
-- Description: soporte mínimo para deduplicación/merge por tenant+campaign con email/phone.

ALTER TABLE contact_center.leads
    ADD COLUMN IF NOT EXISTS email text,
    ADD COLUMN IF NOT EXISTS email_norm text;

CREATE INDEX IF NOT EXISTS idx_leads_tenant_campaign_phone_norm
    ON contact_center.leads (tenant_id, campaign_id, phone_norm)
    WHERE phone_norm IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_tenant_campaign_email_norm
    ON contact_center.leads (tenant_id, campaign_id, email_norm)
    WHERE email_norm IS NOT NULL;

COMMENT ON COLUMN contact_center.leads.email IS 'MVP dedup: email original del intake/import (opcional).';
COMMENT ON COLUMN contact_center.leads.email_norm IS 'MVP dedup: email normalizado lowercase para merge por tenant+campaign.';

