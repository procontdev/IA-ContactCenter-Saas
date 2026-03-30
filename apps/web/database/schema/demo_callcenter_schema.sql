--
-- PostgreSQL database dump
--

-- Dumped from database version 15.8
-- Dumped by pg_dump version 15.8

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: demo_callcenter; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA demo_callcenter;


ALTER SCHEMA demo_callcenter OWNER TO supabase_admin;

--
-- Name: is_valid_phone_pe(text); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.is_valid_phone_pe(p_norm text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$
  SELECT
    p_norm ~ '^[0-9]{9}$'
    AND left(p_norm,1)='9'
    AND p_norm !~ '^([0-9])\1{8}$';
$_$;


ALTER FUNCTION demo_callcenter.is_valid_phone_pe(p_norm text) OWNER TO supabase_admin;

--
-- Name: normalize_call_status(); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.normalize_call_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
begin
  if new.status is not null then
    new.status := lower(replace(regexp_replace(new.status, E'^\\s+|\\s+$', '', 'g'), '_', '-'));
  end if;
  return new;
end;
$_$;


ALTER FUNCTION demo_callcenter.normalize_call_status() OWNER TO supabase_admin;

--
-- Name: normalize_phone_pe(text); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.normalize_phone_pe(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  WITH d AS (
    SELECT regexp_replace(coalesce(p,''), '\D', '', 'g') AS digits
  ),
  c AS (
    SELECT
      CASE
        WHEN length(digits) = 11 AND left(digits,2)='51' THEN right(digits,9)
        WHEN length(digits) = 9 THEN digits
        WHEN length(digits) > 9 THEN right(digits,9)
        ELSE digits
      END AS norm
    FROM d
  )
  SELECT nullif(norm,'') FROM c;
$$;


ALTER FUNCTION demo_callcenter.normalize_phone_pe(p text) OWNER TO supabase_admin;

--
-- Name: recompute_lead_wow(uuid); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.recompute_lead_wow(p_lead_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_phone text;
  v_phone_norm text;
  v_campaign_id uuid;
  v_form_id text;
  v_created_at timestamptz;
  v_fecha timestamptz;
  v_estado_cliente text;
  v_sale_state text;
  v_sale_state_general text;

  v_calls_total int;
  v_connected int;
  v_last_status text;
  v_last_call_at timestamptz;
  v_last_duration int;

  v_intent text;
  v_sentiment text;
  v_follow_up boolean;
  v_follow_up_dt timestamptz;

  v_is_dup boolean;
  v_valid_phone boolean;

  v_score int := 0;
  v_reasons jsonb := '[]'::jsonb;
  v_qflags jsonb := '[]'::jsonb;
  v_sflags jsonb := '[]'::jsonb;

  v_temp text;
  v_nba text;
  v_priority text;
  v_sla timestamptz;

  v_ref_ts timestamptz;
BEGIN
  SELECT
      phone, campaign_id, form_id, created_at, fecha,
      estado_cliente, sale_state, sale_state_general
    INTO
      v_phone, v_campaign_id, v_form_id, v_created_at, v_fecha,
      v_estado_cliente, v_sale_state, v_sale_state_general
  FROM demo_callcenter.leads
  WHERE id = p_lead_id;

  v_ref_ts := COALESCE(v_fecha, v_created_at, now());

  v_phone_norm := demo_callcenter.normalize_phone_pe(v_phone);
  v_valid_phone := demo_callcenter.is_valid_phone_pe(v_phone_norm);

  IF v_phone_norm IS NULL THEN
    v_qflags := v_qflags || jsonb_build_array('missing_phone');
  END IF;

  IF NOT v_valid_phone THEN
    v_sflags := v_sflags || jsonb_build_array('invalid_phone');
  END IF;

  -- Duplicado por campaña + phone_norm
  SELECT EXISTS(
    SELECT 1
    FROM demo_callcenter.v_lead_duplicates d
    WHERE d.campaign_id = v_campaign_id AND d.phone_norm = v_phone_norm
  ) INTO v_is_dup;

  IF v_is_dup THEN
    v_sflags := v_sflags || jsonb_build_array('possible_duplicate');
  END IF;

  -- Resumen de llamadas del lead
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE lower(trim(coalesce(status,''))) IN ('completed','in-progress'))::int,
    (SELECT lower(trim(coalesce(c2.status,''))) FROM demo_callcenter.calls c2 WHERE c2.lead_id=p_lead_id ORDER BY c2.created_at DESC LIMIT 1),
    (SELECT c3.created_at FROM demo_callcenter.calls c3 WHERE c3.lead_id=p_lead_id ORDER BY c3.created_at DESC LIMIT 1),
    (SELECT coalesce(c4.duration_sec,0) FROM demo_callcenter.calls c4 WHERE c4.lead_id=p_lead_id ORDER BY c4.created_at DESC LIMIT 1)
  INTO v_calls_total, v_connected, v_last_status, v_last_call_at, v_last_duration
  FROM demo_callcenter.calls
  WHERE lead_id = p_lead_id;

  -- Último análisis (si existe)
  SELECT ca.intent, ca.sentiment, ca.follow_up_needed, ca.follow_up_datetime_iso
    INTO v_intent, v_sentiment, v_follow_up, v_follow_up_dt
  FROM demo_callcenter.call_analysis ca
  WHERE ca.call_id = (
    SELECT c.id FROM demo_callcenter.calls c
    WHERE c.lead_id = p_lead_id
    ORDER BY c.created_at DESC
    LIMIT 1
  );

  ------------------------------------------------------------------
  -- SCORING (explicable)
  ------------------------------------------------------------------

  -- Higiene base
  IF v_valid_phone THEN
    v_score := v_score + 15;
    v_reasons := v_reasons || jsonb_build_array('phone_valid:+15');
  ELSE
    v_score := v_score - 40;
    v_reasons := v_reasons || jsonb_build_array('phone_invalid:-40');
  END IF;

  IF coalesce(nullif(trim(v_form_id),''),'') <> '' THEN
    v_score := v_score + 5;
    v_reasons := v_reasons || jsonb_build_array('has_form_id:+5');
  END IF;

  IF v_is_dup THEN
    v_score := v_score - 15;
    v_reasons := v_reasons || jsonb_build_array('possible_duplicate:-15');
  END IF;

  -- Señal CSV: contestó / no contestó
  IF coalesce(v_estado_cliente,'') ILIKE 'Contesto%' THEN
    v_score := v_score + 20;
    v_reasons := v_reasons || jsonb_build_array('estado_cliente_contesto:+20');
  ELSIF coalesce(v_estado_cliente,'') ILIKE 'No Contesto%' THEN
    v_score := v_score - 5;
    v_reasons := v_reasons || jsonb_build_array('estado_cliente_no_contesto:-5');
  END IF;

  -- Recencia (fecha o created_at)
  IF v_ref_ts >= now() - interval '24 hours' THEN
    v_score := v_score + 10;
    v_reasons := v_reasons || jsonb_build_array('recent<=24h:+10');
  ELSIF v_ref_ts >= now() - interval '72 hours' THEN
    v_score := v_score + 5;
    v_reasons := v_reasons || jsonb_build_array('recent<=72h:+5');
  END IF;

  -- Contactabilidad (llamadas)
  IF v_calls_total = 0 THEN
    v_score := v_score + 10;
    v_reasons := v_reasons || jsonb_build_array('no_calls_yet:+10');
  ELSE
    IF v_connected > 0 THEN
      v_score := v_score + 20;
      v_reasons := v_reasons || jsonb_build_array('connected:+20');

      IF v_last_duration >= 60 THEN
        v_score := v_score + 10;
        v_reasons := v_reasons || jsonb_build_array('talk_time>=60:+10');
      ELSIF v_last_duration >= 15 THEN
        v_score := v_score + 5;
        v_reasons := v_reasons || jsonb_build_array('talk_time>=15:+5');
      END IF;
    ELSE
      IF v_calls_total >= 3 THEN
        v_score := v_score - 10;
        v_reasons := v_reasons || jsonb_build_array('3+attempts_no_connect:-10');
      END IF;
    END IF;
  END IF;

  -- Señales IA (si hay)
  IF coalesce(nullif(trim(v_intent),''),'') <> '' THEN
    v_score := v_score + 8;
    v_reasons := v_reasons || jsonb_build_array('intent_present:+8');
  END IF;

  IF lower(coalesce(v_sentiment,'')) IN ('positive','pos','muy_positivo') THEN
    v_score := v_score + 6;
    v_reasons := v_reasons || jsonb_build_array('sentiment_positive:+6');
  ELSIF lower(coalesce(v_sentiment,'')) IN ('negative','neg','muy_negativo') THEN
    v_score := v_score - 6;
    v_reasons := v_reasons || jsonb_build_array('sentiment_negative:-6');
  END IF;

  IF coalesce(v_follow_up,false) THEN
    v_score := v_score + 8;
    v_reasons := v_reasons || jsonb_build_array('follow_up_needed:+8');
  END IF;

  -- Señales de venta/seguimiento si existen (opcional y explicable)
  IF lower(coalesce(v_sale_state_general,'')) LIKE '%venta%' OR lower(coalesce(v_sale_state,'')) LIKE '%venta%' THEN
    v_score := v_score + 15;
    v_reasons := v_reasons || jsonb_build_array('sale_state_venta:+15');
  ELSIF lower(coalesce(v_sale_state_general,'')) LIKE '%seguim%' OR lower(coalesce(v_sale_state,'')) LIKE '%seguim%' THEN
    v_score := v_score + 10;
    v_reasons := v_reasons || jsonb_build_array('sale_state_seguimiento:+10');
  END IF;

  -- clamp 0..100
  v_score := greatest(0, least(100, v_score));

  -- Temperatura (demo-friendly y coherente)
  v_temp :=
    CASE
      WHEN v_score >= 70 THEN 'caliente'
      WHEN v_score >= 45 THEN 'tibio'
      ELSE 'frio'
    END;

  -- Next Best Action (NBA)
  IF NOT v_valid_phone THEN
    v_nba := 'Corregir teléfono / validar contacto';
  ELSIF v_is_dup THEN
    v_nba := 'Revisar duplicado y unificar lead';
  ELSIF v_calls_total = 0 THEN
    v_nba := 'Llamar (primer intento)';
  ELSIF coalesce(v_follow_up,false) AND v_follow_up_dt IS NOT NULL THEN
    v_nba := 'Hacer seguimiento en ' || to_char(v_follow_up_dt AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI');
  ELSIF coalesce(v_follow_up,false) THEN
    v_nba := 'Hacer seguimiento (sin hora definida)';
  ELSIF v_connected = 0 AND v_calls_total < 3 THEN
    v_nba := 'Reintentar llamada (no conectado aún)';
  ELSE
    v_nba := 'Revisar outcome y cerrar / derivar según guion';
  END IF;

  -- Prioridad + SLA
  v_priority :=
    CASE
      WHEN v_temp='caliente' THEN 'P1'
      WHEN v_temp='tibio' THEN 'P2'
      ELSE 'P3'
    END;

  v_sla :=
    CASE
      WHEN v_temp='caliente' THEN now() + interval '30 minutes'
      WHEN v_temp='tibio' THEN now() + interval '2 hours'
      ELSE now() + interval '24 hours'
    END;

  UPDATE demo_callcenter.leads
  SET
    phone_norm = v_phone_norm,
    lead_score = v_score,
    lead_temperature = v_temp,
    lead_score_reasons = v_reasons,
    quality_flags = v_qflags,
    spam_flags = v_sflags,
    next_best_action = v_nba,
    priority = v_priority,
    sla_due_at = v_sla,
    last_scored_at = now()
  WHERE id = p_lead_id;

END;
$$;


ALTER FUNCTION demo_callcenter.recompute_lead_wow(p_lead_id uuid) OWNER TO supabase_admin;

--
-- Name: recompute_lead_wow_all(uuid); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.recompute_lead_wow_all(p_campaign_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT id
    FROM demo_callcenter.leads
    WHERE (p_campaign_id IS NULL OR campaign_id = p_campaign_id)
      AND is_active = true
  LOOP
    PERFORM demo_callcenter.recompute_lead_wow(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;


ALTER FUNCTION demo_callcenter.recompute_lead_wow_all(p_campaign_id uuid) OWNER TO supabase_admin;

--
-- Name: rpc_calls_agents(text, text, uuid, text); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.rpc_calls_agents(p_from_pe text, p_to_pe text, p_campaign_id uuid DEFAULT NULL::uuid, p_mode text DEFAULT 'human'::text) RETURNS TABLE(agent text, total_calls bigint)
    LANGUAGE sql STABLE
    AS $$
  select
    c.human_taken_by as agent,
    count(*)::bigint as total_calls
  from demo_callcenter.calls c
  left join demo_callcenter.leads l on l.id = c.lead_id
  where (c.created_at at time zone 'America/Lima') >= (p_from_pe::timestamp)
    and (c.created_at at time zone 'America/Lima') <  (p_to_pe::timestamp)
    and (p_campaign_id is null or l.campaign_id = p_campaign_id)
    and (p_mode is null or c.mode = p_mode)
    and c.human_taken_by is not null
  group by c.human_taken_by
  order by count(*) desc, c.human_taken_by asc;
$$;


ALTER FUNCTION demo_callcenter.rpc_calls_agents(p_from_pe text, p_to_pe text, p_campaign_id uuid, p_mode text) OWNER TO supabase_admin;

--
-- Name: rpc_calls_donut(timestamp without time zone, timestamp without time zone, uuid, text); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.rpc_calls_donut(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid DEFAULT NULL::uuid, p_mode text DEFAULT NULL::text) RETURNS TABLE(result_bucket text, calls bigint)
    LANGUAGE sql STABLE
    AS $$
  select * from public.rpc_calls_donut(p_from_pe, p_to_pe, p_campaign_id, p_mode);
$$;


ALTER FUNCTION demo_callcenter.rpc_calls_donut(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text) OWNER TO supabase_admin;

--
-- Name: rpc_calls_kpis(timestamp without time zone, timestamp without time zone, uuid, text, text); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.rpc_calls_kpis(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid DEFAULT NULL::uuid, p_mode text DEFAULT NULL::text, p_bucket text DEFAULT NULL::text) RETURNS TABLE(total_calls bigint, connected_calls bigint, not_connected_calls bigint, connect_rate_pct numeric, avg_duration_sec numeric)
    LANGUAGE sql STABLE
    AS $$
  select * from public.rpc_calls_kpis(p_from_pe, p_to_pe, p_campaign_id, p_mode, p_bucket);
$$;


ALTER FUNCTION demo_callcenter.rpc_calls_kpis(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_bucket text) OWNER TO supabase_admin;

--
-- Name: rpc_calls_patch_wa_llm(uuid, jsonb); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.rpc_calls_patch_wa_llm(p_call_id uuid, p_patch jsonb) RETURNS TABLE(id uuid, metadata jsonb)
    LANGUAGE plpgsql
    AS $$
begin
  update demo_callcenter.calls c
  set metadata =
    jsonb_set(
      coalesce(c.metadata, '{}'::jsonb),
      '{wa_llm}',
      coalesce(c.metadata->'wa_llm', '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb),
      true
    ),
    updated_at = now()
  where c.id = p_call_id;

  return query
  select c.id, c.metadata
  from demo_callcenter.calls c
  where c.id = p_call_id;
end;
$$;


ALTER FUNCTION demo_callcenter.rpc_calls_patch_wa_llm(p_call_id uuid, p_patch jsonb) OWNER TO supabase_admin;

--
-- Name: rpc_calls_queue_stale(timestamp without time zone, timestamp without time zone, uuid, text, integer); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.rpc_calls_queue_stale(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid DEFAULT NULL::uuid, p_mode text DEFAULT NULL::text, p_stale_minutes integer DEFAULT 10) RETURNS TABLE(stale_queued bigint)
    LANGUAGE sql STABLE
    AS $$
  select * from public.rpc_calls_queue_stale(
    p_from_pe, p_to_pe, p_campaign_id, p_mode, p_stale_minutes
  );
$$;


ALTER FUNCTION demo_callcenter.rpc_calls_queue_stale(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_stale_minutes integer) OWNER TO supabase_admin;

--
-- Name: rpc_calls_queue_stale_table(timestamp without time zone, timestamp without time zone, uuid, text, integer, integer); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.rpc_calls_queue_stale_table(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid DEFAULT NULL::uuid, p_mode text DEFAULT NULL::text, p_stale_minutes integer DEFAULT 10, p_limit integer DEFAULT 10) RETURNS TABLE(call_id uuid, created_at_pe timestamp without time zone, age_minutes numeric, campaign_id uuid, campaign_name text, mode text, status_norm text, twilio_call_sid text, lead_id uuid)
    LANGUAGE sql STABLE
    AS $$
  select * from public.rpc_calls_queue_stale_table(
    p_from_pe, p_to_pe, p_campaign_id, p_mode, p_stale_minutes, p_limit
  );
$$;


ALTER FUNCTION demo_callcenter.rpc_calls_queue_stale_table(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_stale_minutes integer, p_limit integer) OWNER TO supabase_admin;

--
-- Name: rpc_calls_table(timestamp without time zone, timestamp without time zone, uuid, text, text, integer, integer); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.rpc_calls_table(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid DEFAULT NULL::uuid, p_mode text DEFAULT NULL::text, p_bucket text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS TABLE(call_id uuid, created_at_pe timestamp without time zone, campaign_id uuid, campaign_name text, mode text, status_norm text, result_bucket text, duration_sec integer, lead_id uuid, twilio_call_sid text)
    LANGUAGE sql STABLE
    AS $$
  select * from public.rpc_calls_table(p_from_pe, p_to_pe, p_campaign_id, p_mode, p_bucket, p_limit, p_offset);
$$;


ALTER FUNCTION demo_callcenter.rpc_calls_table(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_bucket text, p_limit integer, p_offset integer) OWNER TO supabase_admin;

--
-- Name: rpc_calls_timeseries(timestamp without time zone, timestamp without time zone, uuid, text, text); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.rpc_calls_timeseries(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid DEFAULT NULL::uuid, p_mode text DEFAULT NULL::text, p_grain text DEFAULT 'day'::text) RETURNS TABLE(bucket_ts timestamp without time zone, total_calls bigint, connected_calls bigint, no_answer_calls bigint)
    LANGUAGE sql STABLE
    AS $$
  select * from public.rpc_calls_timeseries(p_from_pe, p_to_pe, p_campaign_id, p_mode, p_grain);
$$;


ALTER FUNCTION demo_callcenter.rpc_calls_timeseries(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_grain text) OWNER TO supabase_admin;

--
-- Name: rpc_calls_top_campaigns(timestamp without time zone, timestamp without time zone, uuid, text, integer); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.rpc_calls_top_campaigns(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid DEFAULT NULL::uuid, p_mode text DEFAULT NULL::text, p_limit integer DEFAULT 10) RETURNS TABLE(campaign_id uuid, campaign_name text, total_calls bigint, connected_calls bigint, connect_rate_pct numeric)
    LANGUAGE sql STABLE
    AS $$
  select * from public.rpc_calls_top_campaigns(p_from_pe, p_to_pe, p_campaign_id, p_mode, p_limit);
$$;


ALTER FUNCTION demo_callcenter.rpc_calls_top_campaigns(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_limit integer) OWNER TO supabase_admin;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION demo_callcenter.set_updated_at() OWNER TO supabase_admin;

--
-- Name: trim_call_status(); Type: FUNCTION; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE FUNCTION demo_callcenter.trim_call_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
begin
  if new.status is not null then
    new.status := regexp_replace(new.status, E'^\\s+|\\s+$', '', 'g');
  end if;
  return new;
end;
$_$;


ALTER FUNCTION demo_callcenter.trim_call_status() OWNER TO supabase_admin;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: call_analysis; Type: TABLE; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE TABLE demo_callcenter.call_analysis (
    call_id uuid NOT NULL,
    transcript text,
    summary text,
    intent text,
    sentiment text,
    objections jsonb,
    next_best_action text,
    lead_score integer,
    tags jsonb,
    created_at timestamp with time zone DEFAULT now(),
    agent_performance jsonb,
    suggested_followup_message text,
    follow_up_needed boolean,
    follow_up_datetime_iso timestamp with time zone
);


ALTER TABLE demo_callcenter.call_analysis OWNER TO supabase_admin;

--
-- Name: call_human_messages; Type: TABLE; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE TABLE demo_callcenter.call_human_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    call_id uuid NOT NULL,
    from_chat_id text NOT NULL,
    from_name text,
    message_text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    from_role text DEFAULT 'advisor'::text NOT NULL
);


ALTER TABLE demo_callcenter.call_human_messages OWNER TO supabase_admin;

--
-- Name: call_messages; Type: TABLE; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE TABLE demo_callcenter.call_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    call_id uuid NOT NULL,
    role text NOT NULL,
    channel text NOT NULL,
    from_id text,
    from_name text,
    message_text text,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    external_id text,
    external_ts bigint,
    instance text
);


ALTER TABLE demo_callcenter.call_messages OWNER TO supabase_admin;

--
-- Name: calls; Type: TABLE; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE TABLE demo_callcenter.calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid,
    mode text NOT NULL,
    agent_phone text,
    twilio_call_sid text,
    status text,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_sec integer,
    created_at timestamp with time zone DEFAULT now(),
    phone text,
    notes text,
    metadata jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    handoff_reason text,
    assigned_channel text,
    assigned_to text,
    handoff_at timestamp with time zone,
    human_status text DEFAULT 'pending'::text,
    human_taken_by text,
    human_taken_at timestamp with time zone,
    human_closed_at timestamp with time zone,
    human_last_message_text text,
    human_last_message_at timestamp with time zone,
    human_first_response_at timestamp with time zone,
    human_response_count integer DEFAULT 0 NOT NULL,
    opening_audio_url text,
    tts_provider text,
    is_simulated boolean DEFAULT false NOT NULL,
    human_taken_by_original text,
    customer_telegram_user_id bigint,
    customer_telegram_chat_id bigint,
    assigned_user_id uuid,
    channel text,
    customer_whatsapp_waid text,
    customer_whatsapp_phone text,
    external_thread_id text,
    human_last_seen_at timestamp with time zone,
    CONSTRAINT calls_mode_check CHECK ((mode = ANY (ARRAY['human'::text, 'llm'::text])))
);


ALTER TABLE demo_callcenter.calls OWNER TO supabase_admin;

--
-- Name: calls_handoff_queue; Type: VIEW; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE VIEW demo_callcenter.calls_handoff_queue AS
 SELECT calls.id AS call_id,
    calls.lead_id,
    calls.phone,
    calls.handoff_reason,
    calls.handoff_at,
    calls.assigned_channel,
    calls.assigned_to,
    calls.human_status,
    calls.human_taken_by,
    calls.human_taken_at,
    ((calls.metadata -> 'llm'::text) ->> 'service_interest'::text) AS service_interest,
    ((calls.metadata -> 'llm'::text) ->> 'stage'::text) AS stage,
    ((calls.metadata -> 'llm'::text) ->> 'last_say'::text) AS last_say
   FROM demo_callcenter.calls
  WHERE ((calls.mode = 'human'::text) AND (calls.handoff_at IS NOT NULL))
  ORDER BY calls.handoff_at DESC;


ALTER TABLE demo_callcenter.calls_handoff_queue OWNER TO supabase_admin;

--
-- Name: campaign_products; Type: TABLE; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE TABLE demo_callcenter.campaign_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    price_monthly numeric(10,2) NOT NULL,
    currency text DEFAULT 'PEN'::text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    disclaimers jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_url text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    price_text text DEFAULT ''::text,
    description text DEFAULT ''::text,
    CONSTRAINT campaign_products_data_is_object CHECK ((jsonb_typeof(data) = 'object'::text)),
    CONSTRAINT campaign_products_disclaimers_is_array CHECK ((jsonb_typeof(disclaimers) = 'array'::text)),
    CONSTRAINT campaign_products_price_nonneg CHECK ((price_monthly >= (0)::numeric))
);


ALTER TABLE demo_callcenter.campaign_products OWNER TO supabase_admin;

--
-- Name: campaigns; Type: TABLE; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE TABLE demo_callcenter.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    objective text DEFAULT ''::text NOT NULL,
    success_criteria text DEFAULT ''::text NOT NULL,
    target_audience text DEFAULT ''::text NOT NULL,
    llm_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    llm_system_prompt text DEFAULT ''::text NOT NULL,
    qualification_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    allowed_intents jsonb DEFAULT '[]'::jsonb NOT NULL,
    disallowed_topics jsonb DEFAULT '[]'::jsonb NOT NULL,
    closing_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    opening_script text DEFAULT ''::text NOT NULL,
    opening_question text DEFAULT ''::text NOT NULL,
    inbound_enabled boolean DEFAULT true NOT NULL,
    inbound_default_mode text DEFAULT 'human'::text NOT NULL,
    inbound_llm_text_enabled boolean DEFAULT false NOT NULL,
    llm_model text,
    llm_fallback_to_human boolean DEFAULT true NOT NULL,
    wa_instance text,
    wa_business_phone text,
    CONSTRAINT campaigns_wa_business_phone_digits CHECK (((wa_business_phone IS NULL) OR (wa_business_phone ~ '^[0-9]{8,15}$'::text)))
);


ALTER TABLE demo_callcenter.campaigns OWNER TO supabase_admin;

--
-- Name: COLUMN campaigns.wa_instance; Type: COMMENT; Schema: demo_callcenter; Owner: supabase_admin
--

COMMENT ON COLUMN demo_callcenter.campaigns.wa_instance IS 'Nombre de instancia en Evolution API (ej: "Moderna WA")';


--
-- Name: COLUMN campaigns.wa_business_phone; Type: COMMENT; Schema: demo_callcenter; Owner: supabase_admin
--

COMMENT ON COLUMN demo_callcenter.campaigns.wa_business_phone IS 'Número WhatsApp del business/agente sin + (ej: "51913768894")';


--
-- Name: leads; Type: TABLE; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE TABLE demo_callcenter.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id text,
    form_id text,
    created_at timestamp with time zone DEFAULT now(),
    fecha timestamp with time zone,
    campaign text,
    queue_start text,
    queue_end text,
    estado_cliente text,
    estado_usuario text,
    phone text,
    usuario text,
    extension text,
    duracion_sec integer,
    call_state_general text,
    call_state text,
    sale_state_general text,
    sale_state text,
    depto text,
    provincia text,
    distrito text,
    raw jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    campaign_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    import_batch_id uuid,
    archived_at timestamp with time zone,
    phone_norm text,
    lead_score integer,
    lead_temperature text,
    lead_score_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    quality_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    spam_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    next_best_action text,
    priority text,
    sla_due_at timestamp with time zone,
    last_scored_at timestamp with time zone,
    telegram_user_id bigint,
    telegram_chat_id bigint,
    channel text,
    whatsapp_waid text,
    whatsapp_phone text,
    last_inbound_at timestamp with time zone
);


ALTER TABLE demo_callcenter.leads OWNER TO supabase_admin;

--
-- Name: notifications_log; Type: TABLE; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE TABLE demo_callcenter.notifications_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rule_id text NOT NULL,
    severity text NOT NULL,
    campaign_id uuid,
    mode text,
    window_from_pe timestamp without time zone NOT NULL,
    window_to_pe timestamp without time zone NOT NULL,
    sent boolean DEFAULT false NOT NULL,
    notify_reason text,
    snapshot jsonb,
    response jsonb,
    error text
);


