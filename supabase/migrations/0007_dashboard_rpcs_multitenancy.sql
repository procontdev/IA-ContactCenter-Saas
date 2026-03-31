-- Migration: 0007_dashboard_rpcs_multitenancy.sql
-- Description: Updates dashboard views and analytical RPCs to be fully tenant-aware.
-- Author: Antigravity

-- 1. Update Views to include tenant_id
-- We need to rebuild them in order because of dependencies.

DROP VIEW IF EXISTS contact_center.v_campaign_stats CASCADE;
DROP VIEW IF EXISTS contact_center.v_outbound_calls_agg CASCADE;
DROP VIEW IF EXISTS contact_center.v_outbound_calls CASCADE;
DROP VIEW IF EXISTS contact_center.v_calls_outbound_dashboard_final CASCADE;
DROP VIEW IF EXISTS contact_center.v_calls_outbound_dashboard_v2 CASCADE;
DROP VIEW IF EXISTS contact_center.v_calls_outbound_dashboard CASCADE;
DROP VIEW IF EXISTS contact_center.v_inbox_threads CASCADE;
DROP VIEW IF EXISTS contact_center.v_inbox_messages CASCADE;

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
    c.tenant_id, -- ✅ Added
    l.campaign_id,
    cam.code AS campaign_code,
    cam.name AS campaign_name
   FROM (((contact_center.call_messages m
     JOIN contact_center.calls c ON ((c.id = m.call_id)))
     LEFT JOIN contact_center.leads l ON ((l.id = c.lead_id)))
     LEFT JOIN contact_center.campaigns cam ON ((cam.id = l.campaign_id)));

-- v_inbox_threads
CREATE OR REPLACE VIEW contact_center.v_inbox_threads AS
 SELECT c.id AS call_id,
    c.lead_id,
    c.tenant_id, -- ✅ Added
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

-- v_calls_outbound_dashboard
CREATE OR REPLACE VIEW contact_center.v_calls_outbound_dashboard AS
 SELECT c.id AS call_id,
    c.lead_id,
    c.tenant_id, -- ✅ Added
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

-- v_calls_outbound_dashboard_v2
CREATE OR REPLACE VIEW contact_center.v_calls_outbound_dashboard_v2 AS
 SELECT v.call_id,
    v.lead_id,
    v.tenant_id, -- ✅ Added
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
    v.tenant_id, -- ✅ Added
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

