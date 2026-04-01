-- Migration: 0023_lead_activity_timeline_audit_mvp
-- Description: timeline/audit trail mínimo por lead (tenant-safe), sin event sourcing completo.

CREATE TABLE IF NOT EXISTS contact_center.lead_activity_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    campaign_id uuid NULL,
    event_type text NOT NULL,
    event_at timestamptz NOT NULL DEFAULT now(),
    actor_user_id uuid NULL,
    actor_label text NULL,
    source text NOT NULL DEFAULT 'system',
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT lead_activity_events_payload_object CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT lead_activity_events_event_type_not_blank CHECK (btrim(event_type) <> ''),
    CONSTRAINT lead_activity_events_source_not_blank CHECK (btrim(source) <> ''),
    CONSTRAINT lead_activity_events_tenant_fk FOREIGN KEY (tenant_id) REFERENCES platform_core.tenants(id) ON DELETE CASCADE,
    CONSTRAINT lead_activity_events_lead_fk FOREIGN KEY (lead_id) REFERENCES contact_center.leads(id) ON DELETE CASCADE,
    CONSTRAINT lead_activity_events_campaign_fk FOREIGN KEY (campaign_id) REFERENCES contact_center.campaigns(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_activity_events_tenant_lead_event_at
    ON contact_center.lead_activity_events (tenant_id, lead_id, event_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_activity_events_tenant_event_type
    ON contact_center.lead_activity_events (tenant_id, event_type, event_at DESC);

COMMENT ON TABLE contact_center.lead_activity_events IS 'MVP timeline/audit trail de leads por tenant.';
COMMENT ON COLUMN contact_center.lead_activity_events.event_type IS 'Tipo estable de evento: lead.intake.created, lead.assignment.assigned, etc.';
COMMENT ON COLUMN contact_center.lead_activity_events.payload IS 'Payload JSON mínimo por evento para operación/auditoría.';