ALTER TABLE demo_callcenter.notifications_log OWNER TO supabase_admin;

--
-- Name: recordings; Type: TABLE; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE TABLE demo_callcenter.recordings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    call_id uuid NOT NULL,
    twilio_recording_sid text,
    recording_url text,
    storage_path text,
    duration_sec integer,
    created_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    format text
);


ALTER TABLE demo_callcenter.recordings OWNER TO supabase_admin;

--
-- Name: v_call_customer_chat; Type: VIEW; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE VIEW demo_callcenter.v_call_customer_chat AS
 SELECT c.id AS call_id,
    c.customer_telegram_chat_id,
    c.customer_telegram_user_id,
    c.lead_id,
    c.phone,
    c.created_at
   FROM demo_callcenter.calls c;


ALTER TABLE demo_callcenter.v_call_customer_chat OWNER TO supabase_admin;

--
-- Name: v_calls_audit; Type: VIEW; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE VIEW demo_callcenter.v_calls_audit AS
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
    COALESCE(NULLIF(btrim(l.usuario), ''::text), 'Sin Información'::text) AS lead_usuario
   FROM (demo_callcenter.calls c
     JOIN demo_callcenter.leads l ON ((l.id = c.lead_id)));


ALTER TABLE demo_callcenter.v_calls_audit OWNER TO supabase_admin;

