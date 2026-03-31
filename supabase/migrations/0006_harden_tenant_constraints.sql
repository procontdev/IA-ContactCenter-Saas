-- Migration: 0006_harden_tenant_constraints
-- Description: Apply NOT NULL constraints after successful backfill and update views to be tenant-aware.

-- 1. Apply NOT NULL constraints (Assumes backfill was successful)
ALTER TABLE contact_center.campaigns ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE contact_center.leads ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE contact_center.calls ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE contact_center.call_messages ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE contact_center.call_human_messages ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE contact_center.call_analysis ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE contact_center.campaign_products ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE contact_center.recordings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE contact_center.notifications_log ALTER COLUMN tenant_id SET NOT NULL;

-- 2. Update Critical Views to expose tenant_id (Incremental & Safe)

-- v_calls_audit
CREATE OR REPLACE VIEW contact_center.v_calls_audit AS
 SELECT c.id AS call_id,
    c.lead_id,
    l.campaign,
    l.phone AS lead_phone,
    c.phone AS call_phone,
    c.mode,
    c.status,
    c.created_at,
    c.started_at,
    c.ended_at,
    c.duration_sec,
    c.human_status,
    c.human_taken_by,
    c.human_taken_at,
    c.human_first_response_at,
    c.human_closed_at,
    c.human_response_count,
    c.handoff_reason,
    c.assigned_channel,
    c.assigned_to,
    c.handoff_at,
    c.metadata,
        CASE
            WHEN ((c.human_first_response_at IS NOT NULL) AND (c.handoff_at IS NOT NULL)) THEN (EXTRACT(epoch FROM (c.human_first_response_at - c.handoff_at)))::integer
            ELSE NULL::integer
        END AS first_response_sec,
        CASE
            WHEN ((c.human_closed_at IS NOT NULL) AND (c.handoff_at IS NOT NULL)) THEN (EXTRACT(epoch FROM (c.human_closed_at - c.handoff_at)))::integer
            ELSE NULL::integer
        END AS time_to_close_sec,
    l.campaign_id,
    COALESCE(NULLIF(btrim(l.usuario), ''::text), 'Sin Información'::text) AS lead_usuario,
    c.tenant_id
   FROM (contact_center.calls c
     JOIN contact_center.leads l ON ((l.id = c.lead_id)));

