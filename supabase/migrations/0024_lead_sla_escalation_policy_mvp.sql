-- Migration: 0024_lead_sla_escalation_policy_mvp
-- Description: política mínima SLA/escalación operativa para leads en work queue (tenant-safe).

ALTER TABLE contact_center.leads
    ADD COLUMN IF NOT EXISTS sla_status text,
    ADD COLUMN IF NOT EXISTS sla_is_escalated boolean,
    ADD COLUMN IF NOT EXISTS sla_escalation_level text,
    ADD COLUMN IF NOT EXISTS sla_escalated_at timestamptz,
    ADD COLUMN IF NOT EXISTS sla_last_evaluated_at timestamptz;

UPDATE contact_center.leads
SET
    sla_status = CASE
        WHEN sla_due_at IS NULL THEN 'no_sla'
        WHEN sla_due_at < now() THEN 'overdue'
        WHEN sla_due_at <= (now() + interval '15 minutes') THEN 'due_soon'
        ELSE 'on_time'
    END,
    sla_is_escalated = CASE
        WHEN sla_due_at IS NULL THEN false
        WHEN sla_due_at < now() AND COALESCE(work_status, 'queued') <> 'done' AND COALESCE(human_takeover_status, 'none') <> 'closed' THEN true
        ELSE false
    END,
    sla_escalation_level = CASE
        WHEN sla_due_at IS NULL THEN 'none'
        WHEN sla_due_at < now() AND COALESCE(work_status, 'queued') <> 'done' AND COALESCE(human_takeover_status, 'none') <> 'closed' THEN
            CASE
                WHEN (now() - sla_due_at) >= interval '60 minutes' THEN 'critical'
                ELSE 'warning'
            END
        ELSE 'none'
    END,
    sla_escalated_at = CASE
        WHEN sla_due_at < now() AND COALESCE(work_status, 'queued') <> 'done' AND COALESCE(human_takeover_status, 'none') <> 'closed'
            THEN COALESCE(sla_escalated_at, now())
        ELSE sla_escalated_at
    END,
    sla_last_evaluated_at = COALESCE(sla_last_evaluated_at, now())
WHERE sla_status IS NULL
   OR sla_is_escalated IS NULL
   OR sla_escalation_level IS NULL
   OR sla_last_evaluated_at IS NULL;

ALTER TABLE contact_center.leads
    ALTER COLUMN sla_status SET DEFAULT 'no_sla',
    ALTER COLUMN sla_status SET NOT NULL,
    ALTER COLUMN sla_is_escalated SET DEFAULT false,
    ALTER COLUMN sla_is_escalated SET NOT NULL,
    ALTER COLUMN sla_escalation_level SET DEFAULT 'none',
    ALTER COLUMN sla_escalation_level SET NOT NULL,
    ALTER COLUMN sla_last_evaluated_at SET DEFAULT now(),
    ALTER COLUMN sla_last_evaluated_at SET NOT NULL;

ALTER TABLE contact_center.leads
    DROP CONSTRAINT IF EXISTS leads_sla_status_check;

ALTER TABLE contact_center.leads
    ADD CONSTRAINT leads_sla_status_check
    CHECK (sla_status IN ('no_sla', 'on_time', 'due_soon', 'overdue'));

ALTER TABLE contact_center.leads
    DROP CONSTRAINT IF EXISTS leads_sla_escalation_level_check;

ALTER TABLE contact_center.leads
    ADD CONSTRAINT leads_sla_escalation_level_check
    CHECK (sla_escalation_level IN ('none', 'warning', 'critical'));

CREATE INDEX IF NOT EXISTS idx_leads_sla_policy_status
    ON contact_center.leads (tenant_id, sla_status, sla_is_escalated, priority, sla_due_at)
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
    l.sla_status,
    l.sla_is_escalated,
    l.sla_escalation_level,
    l.sla_escalated_at,
    l.sla_last_evaluated_at,
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
        END,
        CASE l.sla_status
            WHEN 'overdue'::text THEN 1
            WHEN 'due_soon'::text THEN 2
            WHEN 'on_time'::text THEN 3
            ELSE 4
        END,
        l.lead_score DESC NULLS LAST,
        l.sla_due_at,
        l.created_at DESC;

COMMENT ON COLUMN contact_center.leads.sla_status IS 'Estado SLA MVP: no_sla|on_time|due_soon|overdue.';
COMMENT ON COLUMN contact_center.leads.sla_is_escalated IS 'Marcador de escalación activa por vencimiento SLA en operación humana.';
COMMENT ON COLUMN contact_center.leads.sla_escalation_level IS 'Nivel de escalación SLA MVP: none|warning|critical.';
COMMENT ON COLUMN contact_center.leads.sla_escalated_at IS 'Timestamp de primera escalación activa para seguimiento operativo.';
COMMENT ON COLUMN contact_center.leads.sla_last_evaluated_at IS 'Última evaluación de señales SLA/escalación en API operativa.';