--
-- Name: v_calls_outbound_dashboard; Type: VIEW; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE VIEW demo_callcenter.v_calls_outbound_dashboard AS
 SELECT c.id AS call_id,
    c.lead_id,
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
   FROM ((((demo_callcenter.calls c
     LEFT JOIN demo_callcenter.leads l ON ((l.id = c.lead_id)))
     LEFT JOIN demo_callcenter.campaigns camp ON ((camp.id = l.campaign_id)))
     LEFT JOIN demo_callcenter.call_analysis ca ON ((ca.call_id = c.id)))
     LEFT JOIN LATERAL ( SELECT r.recording_url,
            r.duration_sec
           FROM demo_callcenter.recordings r
          WHERE (r.call_id = c.id)
          ORDER BY r.created_at DESC
         LIMIT 1) rec ON (true));


ALTER TABLE demo_callcenter.v_calls_outbound_dashboard OWNER TO supabase_admin;

--
-- Name: v_calls_outbound_dashboard_v2; Type: VIEW; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE VIEW demo_callcenter.v_calls_outbound_dashboard_v2 AS
 SELECT v.call_id,
    v.lead_id,
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
   FROM (demo_callcenter.v_calls_outbound_dashboard v
     JOIN demo_callcenter.calls c ON ((c.id = v.call_id)));


