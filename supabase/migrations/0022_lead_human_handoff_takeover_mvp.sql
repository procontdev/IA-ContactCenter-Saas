-- Migration: 0022_lead_human_handoff_takeover_mvp
-- Description: takeover humano explícito sobre leads (tenant-safe) con trazabilidad mínima.

ALTER TABLE contact_center.leads
    ADD COLUMN IF NOT EXISTS human_takeover_status text,
    ADD COLUMN IF NOT EXISTS human_takeover_by_user_id uuid,
    ADD COLUMN IF NOT EXISTS human_takeover_by_label text,
    ADD COLUMN IF NOT EXISTS human_takeover_at timestamptz,
    ADD COLUMN IF NOT EXISTS human_takeover_released_at timestamptz,
    ADD COLUMN IF NOT EXISTS human_takeover_closed_at timestamptz;

UPDATE contact_center.leads
SET human_takeover_status = 'none'
WHERE human_takeover_status IS NULL OR btrim(human_takeover_status) = '';

UPDATE contact_center.leads
SET human_takeover_status = 'none'
WHERE human_takeover_status NOT IN ('none', 'taken', 'released', 'closed');

ALTER TABLE contact_center.leads
    ALTER COLUMN human_takeover_status SET DEFAULT 'none',
    ALTER COLUMN human_takeover_status SET NOT NULL;

ALTER TABLE contact_center.leads
    DROP CONSTRAINT IF EXISTS leads_human_takeover_status_check;

ALTER TABLE contact_center.leads
    ADD CONSTRAINT leads_human_takeover_status_check
    CHECK (human_takeover_status IN ('none', 'taken', 'released', 'closed'));

CREATE INDEX IF NOT EXISTS idx_leads_human_takeover_status
    ON contact_center.leads (tenant_id, human_takeover_status, updated_at DESC)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_leads_human_takeover_owner
    ON contact_center.leads (tenant_id, human_takeover_by_user_id, human_takeover_status, updated_at DESC)
    WHERE is_active = true;

CREATE OR REPLACE VIEW contact_center.v_leads_wow_queue AS
 SELECT l.id,
    l.campaign_id,
    l.campaign,
    l.form_id,
    l.created_at,
    l.phone,
    l.phone_norm,
    l.lead_score,
    l.lead_temperature,
    l.priority,
    l.sla_due_at,
    l.next_best_action,
    l.quality_flags,
    l.spam_flags,
    l.lead_score_reasons,
    l.work_queue,
    l.work_status,
    l.work_assignee_user_id,
    l.work_assignee_label,
    l.work_assigned_at,
    l.human_takeover_status,
    l.human_takeover_by_user_id,
    l.human_takeover_by_label,
    l.human_takeover_at,
    l.human_takeover_released_at,
    l.human_takeover_closed_at,
    l.is_active,
    l.tenant_id
   FROM contact_center.leads l
  WHERE (l.is_active = true)
  ORDER BY
        CASE l.priority
            WHEN 'P1'::text THEN 1
            WHEN 'P2'::text THEN 2
            ELSE 3
        END, l.lead_score DESC NULLS LAST, l.sla_due_at, l.created_at DESC;

COMMENT ON COLUMN contact_center.leads.human_takeover_status IS 'MVP handoff humano: none|taken|released|closed.';
COMMENT ON COLUMN contact_center.leads.human_takeover_by_user_id IS 'MVP handoff humano: user_id del operador que tomó explícitamente el lead.';
COMMENT ON COLUMN contact_center.leads.human_takeover_by_label IS 'MVP handoff humano: etiqueta visible del operador (email/id).';
COMMENT ON COLUMN contact_center.leads.human_takeover_at IS 'MVP handoff humano: timestamp de toma explícita del lead.';
COMMENT ON COLUMN contact_center.leads.human_takeover_released_at IS 'MVP handoff humano: timestamp de liberación del takeover.';
COMMENT ON COLUMN contact_center.leads.human_takeover_closed_at IS 'MVP handoff humano: timestamp de cierre operativo del takeover.';

