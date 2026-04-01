-- Migration: 0021_lead_work_queue_assignment_mvp
-- Description: cola operativa mínima + assignment/ownership para leads (tenant-safe).

ALTER TABLE contact_center.leads
    ADD COLUMN IF NOT EXISTS work_queue text,
    ADD COLUMN IF NOT EXISTS work_status text,
    ADD COLUMN IF NOT EXISTS work_assignee_user_id uuid,
    ADD COLUMN IF NOT EXISTS work_assignee_label text,
    ADD COLUMN IF NOT EXISTS work_assigned_at timestamptz,
    ADD COLUMN IF NOT EXISTS work_last_state_at timestamptz;

UPDATE contact_center.leads
SET work_queue = COALESCE(NULLIF(work_queue, ''), NULLIF(queue_start, ''), 'wow_queue_default')
WHERE work_queue IS NULL OR work_queue = '';

UPDATE contact_center.leads
SET work_status = CASE
    WHEN lower(COALESCE(NULLIF(estado_usuario, ''), '')) IN (
        'cerrado',
        'closed',
        'ganado',
        'lost',
        'descartado',
        'finalizado'
    ) THEN 'done'
    ELSE 'queued'
END
WHERE work_status IS NULL OR work_status = '';

UPDATE contact_center.leads
SET work_status = 'queued'
WHERE work_status NOT IN ('queued', 'assigned', 'in_progress', 'done');

UPDATE contact_center.leads
SET work_last_state_at = COALESCE(work_last_state_at, updated_at, created_at, now())
WHERE work_last_state_at IS NULL;

ALTER TABLE contact_center.leads
    ALTER COLUMN work_queue SET DEFAULT 'wow_queue_default',
    ALTER COLUMN work_queue SET NOT NULL,
    ALTER COLUMN work_status SET DEFAULT 'queued',
    ALTER COLUMN work_status SET NOT NULL,
    ALTER COLUMN work_last_state_at SET DEFAULT now(),
    ALTER COLUMN work_last_state_at SET NOT NULL;

ALTER TABLE contact_center.leads
    DROP CONSTRAINT IF EXISTS leads_work_status_check;

ALTER TABLE contact_center.leads
    ADD CONSTRAINT leads_work_status_check
    CHECK (work_status IN ('queued', 'assigned', 'in_progress', 'done'));

CREATE INDEX IF NOT EXISTS idx_leads_work_queue_status
    ON contact_center.leads (tenant_id, work_status, priority, sla_due_at, created_at DESC)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_leads_work_assignee
    ON contact_center.leads (tenant_id, work_assignee_user_id, work_status, updated_at DESC)
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

COMMENT ON COLUMN contact_center.leads.work_queue IS 'MVP work queue: cola operativa vigente del lead (normalmente queue_start).';
COMMENT ON COLUMN contact_center.leads.work_status IS 'MVP work queue: queued|assigned|in_progress|done.';
COMMENT ON COLUMN contact_center.leads.work_assignee_user_id IS 'MVP assignment: owner actual en platform_core.tenant_users.user_id.';
COMMENT ON COLUMN contact_center.leads.work_assignee_label IS 'MVP assignment: label visible del owner (email u otro identificador).';
COMMENT ON COLUMN contact_center.leads.work_assigned_at IS 'MVP assignment: timestamp de última asignación/reasignación.';
COMMENT ON COLUMN contact_center.leads.work_last_state_at IS 'MVP work queue: timestamp de último cambio de estado operativo.';