-- v_calls_outbound_dashboard
CREATE OR REPLACE VIEW contact_center.v_calls_outbound_dashboard AS
 SELECT c.id AS call_id,
    c.lead_id,
    c.tenant_id,
    l.campaign_id,
    camp.name AS campaign_name,
    camp.code AS campaign_code,
    btrim(c.status) AS status_norm,
    c.mode,
    c.agent_phone,
    c.phone AS called_phone,
    c.twilio_call_sid,
    c.started_at,
    c.ended_at,
    COALESCE(c.duration_sec, 0) AS duration_sec,
        CASE
            WHEN (btrim(c.status) = ANY (ARRAY['completed'::text, 'in-progress'::text])) THEN true
            ELSE false
        END AS is_connected,
    ((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text) AS started_at_pe,
    (((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text))::date AS day_pe,
    (EXTRACT(isodow FROM ((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text)))::integer AS dow_pe,
    (EXTRACT(week FROM ((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text)))::integer AS week_pe,
    (EXTRACT(hour FROM ((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text)))::integer AS hour_pe,
        CASE
            WHEN (EXTRACT(hour FROM ((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text)) < (12)::numeric) THEN 'a.m.'::text
            ELSE 'p.m.'::text
        END AS period,
    (ceil((EXTRACT(day FROM ((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text)) / 7.0)))::integer AS week_of_month,
        CASE
            WHEN ((EXTRACT(hour FROM ((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text)) >= (0)::numeric) AND (EXTRACT(hour FROM ((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text)) <= (4)::numeric)) THEN '00:00 - 05:00'::text
            WHEN ((EXTRACT(hour FROM ((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text)) >= (5)::numeric) AND (EXTRACT(hour FROM ((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text)) <= (9)::numeric)) THEN '05:00 - 10:00'::text
            WHEN ((EXTRACT(hour FROM ((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text)) >= (10)::numeric) AND (EXTRACT(hour FROM ((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text)) <= (14)::numeric)) THEN '10:00 - 15:00'::text
            WHEN ((EXTRACT(hour FROM ((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text)) >= (15)::numeric) AND (EXTRACT(hour FROM ((c.started_at AT TIME ZONE 'UTC'::text) AT TIME ZONE 'America/Lima'::text)) <= (19)::numeric)) THEN '15:00 - 20:00'::text
            ELSE '20:00 - 00:00'::text
        END AS hour_range,
        CASE
            WHEN (btrim(c.status) = ANY (ARRAY['completed'::text, 'in-progress'::text])) THEN 'CONNECTED'::text
            WHEN (btrim(c.status) = 'queued'::text) THEN 'QUEUED'::text
            WHEN (btrim(c.status) = 'initiated'::text) THEN 'PRECALL'::text
            ELSE 'OTHER'::text
        END AS outcome_group,
        CASE
            WHEN (btrim(c.status) = ANY (ARRAY['completed'::text, 'in-progress'::text])) THEN 'CONNECTED'::text
            WHEN (btrim(c.status) = 'queued'::text) THEN 'QUEUED'::text
            WHEN (btrim(c.status) = 'initiated'::text) THEN 'PRECALL'::text
            ELSE 'OTHER'::text
        END AS outcome_detail,
    c.handoff_reason,
    c.assigned_channel,
    c.assigned_to,
    c.human_status,
    c.human_taken_by,
    c.human_taken_at,
    c.human_closed_at,
    ca.intent,
    ca.sentiment,
    ca.lead_score,
    ca.follow_up_needed,
    ca.follow_up_datetime_iso,
    rec.recording_url,
    rec.duration_sec AS recording_duration_sec
   FROM ((((contact_center.calls c
     LEFT JOIN contact_center.leads l ON ((l.id = c.lead_id)))
     LEFT JOIN contact_center.campaigns camp ON ((camp.id = l.campaign_id)))
     LEFT JOIN contact_center.call_analysis ca ON ((ca.call_id = c.id)))
     LEFT JOIN LATERAL ( SELECT r.recording_url,
            r.duration_sec
           FROM contact_center.recordings r
          WHERE (r.call_id = c.id)
          ORDER BY r.created_at DESC
         LIMIT 1) rec ON (true));

-- v_campaign_stats (simplified update)
CREATE OR REPLACE VIEW contact_center.v_campaign_stats AS
 WITH prod AS (
         SELECT campaign_id, count(*) AS products_total, tenant_id
           FROM contact_center.campaign_products
          GROUP BY campaign_id, tenant_id
        ), base AS (
         SELECT c.id AS campaign_id,
            c.tenant_id,
            c.code AS campaign_code,
            c.name AS campaign_name,
            c.is_active,
            count(l.id) AS leads_total,
            count(l.id) FILTER (WHERE (l.estado_cliente ~~* 'Contesto%'::text)) AS leads_contesto,
            count(l.id) FILTER (WHERE (l.estado_cliente ~~* 'No Contesto%'::text)) AS leads_no_contesto,
            count(ca.id) AS calls_total,
            count(ca.id) FILTER (WHERE (ca.mode = 'llm'::text)) AS calls_llm,
            count(ca.id) FILTER (WHERE (ca.mode = 'human'::text)) AS calls_human,
            count(ca.id) FILTER (WHERE (lower(TRIM(BOTH FROM COALESCE(ca.status, ''::text))) = 'completed'::text)) AS calls_completed,
            avg(ca.duration_sec) AS avg_duration_sec,
            max(ca.created_at) AS last_call_at,
            count(DISTINCT l.id) FILTER (WHERE (ca.id IS NOT NULL)) AS leads_with_calls,
                CASE
                    WHEN (count(l.id) = 0) THEN (0)::numeric
                    ELSE round((((count(l.id) FILTER (WHERE (l.estado_cliente ~~* 'Contesto%'::text)))::numeric * (100)::numeric) / (count(l.id))::numeric), 2)
                END AS contact_rate_pct,
                CASE
                    WHEN (count(DISTINCT l.id) = 0) THEN (0)::numeric
                    ELSE round(((count(ca.id))::numeric / (count(DISTINCT l.id))::numeric), 2)
                END AS calls_per_lead_avg,
            count(ca.id) FILTER (WHERE (lower(TRIM(BOTH FROM COALESCE(ca.status, ''::text))) <> 'completed'::text)) AS calls_unsuccessful,
            count(ca.id) FILTER (WHERE (((ca.metadata #>> '{twilio,recording_url}'::text[]) IS NOT NULL) OR ((ca.metadata #>> '{twilio_status,RecordingUrl}'::text[]) IS NOT NULL))) AS calls_with_recording,
            avg(ca.duration_sec) FILTER (WHERE (ca.mode = 'llm'::text)) AS avg_llm_duration_sec,
            avg(ca.duration_sec) FILTER (WHERE (ca.mode = 'human'::text)) AS avg_human_duration_sec,
            count(ca.id) FILTER (WHERE ((COALESCE(((ca.metadata #>> '{llm,handoff}'::text[]))::boolean, false) = true) OR (COALESCE(((ca.metadata #>> '{handoff_score}'::text[]))::numeric, (0)::numeric) > (0)::numeric) OR ((ca.metadata #>> '{handoff_priority_reason}'::text[]) ~~* '%pide_humano%'::text))) AS handoff_total,
            count(ca.id) FILTER (WHERE ((ca.human_taken_at IS NOT NULL) OR (lower(COALESCE(ca.human_status, ''::text)) = ANY (ARRAY['taken'::text, 'engaged'::text, 'in_progress'::text, 'active'::text])))) AS human_engaged_total,
            count(ca.id) FILTER (WHERE ((lower(COALESCE((ca.metadata #>> '{llm,service_interest}'::text[]), ''::text)) ~~ 'portab%'::text) OR (lower(COALESCE((ca.metadata #>> '{assistant,intent}'::text[]), ''::text)) = 'portabilidad'::text))) AS intent_portabilidad,
            count(ca.id) FILTER (WHERE ((lower(COALESCE((ca.metadata #>> '{llm,service_interest}'::text[]), ''::text)) = 'alta'::text) OR (lower(COALESCE((ca.metadata #>> '{assistant,intent}'::text[]), ''::text)) = 'alta'::text))) AS intent_alta,
            count(ca.id) FILTER (WHERE ((lower(COALESCE((ca.metadata #>> '{assistant,intent}'::text[]), ''::text)) = 'info'::text) OR (lower(COALESCE((ca.metadata #>> '{llm,service_interest}'::text[]), ''::text)) = 'info'::text))) AS intent_info,
             c.description,
             c.created_at,
             c.updated_at,
            COALESCE(p.products_total, (0)::bigint) AS products_total
           FROM (((contact_center.campaigns c
             LEFT JOIN contact_center.leads l ON ((l.campaign_id = c.id)))
             LEFT JOIN contact_center.calls ca ON ((ca.lead_id = l.id)))
             LEFT JOIN prod p ON ((p.campaign_id = c.id)))
          GROUP BY c.id, c.tenant_id, c.code, c.name, c.is_active, c.description, c.created_at, c.updated_at, p.products_total
        )
  SELECT base.campaign_id,
    base.tenant_id,
    base.campaign_code,
    base.campaign_name,
    base.is_active,
    base.leads_total,
    base.leads_contesto,
    base.leads_no_contesto,
    base.calls_total,
    base.calls_llm,
    base.calls_human,
    base.calls_completed,
    base.avg_duration_sec,
    base.last_call_at,
    base.leads_with_calls,
    base.contact_rate_pct,
    base.calls_per_lead_avg,
    base.calls_unsuccessful,
    base.calls_with_recording,
    base.avg_llm_duration_sec,
    base.avg_human_duration_sec,
    base.handoff_total,
    base.human_engaged_total,
    base.intent_portabilidad,
    base.intent_alta,
    base.intent_info,
    base.description,
    base.created_at,
    base.updated_at,
    base.products_total
   FROM base;

-- v_inbox_threads (Already defined before message update in chunk)
CREATE OR REPLACE VIEW contact_center.v_inbox_threads AS
 SELECT c.id AS call_id,
    c.lead_id,
    c.tenant_id,
    l.campaign_id,
    cam.code AS campaign_code,
    cam.name AS campaign_name,
    c.channel,
    c.mode,
    c.status,
    c.created_at,
    c.updated_at,
    c.human_status,
    c.handoff_at,
    c.assigned_to,
    c.assigned_user_id,
    c.customer_whatsapp_waid,
    c.customer_whatsapp_phone,
    c.external_thread_id,
    cam.wa_instance AS campaign_wa_instance,
    cam.wa_business_phone AS campaign_wa_business_phone,
    COALESCE(l.whatsapp_phone, c.customer_whatsapp_phone, l.phone, c.phone) AS customer_phone,
    lm.last_message_at,
    lm.last_message_text,
    lm.last_message_role,
    ( SELECT count(*) AS count
           FROM contact_center.call_messages m
          WHERE ((m.call_id = c.id) AND (m.role = 'lead'::text) AND (m.created_at > COALESCE(c.human_last_seen_at, c.handoff_at, c.created_at, '1970-01-01 00:00:00+00'::timestamp with time zone)))) AS unread_count,
    ( SELECT count(*) AS count
           FROM contact_center.call_messages m
          WHERE (m.call_id = c.id)) AS message_count
   FROM (((contact_center.calls c
     LEFT JOIN contact_center.leads l ON ((l.id = c.lead_id)))
     LEFT JOIN contact_center.campaigns cam ON ((cam.id = l.campaign_id)))
     LEFT JOIN LATERAL ( SELECT m.created_at AS last_message_at,
            m.message_text AS last_message_text,
            m.role AS last_message_role
           FROM contact_center.call_messages m
          WHERE (m.call_id = c.id)
          ORDER BY m.created_at DESC
         LIMIT 1) lm ON (true));

-- v_inbox_messages
CREATE OR REPLACE VIEW contact_center.v_inbox_messages AS
 SELECT m.id,
    m.call_id,
    m.role,
    m.channel,
    m.from_id,
    m.from_name,
    m.message_text,
    m.raw,
    m.created_at,
    m.external_id,
    m.external_ts,
    m.instance,
    c.lead_id,
    c.tenant_id,
    l.campaign_id,
    cam.code AS campaign_code,
    cam.name AS campaign_name
   FROM (((contact_center.call_messages m
     JOIN contact_center.calls c ON ((c.id = m.call_id)))
     LEFT JOIN contact_center.leads l ON ((l.id = c.lead_id)))
     LEFT JOIN contact_center.campaigns cam ON ((cam.id = l.campaign_id)));

-- v_calls_outbound_dashboard_v2
CREATE OR REPLACE VIEW contact_center.v_calls_outbound_dashboard_v2 AS
 SELECT v.call_id,
    v.lead_id,
    v.tenant_id,
    v.campaign_id,
    v.campaign_name,
    v.campaign_code,
    v.status_norm,
    v.mode,
    v.agent_phone,
    v.called_phone,
    v.twilio_call_sid,
    v.started_at,
    v.ended_at,
    v.duration_sec,
    v.is_connected,
    v.started_at_pe,
    v.day_pe,
    v.dow_pe,
    v.week_pe,
    v.hour_pe,
    v.period,
    v.week_of_month,
    v.hour_range,
    v.outcome_group,
    v.outcome_detail,
    v.handoff_reason,
    v.assigned_channel,
    v.assigned_to,
    v.human_status,
    v.human_taken_by,
    v.human_taken_at,
    v.human_closed_at,
    v.intent,
    v.sentiment,
    v.lead_score,
    v.follow_up_needed,
    v.follow_up_datetime_iso,
    v.recording_url,
    v.recording_duration_sec,
    c.created_at,
        CASE
            WHEN ((v.status_norm = 'queued'::text) AND (v.started_at IS NOT NULL) AND (v.ended_at IS NULL) AND (c.created_at < (now() - '00:10:00'::interval))) THEN true
            ELSE false
        END AS is_stale_queued
   FROM (contact_center.v_calls_outbound_dashboard v
     JOIN contact_center.calls c ON ((c.id = v.call_id)));

-- v_calls_outbound_dashboard_final
CREATE OR REPLACE VIEW contact_center.v_calls_outbound_dashboard_final AS
 SELECT v.call_id,
    v.lead_id,
    v.tenant_id,
    v.mode,
    v.campaign_id,
    v.campaign_name,
    v.created_at,
    v.started_at,
    v.ended_at,
    v.duration_sec,
    (v.created_at AT TIME ZONE 'America/Lima'::text) AS created_at_pe,
    (v.started_at AT TIME ZONE 'America/Lima'::text) AS started_at_pe,
    (v.ended_at AT TIME ZONE 'America/Lima'::text) AS ended_at_pe,
    lower(replace(regexp_replace(COALESCE(v.status_norm, ''::text), '^\s+|\s+$'::text, ''::text, 'g'::text), '_'::text, '-'::text)) AS status_norm,
        CASE
            WHEN (lower(replace(regexp_replace(COALESCE(v.status_norm, ''::text), '^\s+|\s+$'::text, ''::text, 'g'::text), '_'::text, '-'::text)) = ANY (ARRAY['completed'::text, 'in-progress'::text])) THEN true
            ELSE false
        END AS is_connected,
        CASE
            WHEN (lower(replace(regexp_replace(COALESCE(v.status_norm, ''::text), '^\s+|\s+$'::text, ''::text, 'g'::text), '_'::text, '-'::text)) = ANY (ARRAY['initiated'::text, 'queued'::text, 'in-progress'::text])) THEN false
            ELSE true
        END AS is_terminal,
        CASE
            WHEN (lower(replace(regexp_replace(COALESCE(v.status_norm, ''::text), '^\s+|\s+$'::text, ''::text, 'g'::text), '_'::text, '-'::text)) = ANY (ARRAY['completed'::text, 'in-progress'::text])) THEN 'connected'::text
            WHEN (lower(replace(regexp_replace(COALESCE(v.status_norm, ''::text), '^\s+|\s+$'::text, ''::text, 'g'::text), '_'::text, '-'::text)) = 'no-answer'::text) THEN 'no_answer'::text
            WHEN (lower(replace(regexp_replace(COALESCE(v.status_norm, ''::text), '^\s+|\s+$'::text, ''::text, 'g'::text), '_'::text, '-'::text)) = 'busy'::text) THEN 'busy'::text
            WHEN (lower(replace(regexp_replace(COALESCE(v.status_norm, ''::text), '^\s+|\s+$'::text, ''::text, 'g'::text), '_'::text, '-'::text)) = 'failed'::text) THEN 'failed'::text
            WHEN (lower(replace(regexp_replace(COALESCE(v.status_norm, ''::text), '^\s+|\s+$'::text, ''::text, 'g'::text), '_'::text, '-'::text)) = ANY (ARRAY['canceled'::text, 'cancelled'::text])) THEN 'canceled'::text
            WHEN (lower(replace(regexp_replace(COALESCE(v.status_norm, ''::text), '^\s+|\s+$'::text, ''::text, 'g'::text), '_'::text, '-'::text)) = 'orphaned'::text) THEN 'orphaned'::text
            WHEN (lower(replace(regexp_replace(COALESCE(v.status_norm, ''::text), '^\s+|\s+$'::text, ''::text, 'g'::text), '_'::text, '-'::text)) = ''::text) THEN 'unknown'::text
            ELSE 'other'::text
        END AS result_bucket,
        CASE
            WHEN ((lower(replace(regexp_replace(COALESCE(v.status_norm, ''::text), '^\s+|\s+$'::text, ''::text, 'g'::text), '_'::text, '-'::text)) = 'queued'::text) AND (v.started_at IS NOT NULL) AND (v.ended_at IS NULL) AND (v.created_at < (now() - '00:10:00'::interval))) THEN true
            ELSE false
        END AS is_stale_queued
   FROM contact_center.v_calls_outbound_dashboard_v2 v;

-- v_leads_with_campaign
CREATE OR REPLACE VIEW contact_center.v_leads_with_campaign AS
 SELECT l.id,
    l.source_id,
    l.form_id,
    l.created_at,
    l.fecha,
    l.campaign,
    l.queue_start,
    l.queue_end,
    l.estado_cliente,
    l.estado_usuario,
    l.phone,
    l.usuario,
    l.extension,
    l.duracion_sec,
    l.call_state_general,
    l.call_state,
    l.sale_state_general,
    l.sale_state,
    l.depto,
    l.provincia,
    l.distrito,
    l.raw,
    l.updated_at,
    l.campaign_id,
    COALESCE(c_by_id.id, c_by_code.id) AS campaign_id_resolved,
    COALESCE(c_by_id.code, c_by_code.code) AS campaign_code,
    COALESCE(c_by_id.name, c_by_code.name) AS campaign_name,
    COALESCE(c_by_id.description, c_by_code.description) AS campaign_description,
    COALESCE(c_by_id.objective, c_by_code.objective) AS campaign_objective,
    COALESCE(c_by_id.llm_policy, c_by_code.llm_policy) AS campaign_llm_policy,
    COALESCE(c_by_id.llm_system_prompt, c_by_code.llm_system_prompt) AS campaign_llm_system_prompt,
    COALESCE(c_by_id.success_criteria, c_by_code.success_criteria) AS campaign_success_criteria,
    COALESCE(c_by_id.target_audience, c_by_code.target_audience) AS campaign_target_audience,
    COALESCE(c_by_id.qualification_fields, c_by_code.qualification_fields) AS campaign_qualification_fields,
    COALESCE(c_by_id.allowed_intents, c_by_code.allowed_intents) AS campaign_allowed_intents,
    COALESCE(c_by_id.disallowed_topics, c_by_code.disallowed_topics) AS campaign_disallowed_topics,
    COALESCE(c_by_id.closing_reasons, c_by_code.closing_reasons) AS campaign_closing_reasons,
    COALESCE(c_by_id.is_active, c_by_code.is_active) AS campaign_is_active,
    l.tenant_id
   FROM ((contact_center.leads l
     LEFT JOIN contact_center.campaigns c_by_id ON ((c_by_id.id = l.campaign_id)))
     LEFT JOIN contact_center.campaigns c_by_code ON (((c_by_code.code = l.campaign) AND (l.campaign_id IS NULL))));

-- v_lead_duplicates
CREATE OR REPLACE VIEW contact_center.v_lead_duplicates AS
 SELECT leads.campaign_id,
    leads.phone_norm,
    count(*) AS dup_count,
    array_agg(leads.id ORDER BY leads.created_at DESC) AS lead_ids,
    leads.tenant_id
   FROM contact_center.leads
  WHERE ((leads.phone_norm IS NOT NULL) AND (leads.phone_norm <> ''::text))
  GROUP BY leads.campaign_id, leads.phone_norm, leads.tenant_id
 HAVING (count(*) > 1);

-- v_leads_wow_queue
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

-- Note for developer.
COMMENT ON VIEW contact_center.v_leads_wow_queue IS 'View refreshed for multitenancy foundation (P0-01)';