ALTER TABLE demo_callcenter.v_calls_outbound_dashboard_v2 OWNER TO supabase_admin;

--
-- Name: v_calls_outbound_dashboard_final; Type: VIEW; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE VIEW demo_callcenter.v_calls_outbound_dashboard_final AS
 SELECT v.call_id,
    v.lead_id,
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
   FROM demo_callcenter.v_calls_outbound_dashboard_v2 v;


ALTER TABLE demo_callcenter.v_calls_outbound_dashboard_final OWNER TO supabase_admin;

--
-- Name: v_campaign_stats; Type: VIEW; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE VIEW demo_callcenter.v_campaign_stats AS
 WITH prod AS (
         SELECT campaign_products.campaign_id,
            count(*) AS products_total
           FROM demo_callcenter.campaign_products
          GROUP BY campaign_products.campaign_id
        ), base AS (
         SELECT c.id AS campaign_id,
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
           FROM (((demo_callcenter.campaigns c
             LEFT JOIN demo_callcenter.leads l ON ((l.campaign_id = c.id)))
             LEFT JOIN demo_callcenter.calls ca ON ((ca.lead_id = l.id)))
             LEFT JOIN prod p ON ((p.campaign_id = c.id)))
          GROUP BY c.id, c.code, c.name, c.is_active, c.description, c.created_at, c.updated_at, p.products_total
        )
 SELECT base.campaign_id,
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


ALTER TABLE demo_callcenter.v_campaign_stats OWNER TO supabase_admin;

--
-- Name: v_inbox_messages; Type: VIEW; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE VIEW demo_callcenter.v_inbox_messages AS
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
    l.campaign_id,
    cam.code AS campaign_code,
    cam.name AS campaign_name
   FROM (((demo_callcenter.call_messages m
     JOIN demo_callcenter.calls c ON ((c.id = m.call_id)))
     LEFT JOIN demo_callcenter.leads l ON ((l.id = c.lead_id)))
     LEFT JOIN demo_callcenter.campaigns cam ON ((cam.id = l.campaign_id)));


ALTER TABLE demo_callcenter.v_inbox_messages OWNER TO supabase_admin;

--
-- Name: v_inbox_threads; Type: VIEW; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE VIEW demo_callcenter.v_inbox_threads AS
 SELECT c.id AS call_id,
    c.lead_id,
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
           FROM demo_callcenter.call_messages m
          WHERE ((m.call_id = c.id) AND (m.role = 'lead'::text) AND (m.created_at > COALESCE(c.human_last_seen_at, c.handoff_at, c.created_at, '1970-01-01 00:00:00+00'::timestamp with time zone)))) AS unread_count,
    ( SELECT count(*) AS count
           FROM demo_callcenter.call_messages m
          WHERE (m.call_id = c.id)) AS message_count
   FROM (((demo_callcenter.calls c
     LEFT JOIN demo_callcenter.leads l ON ((l.id = c.lead_id)))
     LEFT JOIN demo_callcenter.campaigns cam ON ((cam.id = l.campaign_id)))
     LEFT JOIN LATERAL ( SELECT m.created_at AS last_message_at,
            m.message_text AS last_message_text,
            m.role AS last_message_role
           FROM demo_callcenter.call_messages m
          WHERE (m.call_id = c.id)
          ORDER BY m.created_at DESC
         LIMIT 1) lm ON (true));


ALTER TABLE demo_callcenter.v_inbox_threads OWNER TO supabase_admin;