-- v_outbound_calls
CREATE OR REPLACE VIEW contact_center.v_outbound_calls AS
 SELECT c.id AS call_id,
    c.twilio_call_sid,
    c.lead_id,
    c.tenant_id, -- ✅ Added
    l.campaign_id,
    cp.name AS campaign_name,
    cp.code AS campaign_code,
    l.phone AS lead_phone,
    l.depto,
    l.provincia,
    l.distrito,
    l.estado_cliente,
    l.estado_usuario,
    l.call_state_general,
    l.call_state,
    l.sale_state_general,
    l.sale_state,
    c.mode,
    c.status,
    c.phone AS dialed_phone,
    c.agent_phone,
    c.started_at,
    c.ended_at,
    COALESCE(c.duration_sec, 0) AS duration_sec,
    c.notes,
    c.metadata,
        CASE
            WHEN (COALESCE(c.duration_sec, 0) > 0) THEN true
            WHEN (c.status = ANY (ARRAY['completed'::text, 'answered'::text, 'in-progress'::text])) THEN true
            ELSE false
        END AS is_connected,
    ((c.started_at AT TIME ZONE 'America/Lima'::text))::date AS call_date,
    (EXTRACT(hour FROM (c.started_at AT TIME ZONE 'America/Lima'::text)))::integer AS call_hour,
    (EXTRACT(isodow FROM (c.started_at AT TIME ZONE 'America/Lima'::text)))::integer AS call_day_num,
    TRIM(BOTH FROM to_char((c.started_at AT TIME ZONE 'America/Lima'::text), 'Day'::text)) AS call_day_name,
        CASE
            WHEN (EXTRACT(hour FROM (c.started_at AT TIME ZONE 'America/Lima'::text)) < (12)::numeric) THEN 'a.m.'::text
            ELSE 'p.m.'::text
        END AS period,
    (ceil((EXTRACT(day FROM (c.started_at AT TIME ZONE 'America/Lima'::text)) / 7.0)))::integer AS week_of_month,
        CASE
            WHEN ((EXTRACT(hour FROM (c.started_at AT TIME ZONE 'America/Lima'::text)) >= (0)::numeric) AND (EXTRACT(hour FROM (c.started_at AT TIME ZONE 'America/Lima'::text)) <= (4)::numeric)) THEN '00:00 - 05:00'::text
            WHEN ((EXTRACT(hour FROM (c.started_at AT TIME ZONE 'America/Lima'::text)) >= (5)::numeric) AND (EXTRACT(hour FROM (c.started_at AT TIME ZONE 'America/Lima'::text)) <= (9)::numeric)) THEN '05:00 - 10:00'::text
            WHEN ((EXTRACT(hour FROM (c.started_at AT TIME ZONE 'America/Lima'::text)) >= (10)::numeric) AND (EXTRACT(hour FROM (c.started_at AT TIME ZONE 'America/Lima'::text)) <= (14)::numeric)) THEN '10:00 - 15:00'::text
            WHEN ((EXTRACT(hour FROM (c.started_at AT TIME ZONE 'America/Lima'::text)) >= (15)::numeric) AND (EXTRACT(hour FROM (c.started_at AT TIME ZONE 'America/Lima'::text)) <= (19)::numeric)) THEN '15:00 - 20:00'::text
            ELSE '20:00 - 00:00'::text
        END AS hour_range,
    ca.intent,
    ca.sentiment,
    ca.lead_score,
    ca.next_best_action,
    ca.follow_up_needed,
    ca.follow_up_datetime_iso,
    ca.tags,
    r.recording_url,
    r.storage_path AS recording_storage_path,
    r.duration_sec AS recording_duration_sec,
    r.format AS recording_format
   FROM ((((contact_center.calls c
     JOIN contact_center.leads l ON ((l.id = c.lead_id)))
     LEFT JOIN contact_center.campaigns cp ON ((cp.id = l.campaign_id)))
     LEFT JOIN contact_center.call_analysis ca ON ((ca.call_id = c.id)))
     LEFT JOIN LATERAL ( SELECT r1.id,
            r1.call_id,
            r1.twilio_recording_sid,
            r1.recording_url,
            r1.storage_path,
            r1.duration_sec,
            r1.created_at,
            r1.metadata,
            r1.format
           FROM contact_center.recordings r1
          WHERE (r1.call_id = c.id)
          ORDER BY r1.created_at DESC
         LIMIT 1) r ON (true));

-- v_outbound_calls_agg
CREATE OR REPLACE VIEW contact_center.v_outbound_calls_agg AS
 SELECT v_outbound_calls.call_date,
    v_outbound_calls.call_day_num,
    v_outbound_calls.call_day_name,
    v_outbound_calls.week_of_month,
    v_outbound_calls.period,
    v_outbound_calls.hour_range,
    v_outbound_calls.campaign_id,
    v_outbound_calls.tenant_id, -- ✅ Added
    v_outbound_calls.campaign_name,
    v_outbound_calls.mode,
    count(*) AS total_calls,
    count(*) FILTER (WHERE v_outbound_calls.is_connected) AS connected_calls,
    count(*) FILTER (WHERE (NOT v_outbound_calls.is_connected)) AS not_connected_calls,
    round((((count(*) FILTER (WHERE v_outbound_calls.is_connected))::numeric / (NULLIF(count(*), 0))::numeric) * (100)::numeric), 2) AS contact_rate_pct,
    sum(v_outbound_calls.duration_sec) FILTER (WHERE v_outbound_calls.is_connected) AS total_talk_seconds,
    round(avg(v_outbound_calls.duration_sec) FILTER (WHERE v_outbound_calls.is_connected), 2) AS avg_talk_seconds
   FROM contact_center.v_outbound_calls
  GROUP BY v_outbound_calls.call_date, v_outbound_calls.call_day_num, v_outbound_calls.call_day_name, v_outbound_calls.week_of_month, v_outbound_calls.period, v_outbound_calls.hour_range, v_outbound_calls.campaign_id, v_outbound_calls.tenant_id, v_outbound_calls.campaign_name, v_outbound_calls.mode;