--
-- Name: v_lead_duplicates; Type: VIEW; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE VIEW demo_callcenter.v_lead_duplicates AS
 SELECT leads.campaign_id,
    leads.phone_norm,
    count(*) AS dup_count,
    array_agg(leads.id ORDER BY leads.created_at DESC) AS lead_ids
   FROM demo_callcenter.leads
  WHERE ((leads.phone_norm IS NOT NULL) AND (leads.phone_norm <> ''::text))
  GROUP BY leads.campaign_id, leads.phone_norm
 HAVING (count(*) > 1);


ALTER TABLE demo_callcenter.v_lead_duplicates OWNER TO supabase_admin;

--
-- Name: v_leads_with_campaign; Type: VIEW; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE VIEW demo_callcenter.v_leads_with_campaign AS
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
    COALESCE(c_by_id.is_active, c_by_code.is_active) AS campaign_is_active
   FROM ((demo_callcenter.leads l
     LEFT JOIN demo_callcenter.campaigns c_by_id ON ((c_by_id.id = l.campaign_id)))
     LEFT JOIN demo_callcenter.campaigns c_by_code ON (((c_by_code.code = l.campaign) AND (l.campaign_id IS NULL))));


ALTER TABLE demo_callcenter.v_leads_with_campaign OWNER TO supabase_admin;

--
-- Name: v_leads_wow_queue; Type: VIEW; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE VIEW demo_callcenter.v_leads_wow_queue AS
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
    l.is_active
   FROM demo_callcenter.leads l
  WHERE (l.is_active = true)
  ORDER BY
        CASE l.priority
            WHEN 'P1'::text THEN 1
            WHEN 'P2'::text THEN 2
            ELSE 3
        END, l.lead_score DESC NULLS LAST, l.sla_due_at, l.created_at DESC;


ALTER TABLE demo_callcenter.v_leads_wow_queue OWNER TO supabase_admin;

--
-- Name: v_outbound_calls; Type: VIEW; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE VIEW demo_callcenter.v_outbound_calls AS
 SELECT c.id AS call_id,
    c.twilio_call_sid,
    c.lead_id,
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
   FROM ((((demo_callcenter.calls c
     JOIN demo_callcenter.leads l ON ((l.id = c.lead_id)))
     LEFT JOIN demo_callcenter.campaigns cp ON ((cp.id = l.campaign_id)))
     LEFT JOIN demo_callcenter.call_analysis ca ON ((ca.call_id = c.id)))
     LEFT JOIN LATERAL ( SELECT r1.id,
            r1.call_id,
            r1.twilio_recording_sid,
            r1.recording_url,
            r1.storage_path,
            r1.duration_sec,
            r1.created_at,
            r1.metadata,
            r1.format
           FROM demo_callcenter.recordings r1
          WHERE (r1.call_id = c.id)
          ORDER BY r1.created_at DESC
         LIMIT 1) r ON (true));


ALTER TABLE demo_callcenter.v_outbound_calls OWNER TO supabase_admin;

--
-- Name: v_outbound_calls_agg; Type: VIEW; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE VIEW demo_callcenter.v_outbound_calls_agg AS
 SELECT v_outbound_calls.call_date,
    v_outbound_calls.call_day_num,
    v_outbound_calls.call_day_name,
    v_outbound_calls.week_of_month,
    v_outbound_calls.period,
    v_outbound_calls.hour_range,
    v_outbound_calls.campaign_id,
    v_outbound_calls.campaign_name,
    v_outbound_calls.mode,
    count(*) AS total_calls,
    count(*) FILTER (WHERE v_outbound_calls.is_connected) AS connected_calls,
    count(*) FILTER (WHERE (NOT v_outbound_calls.is_connected)) AS not_connected_calls,
    round((((count(*) FILTER (WHERE v_outbound_calls.is_connected))::numeric / (NULLIF(count(*), 0))::numeric) * (100)::numeric), 2) AS contact_rate_pct,
    sum(v_outbound_calls.duration_sec) FILTER (WHERE v_outbound_calls.is_connected) AS total_talk_seconds,
    round(avg(v_outbound_calls.duration_sec) FILTER (WHERE v_outbound_calls.is_connected), 2) AS avg_talk_seconds
   FROM demo_callcenter.v_outbound_calls
  GROUP BY v_outbound_calls.call_date, v_outbound_calls.call_day_num, v_outbound_calls.call_day_name, v_outbound_calls.week_of_month, v_outbound_calls.period, v_outbound_calls.hour_range, v_outbound_calls.campaign_id, v_outbound_calls.campaign_name, v_outbound_calls.mode;


ALTER TABLE demo_callcenter.v_outbound_calls_agg OWNER TO supabase_admin;

--
-- Name: call_analysis call_analysis_pkey; Type: CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.call_analysis
    ADD CONSTRAINT call_analysis_pkey PRIMARY KEY (call_id);


--
-- Name: call_human_messages call_human_messages_pkey; Type: CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.call_human_messages
    ADD CONSTRAINT call_human_messages_pkey PRIMARY KEY (id);


--
-- Name: call_messages call_messages_pkey; Type: CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.call_messages
    ADD CONSTRAINT call_messages_pkey PRIMARY KEY (id);


--
-- Name: calls calls_pkey; Type: CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.calls
    ADD CONSTRAINT calls_pkey PRIMARY KEY (id);


--
-- Name: campaign_products campaign_products_code_unique; Type: CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.campaign_products
    ADD CONSTRAINT campaign_products_code_unique UNIQUE (campaign_id, code);


--
-- Name: campaign_products campaign_products_pkey; Type: CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.campaign_products
    ADD CONSTRAINT campaign_products_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_code_key; Type: CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.campaigns
    ADD CONSTRAINT campaigns_code_key UNIQUE (code);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: leads leads_campaign_source_id_uk; Type: CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.leads
    ADD CONSTRAINT leads_campaign_source_id_uk UNIQUE (campaign_id, source_id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: notifications_log notifications_log_pkey; Type: CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.notifications_log
    ADD CONSTRAINT notifications_log_pkey PRIMARY KEY (id);


--
-- Name: recordings recordings_pkey; Type: CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.recordings
    ADD CONSTRAINT recordings_pkey PRIMARY KEY (id);


--
-- Name: calls_is_simulated_idx; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX calls_is_simulated_idx ON demo_callcenter.calls USING btree (is_simulated);


--
-- Name: calls_phone_idx; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX calls_phone_idx ON demo_callcenter.calls USING btree (phone);


--
-- Name: calls_twilio_call_sid_uidx; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE UNIQUE INDEX calls_twilio_call_sid_uidx ON demo_callcenter.calls USING btree (twilio_call_sid) WHERE (twilio_call_sid IS NOT NULL);


--
-- Name: idx_call_human_messages_call_id_created; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_call_human_messages_call_id_created ON demo_callcenter.call_human_messages USING btree (call_id, created_at DESC);


--
-- Name: idx_call_messages_call_id_created_at; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_call_messages_call_id_created_at ON demo_callcenter.call_messages USING btree (call_id, created_at DESC);


--
-- Name: idx_calls_channel; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_calls_channel ON demo_callcenter.calls USING btree (channel);


--
-- Name: idx_calls_customer_waid; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_calls_customer_waid ON demo_callcenter.calls USING btree (customer_whatsapp_waid);


--
-- Name: idx_calls_handoff_queue; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_calls_handoff_queue ON demo_callcenter.calls USING btree (mode, handoff_at DESC) WHERE ((mode = 'human'::text) AND (handoff_at IS NOT NULL));


--
-- Name: idx_calls_mode; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_calls_mode ON demo_callcenter.calls USING btree (mode);


--
-- Name: idx_calls_started_at; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_calls_started_at ON demo_callcenter.calls USING btree (started_at);


--
-- Name: idx_calls_status; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_calls_status ON demo_callcenter.calls USING btree (status);


--
-- Name: idx_campaigns_wa_business_phone; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_campaigns_wa_business_phone ON demo_callcenter.campaigns USING btree (wa_business_phone);


--
-- Name: idx_campaigns_wa_instance; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_campaigns_wa_instance ON demo_callcenter.campaigns USING btree (wa_instance);


--
-- Name: idx_cc_calls_twilio_sid; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_cc_calls_twilio_sid ON demo_callcenter.calls USING btree (twilio_call_sid);


--
-- Name: idx_cc_leads_campaign; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_cc_leads_campaign ON demo_callcenter.leads USING btree (campaign);


--
-- Name: idx_cc_leads_fecha; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_cc_leads_fecha ON demo_callcenter.leads USING btree (fecha);


--
-- Name: idx_cc_leads_phone; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_cc_leads_phone ON demo_callcenter.leads USING btree (phone);


--
-- Name: idx_cc_recordings_call_id; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_cc_recordings_call_id ON demo_callcenter.recordings USING btree (call_id);


--
-- Name: idx_leads_whatsapp_phone; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_leads_whatsapp_phone ON demo_callcenter.leads USING btree (whatsapp_phone);


--
-- Name: idx_leads_whatsapp_waid; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX idx_leads_whatsapp_waid ON demo_callcenter.leads USING btree (whatsapp_waid);


--
-- Name: ix_call_messages_call_id_created_at; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_call_messages_call_id_created_at ON demo_callcenter.call_messages USING btree (call_id, created_at DESC);


--
-- Name: ix_call_messages_channel_from_id_created_at; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_call_messages_channel_from_id_created_at ON demo_callcenter.call_messages USING btree (channel, from_id, created_at DESC);


--
-- Name: ix_calls_assigned_to; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_calls_assigned_to ON demo_callcenter.calls USING btree (assigned_to);


--
-- Name: ix_calls_assigned_user_id; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_calls_assigned_user_id ON demo_callcenter.calls USING btree (assigned_user_id);


--
-- Name: ix_calls_created_at; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_calls_created_at ON demo_callcenter.calls USING btree (created_at DESC);


--
-- Name: ix_calls_lead_id; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_calls_lead_id ON demo_callcenter.calls USING btree (lead_id);


--
-- Name: ix_campaign_products_campaign_id; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_campaign_products_campaign_id ON demo_callcenter.campaign_products USING btree (campaign_id);


--
-- Name: ix_campaign_products_is_active; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_campaign_products_is_active ON demo_callcenter.campaign_products USING btree (is_active);


--
-- Name: ix_campaigns_is_active; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_campaigns_is_active ON demo_callcenter.campaigns USING btree (is_active);


--
-- Name: ix_campaigns_updated_at; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_campaigns_updated_at ON demo_callcenter.campaigns USING btree (updated_at DESC);


--
-- Name: ix_leads_campaign_active; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_leads_campaign_active ON demo_callcenter.leads USING btree (campaign_id, is_active);


--
-- Name: ix_leads_campaign_id; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_leads_campaign_id ON demo_callcenter.leads USING btree (campaign_id);


--
-- Name: ix_leads_campaign_importbatch; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_leads_campaign_importbatch ON demo_callcenter.leads USING btree (campaign_id, import_batch_id);


--
-- Name: ix_leads_phone_norm; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_leads_phone_norm ON demo_callcenter.leads USING btree (phone_norm);


--
-- Name: ix_leads_score_desc; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_leads_score_desc ON demo_callcenter.leads USING btree (lead_score DESC NULLS LAST);


--
-- Name: ix_leads_sla_due; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_leads_sla_due ON demo_callcenter.leads USING btree (sla_due_at);


--
-- Name: ix_notifications_log_rule_time; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX ix_notifications_log_rule_time ON demo_callcenter.notifications_log USING btree (rule_id, campaign_id, mode, created_at DESC);


--
-- Name: recordings_metadata_callsid_idx; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE INDEX recordings_metadata_callsid_idx ON demo_callcenter.recordings USING btree (((metadata ->> 'CallSid'::text)));


--
-- Name: recordings_twilio_sid_uidx; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE UNIQUE INDEX recordings_twilio_sid_uidx ON demo_callcenter.recordings USING btree (twilio_recording_sid) WHERE (twilio_recording_sid IS NOT NULL);


--
-- Name: uq_cc_call_messages_wa_lead_ext; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE UNIQUE INDEX uq_cc_call_messages_wa_lead_ext ON demo_callcenter.call_messages USING btree (call_id, external_id) WHERE ((channel = 'whatsapp'::text) AND (role = 'lead'::text) AND (external_id IS NOT NULL));


--
-- Name: uq_leads_campaign_source; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE UNIQUE INDEX uq_leads_campaign_source ON demo_callcenter.leads USING btree (campaign_id, source_id) WHERE ((source_id IS NOT NULL) AND (source_id <> ''::text));


--
-- Name: uq_leads_campaign_source_clean; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE UNIQUE INDEX uq_leads_campaign_source_clean ON demo_callcenter.leads USING btree (campaign_id, source_id) WHERE ((source_id IS NOT NULL) AND (btrim(source_id) <> ''::text));


--
-- Name: ux_call_messages_channel_external_id; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE UNIQUE INDEX ux_call_messages_channel_external_id ON demo_callcenter.call_messages USING btree (channel, external_id) WHERE (external_id IS NOT NULL);


--
-- Name: ux_leads_campaign_source; Type: INDEX; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE UNIQUE INDEX ux_leads_campaign_source ON demo_callcenter.leads USING btree (campaign_id, source_id) WHERE (source_id IS NOT NULL);


--
-- Name: calls trg_calls_normalize_status; Type: TRIGGER; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE TRIGGER trg_calls_normalize_status BEFORE INSERT OR UPDATE ON demo_callcenter.calls FOR EACH ROW EXECUTE FUNCTION demo_callcenter.normalize_call_status();


--
-- Name: calls trg_calls_set_updated_at; Type: TRIGGER; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE TRIGGER trg_calls_set_updated_at BEFORE UPDATE ON demo_callcenter.calls FOR EACH ROW EXECUTE FUNCTION demo_callcenter.set_updated_at();


--
-- Name: campaign_products trg_campaign_products_set_updated_at; Type: TRIGGER; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE TRIGGER trg_campaign_products_set_updated_at BEFORE UPDATE ON demo_callcenter.campaign_products FOR EACH ROW EXECUTE FUNCTION demo_callcenter.set_updated_at();


--
-- Name: campaigns trg_campaigns_set_updated_at; Type: TRIGGER; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE TRIGGER trg_campaigns_set_updated_at BEFORE UPDATE ON demo_callcenter.campaigns FOR EACH ROW EXECUTE FUNCTION demo_callcenter.set_updated_at();


--
-- Name: leads trg_leads_updated_at; Type: TRIGGER; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON demo_callcenter.leads FOR EACH ROW EXECUTE FUNCTION demo_callcenter.set_updated_at();


--
-- Name: call_analysis call_analysis_call_id_fkey; Type: FK CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.call_analysis
    ADD CONSTRAINT call_analysis_call_id_fkey FOREIGN KEY (call_id) REFERENCES demo_callcenter.calls(id) ON DELETE CASCADE;


--
-- Name: call_human_messages call_human_messages_call_id_fkey; Type: FK CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.call_human_messages
    ADD CONSTRAINT call_human_messages_call_id_fkey FOREIGN KEY (call_id) REFERENCES demo_callcenter.calls(id) ON DELETE CASCADE;


--
-- Name: call_messages call_messages_call_id_fkey; Type: FK CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.call_messages
    ADD CONSTRAINT call_messages_call_id_fkey FOREIGN KEY (call_id) REFERENCES demo_callcenter.calls(id) ON DELETE CASCADE;


--
-- Name: calls calls_lead_fk; Type: FK CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.calls
    ADD CONSTRAINT calls_lead_fk FOREIGN KEY (lead_id) REFERENCES demo_callcenter.leads(id) ON DELETE SET NULL;


--
-- Name: campaign_products fk_campaign_products_campaign; Type: FK CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.campaign_products
    ADD CONSTRAINT fk_campaign_products_campaign FOREIGN KEY (campaign_id) REFERENCES demo_callcenter.campaigns(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: leads leads_campaign_id_fkey; Type: FK CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.leads
    ADD CONSTRAINT leads_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES demo_callcenter.campaigns(id);


--
-- Name: recordings recordings_call_id_fkey; Type: FK CONSTRAINT; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE ONLY demo_callcenter.recordings
    ADD CONSTRAINT recordings_call_id_fkey FOREIGN KEY (call_id) REFERENCES demo_callcenter.calls(id) ON DELETE CASCADE;


--
-- Name: call_human_messages; Type: ROW SECURITY; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE demo_callcenter.call_human_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: call_human_messages call_human_messages_insert_anon; Type: POLICY; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE POLICY call_human_messages_insert_anon ON demo_callcenter.call_human_messages FOR INSERT TO anon WITH CHECK (true);


--
-- Name: call_human_messages call_human_messages_insert_auth; Type: POLICY; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE POLICY call_human_messages_insert_auth ON demo_callcenter.call_human_messages FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: call_human_messages call_human_messages_select_anon; Type: POLICY; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE POLICY call_human_messages_select_anon ON demo_callcenter.call_human_messages FOR SELECT TO anon USING (true);


--
-- Name: calls; Type: ROW SECURITY; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE demo_callcenter.calls ENABLE ROW LEVEL SECURITY;

--
-- Name: calls calls_select_anon; Type: POLICY; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE POLICY calls_select_anon ON demo_callcenter.calls FOR SELECT TO anon USING (true);


--
-- Name: calls calls_update_anon; Type: POLICY; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE POLICY calls_update_anon ON demo_callcenter.calls FOR UPDATE TO anon USING (true) WITH CHECK (true);


--
-- Name: leads; Type: ROW SECURITY; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER TABLE demo_callcenter.leads ENABLE ROW LEVEL SECURITY;

--
-- Name: leads leads_insert; Type: POLICY; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE POLICY leads_insert ON demo_callcenter.leads FOR INSERT WITH CHECK (true);


--
-- Name: leads leads_select; Type: POLICY; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE POLICY leads_select ON demo_callcenter.leads FOR SELECT USING (true);


--
-- Name: leads leads_update; Type: POLICY; Schema: demo_callcenter; Owner: supabase_admin
--

CREATE POLICY leads_update ON demo_callcenter.leads FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: SCHEMA demo_callcenter; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA demo_callcenter TO anon;
GRANT USAGE ON SCHEMA demo_callcenter TO authenticated;
GRANT USAGE ON SCHEMA demo_callcenter TO service_role;
GRANT USAGE ON SCHEMA demo_callcenter TO postgres;


--
-- Name: FUNCTION is_valid_phone_pe(p_norm text); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.is_valid_phone_pe(p_norm text) TO anon;
GRANT ALL ON FUNCTION demo_callcenter.is_valid_phone_pe(p_norm text) TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.is_valid_phone_pe(p_norm text) TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.is_valid_phone_pe(p_norm text) TO postgres;


--
-- Name: FUNCTION normalize_call_status(); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.normalize_call_status() TO anon;
GRANT ALL ON FUNCTION demo_callcenter.normalize_call_status() TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.normalize_call_status() TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.normalize_call_status() TO postgres;


--
-- Name: FUNCTION normalize_phone_pe(p text); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.normalize_phone_pe(p text) TO anon;
GRANT ALL ON FUNCTION demo_callcenter.normalize_phone_pe(p text) TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.normalize_phone_pe(p text) TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.normalize_phone_pe(p text) TO postgres;


--
-- Name: FUNCTION recompute_lead_wow(p_lead_id uuid); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.recompute_lead_wow(p_lead_id uuid) TO anon;
GRANT ALL ON FUNCTION demo_callcenter.recompute_lead_wow(p_lead_id uuid) TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.recompute_lead_wow(p_lead_id uuid) TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.recompute_lead_wow(p_lead_id uuid) TO postgres;


--
-- Name: FUNCTION recompute_lead_wow_all(p_campaign_id uuid); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.recompute_lead_wow_all(p_campaign_id uuid) TO anon;
GRANT ALL ON FUNCTION demo_callcenter.recompute_lead_wow_all(p_campaign_id uuid) TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.recompute_lead_wow_all(p_campaign_id uuid) TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.recompute_lead_wow_all(p_campaign_id uuid) TO postgres;


--
-- Name: FUNCTION rpc_calls_agents(p_from_pe text, p_to_pe text, p_campaign_id uuid, p_mode text); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_agents(p_from_pe text, p_to_pe text, p_campaign_id uuid, p_mode text) TO anon;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_agents(p_from_pe text, p_to_pe text, p_campaign_id uuid, p_mode text) TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_agents(p_from_pe text, p_to_pe text, p_campaign_id uuid, p_mode text) TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_agents(p_from_pe text, p_to_pe text, p_campaign_id uuid, p_mode text) TO postgres;


--
-- Name: FUNCTION rpc_calls_donut(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_donut(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text) TO anon;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_donut(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text) TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_donut(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text) TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_donut(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text) TO postgres;


--
-- Name: FUNCTION rpc_calls_kpis(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_bucket text); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_kpis(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_bucket text) TO anon;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_kpis(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_bucket text) TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_kpis(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_bucket text) TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_kpis(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_bucket text) TO postgres;


--
-- Name: FUNCTION rpc_calls_patch_wa_llm(p_call_id uuid, p_patch jsonb); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_patch_wa_llm(p_call_id uuid, p_patch jsonb) TO anon;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_patch_wa_llm(p_call_id uuid, p_patch jsonb) TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_patch_wa_llm(p_call_id uuid, p_patch jsonb) TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_patch_wa_llm(p_call_id uuid, p_patch jsonb) TO postgres;


--
-- Name: FUNCTION rpc_calls_queue_stale(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_stale_minutes integer); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_queue_stale(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_stale_minutes integer) TO anon;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_queue_stale(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_stale_minutes integer) TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_queue_stale(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_stale_minutes integer) TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_queue_stale(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_stale_minutes integer) TO postgres;


--
-- Name: FUNCTION rpc_calls_queue_stale_table(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_stale_minutes integer, p_limit integer); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_queue_stale_table(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_stale_minutes integer, p_limit integer) TO anon;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_queue_stale_table(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_stale_minutes integer, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_queue_stale_table(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_stale_minutes integer, p_limit integer) TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_queue_stale_table(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_stale_minutes integer, p_limit integer) TO postgres;


--
-- Name: FUNCTION rpc_calls_table(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_bucket text, p_limit integer, p_offset integer); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_table(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_bucket text, p_limit integer, p_offset integer) TO anon;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_table(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_bucket text, p_limit integer, p_offset integer) TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_table(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_bucket text, p_limit integer, p_offset integer) TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_table(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_bucket text, p_limit integer, p_offset integer) TO postgres;


--
-- Name: FUNCTION rpc_calls_timeseries(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_grain text); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_timeseries(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_grain text) TO anon;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_timeseries(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_grain text) TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_timeseries(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_grain text) TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_timeseries(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_grain text) TO postgres;


--
-- Name: FUNCTION rpc_calls_top_campaigns(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_limit integer); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_top_campaigns(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_limit integer) TO anon;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_top_campaigns(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_top_campaigns(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_limit integer) TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.rpc_calls_top_campaigns(p_from_pe timestamp without time zone, p_to_pe timestamp without time zone, p_campaign_id uuid, p_mode text, p_limit integer) TO postgres;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.set_updated_at() TO anon;
GRANT ALL ON FUNCTION demo_callcenter.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.set_updated_at() TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.set_updated_at() TO postgres;


--
-- Name: FUNCTION trim_call_status(); Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON FUNCTION demo_callcenter.trim_call_status() TO anon;
GRANT ALL ON FUNCTION demo_callcenter.trim_call_status() TO authenticated;
GRANT ALL ON FUNCTION demo_callcenter.trim_call_status() TO service_role;
GRANT ALL ON FUNCTION demo_callcenter.trim_call_status() TO postgres;


--
-- Name: TABLE call_analysis; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.call_analysis TO anon;
GRANT ALL ON TABLE demo_callcenter.call_analysis TO authenticated;
GRANT ALL ON TABLE demo_callcenter.call_analysis TO service_role;
GRANT SELECT ON TABLE demo_callcenter.call_analysis TO postgres;


--
-- Name: TABLE call_human_messages; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.call_human_messages TO anon;
GRANT ALL ON TABLE demo_callcenter.call_human_messages TO authenticated;
GRANT ALL ON TABLE demo_callcenter.call_human_messages TO service_role;
GRANT SELECT ON TABLE demo_callcenter.call_human_messages TO postgres;


--
-- Name: TABLE call_messages; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.call_messages TO anon;
GRANT ALL ON TABLE demo_callcenter.call_messages TO authenticated;
GRANT ALL ON TABLE demo_callcenter.call_messages TO service_role;
GRANT SELECT ON TABLE demo_callcenter.call_messages TO postgres;


--
-- Name: TABLE calls; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.calls TO anon;
GRANT ALL ON TABLE demo_callcenter.calls TO authenticated;
GRANT ALL ON TABLE demo_callcenter.calls TO service_role;
GRANT SELECT ON TABLE demo_callcenter.calls TO postgres;


--
-- Name: TABLE calls_handoff_queue; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.calls_handoff_queue TO anon;
GRANT ALL ON TABLE demo_callcenter.calls_handoff_queue TO authenticated;
GRANT ALL ON TABLE demo_callcenter.calls_handoff_queue TO service_role;
GRANT SELECT ON TABLE demo_callcenter.calls_handoff_queue TO postgres;


--
-- Name: TABLE campaign_products; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.campaign_products TO anon;
GRANT ALL ON TABLE demo_callcenter.campaign_products TO authenticated;
GRANT ALL ON TABLE demo_callcenter.campaign_products TO service_role;
GRANT SELECT ON TABLE demo_callcenter.campaign_products TO postgres;


--
-- Name: TABLE campaigns; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.campaigns TO postgres;
GRANT ALL ON TABLE demo_callcenter.campaigns TO anon;
GRANT ALL ON TABLE demo_callcenter.campaigns TO authenticated;
GRANT ALL ON TABLE demo_callcenter.campaigns TO service_role;


--
-- Name: TABLE leads; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.leads TO anon;
GRANT ALL ON TABLE demo_callcenter.leads TO authenticated;
GRANT ALL ON TABLE demo_callcenter.leads TO service_role;
GRANT SELECT ON TABLE demo_callcenter.leads TO postgres;


--
-- Name: TABLE notifications_log; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.notifications_log TO anon;
GRANT ALL ON TABLE demo_callcenter.notifications_log TO authenticated;
GRANT ALL ON TABLE demo_callcenter.notifications_log TO service_role;
GRANT SELECT ON TABLE demo_callcenter.notifications_log TO postgres;


--
-- Name: TABLE recordings; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.recordings TO anon;
GRANT ALL ON TABLE demo_callcenter.recordings TO authenticated;
GRANT ALL ON TABLE demo_callcenter.recordings TO service_role;
GRANT SELECT ON TABLE demo_callcenter.recordings TO postgres;


--
-- Name: TABLE v_call_customer_chat; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.v_call_customer_chat TO anon;
GRANT ALL ON TABLE demo_callcenter.v_call_customer_chat TO authenticated;
GRANT ALL ON TABLE demo_callcenter.v_call_customer_chat TO service_role;
GRANT SELECT ON TABLE demo_callcenter.v_call_customer_chat TO postgres;


--
-- Name: TABLE v_calls_audit; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.v_calls_audit TO anon;
GRANT ALL ON TABLE demo_callcenter.v_calls_audit TO authenticated;
GRANT ALL ON TABLE demo_callcenter.v_calls_audit TO service_role;
GRANT SELECT ON TABLE demo_callcenter.v_calls_audit TO postgres;


--
-- Name: TABLE v_calls_outbound_dashboard; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.v_calls_outbound_dashboard TO anon;
GRANT ALL ON TABLE demo_callcenter.v_calls_outbound_dashboard TO authenticated;
GRANT ALL ON TABLE demo_callcenter.v_calls_outbound_dashboard TO service_role;
GRANT SELECT ON TABLE demo_callcenter.v_calls_outbound_dashboard TO postgres;


--
-- Name: TABLE v_calls_outbound_dashboard_v2; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.v_calls_outbound_dashboard_v2 TO anon;
GRANT ALL ON TABLE demo_callcenter.v_calls_outbound_dashboard_v2 TO authenticated;
GRANT ALL ON TABLE demo_callcenter.v_calls_outbound_dashboard_v2 TO service_role;
GRANT SELECT ON TABLE demo_callcenter.v_calls_outbound_dashboard_v2 TO postgres;


--
-- Name: TABLE v_calls_outbound_dashboard_final; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.v_calls_outbound_dashboard_final TO anon;
GRANT ALL ON TABLE demo_callcenter.v_calls_outbound_dashboard_final TO authenticated;
GRANT ALL ON TABLE demo_callcenter.v_calls_outbound_dashboard_final TO service_role;
GRANT SELECT ON TABLE demo_callcenter.v_calls_outbound_dashboard_final TO postgres;


--
-- Name: TABLE v_campaign_stats; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.v_campaign_stats TO anon;
GRANT ALL ON TABLE demo_callcenter.v_campaign_stats TO authenticated;
GRANT ALL ON TABLE demo_callcenter.v_campaign_stats TO service_role;
GRANT SELECT ON TABLE demo_callcenter.v_campaign_stats TO postgres;


--
-- Name: TABLE v_inbox_messages; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.v_inbox_messages TO anon;
GRANT ALL ON TABLE demo_callcenter.v_inbox_messages TO authenticated;
GRANT ALL ON TABLE demo_callcenter.v_inbox_messages TO service_role;
GRANT SELECT ON TABLE demo_callcenter.v_inbox_messages TO postgres;


--
-- Name: TABLE v_inbox_threads; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.v_inbox_threads TO anon;
GRANT ALL ON TABLE demo_callcenter.v_inbox_threads TO authenticated;
GRANT ALL ON TABLE demo_callcenter.v_inbox_threads TO service_role;
GRANT SELECT ON TABLE demo_callcenter.v_inbox_threads TO postgres;


--
-- Name: TABLE v_lead_duplicates; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.v_lead_duplicates TO anon;
GRANT ALL ON TABLE demo_callcenter.v_lead_duplicates TO authenticated;
GRANT ALL ON TABLE demo_callcenter.v_lead_duplicates TO service_role;
GRANT SELECT ON TABLE demo_callcenter.v_lead_duplicates TO postgres;


--
-- Name: TABLE v_leads_with_campaign; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.v_leads_with_campaign TO anon;
GRANT ALL ON TABLE demo_callcenter.v_leads_with_campaign TO authenticated;
GRANT ALL ON TABLE demo_callcenter.v_leads_with_campaign TO service_role;
GRANT SELECT ON TABLE demo_callcenter.v_leads_with_campaign TO postgres;


--
-- Name: TABLE v_leads_wow_queue; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.v_leads_wow_queue TO anon;
GRANT ALL ON TABLE demo_callcenter.v_leads_wow_queue TO authenticated;
GRANT ALL ON TABLE demo_callcenter.v_leads_wow_queue TO service_role;
GRANT SELECT ON TABLE demo_callcenter.v_leads_wow_queue TO postgres;


--
-- Name: TABLE v_outbound_calls; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.v_outbound_calls TO anon;
GRANT ALL ON TABLE demo_callcenter.v_outbound_calls TO authenticated;
GRANT ALL ON TABLE demo_callcenter.v_outbound_calls TO service_role;
GRANT SELECT ON TABLE demo_callcenter.v_outbound_calls TO postgres;


--
-- Name: TABLE v_outbound_calls_agg; Type: ACL; Schema: demo_callcenter; Owner: supabase_admin
--

GRANT ALL ON TABLE demo_callcenter.v_outbound_calls_agg TO anon;
GRANT ALL ON TABLE demo_callcenter.v_outbound_calls_agg TO authenticated;
GRANT ALL ON TABLE demo_callcenter.v_outbound_calls_agg TO service_role;
GRANT SELECT ON TABLE demo_callcenter.v_outbound_calls_agg TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: demo_callcenter; Owner: anon
--

ALTER DEFAULT PRIVILEGES FOR ROLE anon IN SCHEMA demo_callcenter GRANT SELECT,USAGE ON SEQUENCES  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: demo_callcenter; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA demo_callcenter GRANT SELECT,USAGE ON SEQUENCES  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA demo_callcenter GRANT SELECT,USAGE ON SEQUENCES  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA demo_callcenter GRANT ALL ON SEQUENCES  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA demo_callcenter GRANT ALL ON SEQUENCES  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA demo_callcenter GRANT ALL ON SEQUENCES  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA demo_callcenter GRANT ALL ON FUNCTIONS  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA demo_callcenter GRANT ALL ON FUNCTIONS  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA demo_callcenter GRANT ALL ON FUNCTIONS  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA demo_callcenter GRANT ALL ON FUNCTIONS  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: demo_callcenter; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA demo_callcenter GRANT SELECT ON TABLES  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA demo_callcenter GRANT ALL ON TABLES  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA demo_callcenter GRANT ALL ON TABLES  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA demo_callcenter GRANT ALL ON TABLES  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: demo_callcenter; Owner: anon
--

ALTER DEFAULT PRIVILEGES FOR ROLE anon IN SCHEMA demo_callcenter GRANT SELECT,INSERT,UPDATE ON TABLES  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE anon IN SCHEMA demo_callcenter GRANT SELECT,INSERT,UPDATE ON TABLES  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE anon IN SCHEMA demo_callcenter GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: demo_callcenter; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA demo_callcenter GRANT SELECT ON TABLES  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA demo_callcenter GRANT SELECT ON TABLES  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA demo_callcenter GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES  TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA demo_callcenter GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES  TO n8n;


--
-- PostgreSQL database dump complete
--