-- v_campaign_stats
CREATE OR REPLACE VIEW contact_center.v_campaign_stats AS
 WITH prod AS (
         SELECT campaign_products.campaign_id,
            count(*) AS products_total
           FROM contact_center.campaign_products
          GROUP BY campaign_products.campaign_id
        ), base AS (
         SELECT c.id AS campaign_id,
            c.tenant_id, -- ✅ Added
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
    base.tenant_id, -- ✅ Added
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

-- 2. Multitenant RPCs

-- contact_center.rpc_calls_kpis
CREATE OR REPLACE FUNCTION contact_center.rpc_calls_kpis(
  p_tenant_id uuid,
  p_from_pe timestamp without time zone,
  p_to_pe timestamp without time zone,
  p_campaign_id uuid DEFAULT NULL,
  p_mode text DEFAULT NULL,
  p_bucket text DEFAULT NULL
) RETURNS TABLE(
  total_calls bigint,
  connected_calls bigint,
  not_connected_calls bigint,
  connect_rate_pct numeric,
  avg_duration_sec numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    count(*)::bigint as total_calls,
    count(*) FILTER (WHERE is_connected)::bigint as connected_calls,
    count(*) FILTER (WHERE NOT is_connected)::bigint as not_connected_calls,
    round((count(*) FILTER (WHERE is_connected)::numeric / NULLIF(count(*), 0) * 100), 2) as connect_rate_pct,
    round(avg(duration_sec) FILTER (WHERE is_connected), 2) as avg_duration_sec
  FROM contact_center.v_calls_outbound_dashboard_final
  WHERE tenant_id = p_tenant_id
    AND created_at_pe >= p_from_pe AND created_at_pe < p_to_pe
    AND (p_campaign_id IS NULL OR campaign_id = p_campaign_id)
    AND (p_mode IS NULL OR mode = p_mode)
    AND (p_bucket IS NULL OR result_bucket = p_bucket);
$$;

-- contact_center.rpc_calls_donut
CREATE OR REPLACE FUNCTION contact_center.rpc_calls_donut(
  p_tenant_id uuid,
  p_from_pe timestamp without time zone,
  p_to_pe timestamp without time zone,
  p_campaign_id uuid DEFAULT NULL,
  p_mode text DEFAULT NULL
) RETURNS TABLE(result_bucket text, calls bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    result_bucket,
    count(*)::bigint as calls
  FROM contact_center.v_calls_outbound_dashboard_final
  WHERE tenant_id = p_tenant_id
    AND created_at_pe >= p_from_pe AND created_at_pe < p_to_pe
    AND (p_campaign_id IS NULL OR campaign_id = p_campaign_id)
    AND (p_mode IS NULL OR mode = p_mode)
  GROUP BY result_bucket
  ORDER BY count(*) DESC;
$$;

-- contact_center.rpc_calls_timeseries
CREATE OR REPLACE FUNCTION contact_center.rpc_calls_timeseries(
  p_tenant_id uuid,
  p_from_pe timestamp without time zone,
  p_to_pe timestamp without time zone,
  p_campaign_id uuid DEFAULT NULL,
  p_mode text DEFAULT NULL,
  p_grain text DEFAULT 'day'
) RETURNS TABLE(bucket_ts timestamp without time zone, total_calls bigint, connected_calls bigint, no_answer_calls bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    date_trunc(p_grain, created_at_pe)::timestamp as bucket_ts,
    count(*)::bigint as total_calls,
    count(*) FILTER (WHERE is_connected)::bigint as connected_calls,
    count(*) FILTER (WHERE result_bucket = 'no_answer')::bigint as no_answer_calls
  FROM contact_center.v_calls_outbound_dashboard_final
  WHERE tenant_id = p_tenant_id
    AND created_at_pe >= p_from_pe AND created_at_pe < p_to_pe
    AND (p_campaign_id IS NULL OR campaign_id = p_campaign_id)
    AND (p_mode IS NULL OR mode = p_mode)
  GROUP BY 1
  ORDER BY 1 ASC;
$$;

-- contact_center.rpc_calls_top_campaigns
CREATE OR REPLACE FUNCTION contact_center.rpc_calls_top_campaigns(
  p_tenant_id uuid,
  p_from_pe timestamp without time zone,
  p_to_pe timestamp without time zone,
  p_campaign_id uuid DEFAULT NULL,
  p_mode text DEFAULT NULL,
  p_limit integer DEFAULT 10
) RETURNS TABLE(campaign_id uuid, campaign_name text, total_calls bigint, connected_calls bigint, connect_rate_pct numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    campaign_id,
    campaign_name,
    count(*)::bigint as total_calls,
    count(*) FILTER (WHERE is_connected)::bigint as connected_calls,
    round((count(*) FILTER (WHERE is_connected)::numeric / NULLIF(count(*), 0) * 100), 2) as connect_rate_pct
  FROM contact_center.v_calls_outbound_dashboard_final
  WHERE tenant_id = p_tenant_id
    AND created_at_pe >= p_from_pe AND created_at_pe < p_to_pe
    AND (p_campaign_id IS NULL OR campaign_id = p_campaign_id)
    AND (p_mode IS NULL OR mode = p_mode)
  GROUP BY campaign_id, campaign_name
  ORDER BY count(*) DESC
  LIMIT p_limit;
$$;

-- contact_center.rpc_calls_table
CREATE OR REPLACE FUNCTION contact_center.rpc_calls_table(
  p_tenant_id uuid,
  p_from_pe timestamp without time zone,
  p_to_pe timestamp without time zone,
  p_campaign_id uuid DEFAULT NULL,
  p_mode text DEFAULT NULL,
  p_bucket text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS TABLE(
  call_id uuid,
  created_at_pe timestamp without time zone,
  campaign_id uuid,
  campaign_name text,
  mode text,
  status_norm text,
  result_bucket text,
  duration_sec integer,
  lead_id uuid,
  twilio_call_sid text
) LANGUAGE sql STABLE AS $$
  -- Note: using contact_center.calls as base for join to twilio_call_sid if not in final view
  SELECT
    v.call_id,
    v.created_at_pe::timestamp,
    v.campaign_id,
    v.campaign_name,
    v.mode,
    v.status_norm,
    v.result_bucket,
    v.duration_sec,
    v.lead_id,
    c.twilio_call_sid
  FROM contact_center.v_calls_outbound_dashboard_final v
  JOIN contact_center.calls c ON c.id = v.call_id
  WHERE v.tenant_id = p_tenant_id
    AND v.created_at_pe >= p_from_pe AND v.created_at_pe < p_to_pe
    AND (p_campaign_id IS NULL OR v.campaign_id = p_campaign_id)
    AND (p_mode IS NULL OR v.mode = p_mode)
    AND (p_bucket IS NULL OR v.result_bucket = p_bucket)
  ORDER BY v.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

-- contact_center.rpc_calls_queue_stale
CREATE OR REPLACE FUNCTION contact_center.rpc_calls_queue_stale(
  p_tenant_id uuid,
  p_from_pe timestamp without time zone,
  p_to_pe timestamp without time zone,
  p_campaign_id uuid DEFAULT NULL,
  p_mode text DEFAULT NULL,
  p_stale_minutes integer DEFAULT 10
) RETURNS TABLE(stale_queued bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    count(*)::bigint as stale_queued
  FROM contact_center.v_calls_outbound_dashboard_final
  WHERE tenant_id = p_tenant_id
    AND is_stale_queued = true
    AND created_at_pe >= p_from_pe AND created_at_pe < p_to_pe
    AND (p_campaign_id IS NULL OR campaign_id = p_campaign_id)
    AND (p_mode IS NULL OR mode = p_mode);
$$;

-- contact_center.rpc_calls_queue_stale_table
CREATE OR REPLACE FUNCTION contact_center.rpc_calls_queue_stale_table(
  p_tenant_id uuid,
  p_from_pe timestamp without time zone,
  p_to_pe timestamp without time zone,
  p_campaign_id uuid DEFAULT NULL,
  p_mode text DEFAULT NULL,
  p_stale_minutes integer DEFAULT 10,
  p_limit integer DEFAULT 10
) RETURNS TABLE(
  call_id uuid,
  created_at_pe timestamp without time zone,
  age_minutes numeric,
  campaign_id uuid,
  campaign_name text,
  mode text,
  status_norm text,
  twilio_call_sid text,
  lead_id uuid
) LANGUAGE sql STABLE AS $$
  SELECT
    v.call_id,
    v.created_at_pe::timestamp,
    EXTRACT(epoch FROM (now() - v.created_at))/60 as age_minutes,
    v.campaign_id,
    v.campaign_name,
    v.mode,
    v.status_norm,
    c.twilio_call_sid,
    v.lead_id
  FROM contact_center.v_calls_outbound_dashboard_final v
  JOIN contact_center.calls c ON c.id = v.call_id
  WHERE v.tenant_id = p_tenant_id
    AND v.is_stale_queued = true
    AND v.created_at_pe >= p_from_pe AND v.created_at_pe < p_to_pe
    AND (p_campaign_id IS NULL OR v.campaign_id = p_campaign_id)
    AND (p_mode IS NULL OR v.mode = p_mode)
  ORDER BY v.created_at ASC
  LIMIT p_limit;
$$;

-- 3. Agent related RPCs (ported from public if needed)

-- contact_center.rpc_calls_agent_list
CREATE OR REPLACE FUNCTION contact_center.rpc_calls_agent_list(
  p_tenant_id uuid,
  p_from_pe timestamp without time zone,
  p_to_pe timestamp without time zone,
  p_campaign_id uuid DEFAULT NULL,
  p_mode text DEFAULT NULL
) RETURNS TABLE(agent text, total_calls bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    human_taken_by as agent,
    count(*)::bigint as total_calls
  FROM contact_center.calls
  WHERE tenant_id = p_tenant_id
    AND created_at AT TIME ZONE 'America/Lima' >= p_from_pe
    AND created_at AT TIME ZONE 'America/Lima' < p_to_pe
    AND (p_campaign_id IS NULL OR lead_id IN (SELECT id FROM contact_center.leads WHERE campaign_id = p_campaign_id))
    AND (p_mode IS NULL OR mode = p_mode)
    AND human_taken_by IS NOT NULL
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

-- contact_center.rpc_calls_agent_kpis
CREATE OR REPLACE FUNCTION contact_center.rpc_calls_agent_kpis(
  p_tenant_id uuid,
  p_from_pe timestamp without time zone,
  p_to_pe timestamp without time zone,
  p_campaign_id uuid DEFAULT NULL,
  p_agent text DEFAULT NULL,
  p_mode text DEFAULT NULL
) RETURNS TABLE(
  agent text,
  total_calls bigint,
  connected_calls bigint,
  avg_duration_sec numeric,
  first_response_avg_sec numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    human_taken_by as agent,
    count(*)::bigint as total_calls,
    count(*) FILTER (WHERE status = 'completed')::bigint as connected_calls,
    round(avg(duration_sec) FILTER (WHERE status = 'completed'), 2) as avg_duration_sec,
    round(avg(EXTRACT(epoch FROM (human_first_response_at - handoff_at))), 2) as first_response_avg_sec
  FROM contact_center.calls
  WHERE tenant_id = p_tenant_id
    AND created_at AT TIME ZONE 'America/Lima' >= p_from_pe
    AND created_at AT TIME ZONE 'America/Lima' < p_to_pe
    AND (p_campaign_id IS NULL OR lead_id IN (SELECT id FROM contact_center.leads WHERE campaign_id = p_campaign_id))
    AND (p_agent IS NULL OR human_taken_by = p_agent)
    AND (p_mode IS NULL OR mode = p_mode)
    AND human_taken_by IS NOT NULL
  GROUP BY 1;
$$;

-- contact_center.rpc_calls_sla_buckets
CREATE OR REPLACE FUNCTION contact_center.rpc_calls_sla_buckets(
  p_tenant_id uuid,
  p_from_pe timestamp without time zone,
  p_to_pe timestamp without time zone,
  p_campaign_id uuid DEFAULT NULL,
  p_agent text DEFAULT NULL
) RETURNS TABLE(bucket text, count bigint)
LANGUAGE sql STABLE AS $$
  WITH response_times AS (
    SELECT
      CASE
        WHEN EXTRACT(epoch FROM (human_first_response_at - handoff_at)) <= 30 THEN '0-30s'
        WHEN EXTRACT(epoch FROM (human_first_response_at - handoff_at)) <= 60 THEN '31-60s'
        WHEN EXTRACT(epoch FROM (human_first_response_at - handoff_at)) <= 180 THEN '1-3m'
        WHEN EXTRACT(epoch FROM (human_first_response_at - handoff_at)) <= 600 THEN '3-10m'
        ELSE '10m+'
      END as bucket
    FROM contact_center.calls
    WHERE tenant_id = p_tenant_id
      AND handoff_at IS NOT NULL
      AND human_first_response_at IS NOT NULL
      AND created_at AT TIME ZONE 'America/Lima' >= p_from_pe
      AND created_at AT TIME ZONE 'America/Lima' < p_to_pe
      AND (p_campaign_id IS NULL OR lead_id IN (SELECT id FROM contact_center.leads WHERE campaign_id = p_campaign_id))
      AND (p_agent IS NULL OR human_taken_by = p_agent)
  )
  SELECT bucket, count(*)::bigint
  FROM response_times
  GROUP BY 1;
$$;

-- Grants
GRANT ALL ON FUNCTION contact_center.rpc_calls_kpis(uuid, timestamp without time zone, timestamp without time zone, uuid, text, text) TO authenticated, anon;
GRANT ALL ON FUNCTION contact_center.rpc_calls_donut(uuid, timestamp without time zone, timestamp without time zone, uuid, text) TO authenticated, anon;
GRANT ALL ON FUNCTION contact_center.rpc_calls_timeseries(uuid, timestamp without time zone, timestamp without time zone, uuid, text, text) TO authenticated, anon;
GRANT ALL ON FUNCTION contact_center.rpc_calls_top_campaigns(uuid, timestamp without time zone, timestamp without time zone, uuid, text, integer) TO authenticated, anon;
GRANT ALL ON FUNCTION contact_center.rpc_calls_table(uuid, timestamp without time zone, timestamp without time zone, uuid, text, text, integer, integer) TO authenticated, anon;
GRANT ALL ON FUNCTION contact_center.rpc_calls_queue_stale(uuid, timestamp without time zone, timestamp without time zone, uuid, text, integer) TO authenticated, anon;
GRANT ALL ON FUNCTION contact_center.rpc_calls_queue_stale_table(uuid, timestamp without time zone, timestamp without time zone, uuid, text, integer, integer) TO authenticated, anon;
GRANT ALL ON FUNCTION contact_center.rpc_calls_agent_list(uuid, timestamp without time zone, timestamp without time zone, uuid, text) TO authenticated, anon;
GRANT ALL ON FUNCTION contact_center.rpc_calls_agent_kpis(uuid, timestamp without time zone, timestamp without time zone, uuid, text, text) TO authenticated, anon;
GRANT ALL ON FUNCTION contact_center.rpc_calls_sla_buckets(uuid, timestamp without time zone, timestamp without time zone, uuid, text) TO authenticated, anon;
