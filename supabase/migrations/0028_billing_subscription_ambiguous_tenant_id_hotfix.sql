-- Migration: 0028_billing_subscription_ambiguous_tenant_id_hotfix
-- Description: corrige ambigüedad 42702 por uso de ON CONFLICT (tenant_id)
--              en funciones RETURNS TABLE con variable de salida tenant_id.

CREATE OR REPLACE FUNCTION platform_core.get_active_tenant_subscription()
RETURNS TABLE (
    tenant_id UUID,
    plan_code TEXT,
    status TEXT,
    trial_ends_at TIMESTAMPTZ,
    current_period_ends_at TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN,
    canceled_at TIMESTAMPTZ,
    past_due_since TIMESTAMPTZ,
    suspended_at TIMESTAMPTZ,
    provider TEXT,
    provider_ref TEXT,
    metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform_core, saas_control, auth, public
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_plan_code TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT ctx.tenant_id
    INTO v_tenant_id
    FROM platform_core.resolve_my_tenant_context() AS ctx
    LIMIT 1;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'No active tenant context';
    END IF;

    SELECT
        CASE
            WHEN lower(btrim(coalesce(ts.settings ->> 'plan_code', ''))) IN ('basic', 'pro', 'enterprise')
                THEN lower(btrim(ts.settings ->> 'plan_code'))
            ELSE 'pro'
        END
    INTO v_plan_code
    FROM platform_core.tenant_settings AS ts
    WHERE ts.tenant_id = v_tenant_id
    LIMIT 1;

    IF v_plan_code IS NULL THEN
        v_plan_code := 'pro';
    END IF;

    BEGIN
        INSERT INTO saas_control.tenant_subscriptions (
            tenant_id,
            plan_code,
            status,
            trial_ends_at,
            current_period_ends_at,
            metadata
        )
        VALUES (
            v_tenant_id,
            v_plan_code,
            'trial',
            now() + interval '14 days',
            now() + interval '1 month',
            jsonb_build_object('created_by', 'get_active_tenant_subscription')
        );
    EXCEPTION
        WHEN unique_violation THEN
            NULL;
    END;

    RETURN QUERY
    SELECT
        s.tenant_id,
        s.plan_code,
        s.status,
        s.trial_ends_at,
        s.current_period_ends_at,
        s.cancel_at_period_end,
        s.canceled_at,
        s.past_due_since,
        s.suspended_at,
        s.provider,
        s.provider_ref,
        coalesce(s.metadata, '{}'::jsonb)
    FROM saas_control.tenant_subscriptions AS s
    WHERE s.tenant_id = v_tenant_id
    LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION platform_core.update_active_tenant_subscription(
    p_status TEXT DEFAULT NULL,
    p_plan_code TEXT DEFAULT NULL,
    p_trial_ends_at TIMESTAMPTZ DEFAULT NULL,
    p_current_period_ends_at TIMESTAMPTZ DEFAULT NULL,
    p_cancel_at_period_end BOOLEAN DEFAULT NULL,
    p_metadata_patch JSONB DEFAULT NULL
)
RETURNS TABLE (
    tenant_id UUID,
    plan_code TEXT,
    status TEXT,
    trial_ends_at TIMESTAMPTZ,
    current_period_ends_at TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN,
    canceled_at TIMESTAMPTZ,
    past_due_since TIMESTAMPTZ,
    suspended_at TIMESTAMPTZ,
    provider TEXT,
    provider_ref TEXT,
    metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform_core, saas_control, auth, public
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_caller_role TEXT;
    v_status TEXT;
    v_plan_code TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT ctx.tenant_id, ctx.role
    INTO v_tenant_id, v_caller_role
    FROM platform_core.resolve_my_tenant_context() AS ctx
    LIMIT 1;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'No active tenant context';
    END IF;

    IF v_caller_role NOT IN ('tenant_admin', 'superadmin') THEN
        RAISE EXCEPTION 'Forbidden: tenant_admin required';
    END IF;

    v_status := NULLIF(lower(btrim(coalesce(p_status, ''))), '');
    IF v_status IS NOT NULL AND v_status NOT IN ('trial', 'active', 'past_due', 'suspended', 'canceled') THEN
        RAISE EXCEPTION 'Invalid subscription status. Allowed: trial, active, past_due, suspended, canceled';
    END IF;

    v_plan_code := NULLIF(lower(btrim(coalesce(p_plan_code, ''))), '');
    IF v_plan_code IS NOT NULL AND v_plan_code NOT IN ('basic', 'pro', 'enterprise') THEN
        RAISE EXCEPTION 'Invalid plan code. Allowed: basic, pro, enterprise';
    END IF;

    BEGIN
        INSERT INTO saas_control.tenant_subscriptions (
            tenant_id,
            plan_code,
            status,
            trial_ends_at,
            current_period_ends_at,
            metadata
        )
        VALUES (
            v_tenant_id,
            coalesce(v_plan_code, 'pro'),
            coalesce(v_status, 'trial'),
            now() + interval '14 days',
            now() + interval '1 month',
            '{}'::jsonb
        );
    EXCEPTION
        WHEN unique_violation THEN
            NULL;
    END;

    UPDATE saas_control.tenant_subscriptions AS s
    SET
        plan_code = coalesce(v_plan_code, s.plan_code),
        status = coalesce(v_status, s.status),
        trial_ends_at = coalesce(p_trial_ends_at, s.trial_ends_at),
        current_period_ends_at = coalesce(p_current_period_ends_at, s.current_period_ends_at),
        cancel_at_period_end = coalesce(p_cancel_at_period_end, s.cancel_at_period_end),
        canceled_at = CASE
            WHEN coalesce(v_status, s.status) = 'canceled' THEN coalesce(s.canceled_at, now())
            WHEN v_status IN ('trial', 'active') THEN NULL
            ELSE s.canceled_at
        END,
        past_due_since = CASE
            WHEN coalesce(v_status, s.status) = 'past_due' THEN coalesce(s.past_due_since, now())
            WHEN v_status IN ('trial', 'active') THEN NULL
            ELSE s.past_due_since
        END,
        suspended_at = CASE
            WHEN coalesce(v_status, s.status) = 'suspended' THEN coalesce(s.suspended_at, now())
            WHEN v_status IN ('trial', 'active') THEN NULL
            ELSE s.suspended_at
        END,
        metadata = CASE
            WHEN p_metadata_patch IS NULL OR jsonb_typeof(p_metadata_patch) <> 'object' THEN coalesce(s.metadata, '{}'::jsonb)
            ELSE coalesce(s.metadata, '{}'::jsonb) || p_metadata_patch
        END,
        updated_at = now()
    WHERE s.tenant_id = v_tenant_id;

    IF v_plan_code IS NOT NULL THEN
        BEGIN
            INSERT INTO platform_core.tenant_settings (tenant_id, settings, limits)
            VALUES (v_tenant_id, '{}'::jsonb, '{}'::jsonb);
        EXCEPTION
            WHEN unique_violation THEN
                NULL;
        END;

        UPDATE platform_core.tenant_settings AS ts
        SET settings = jsonb_set(coalesce(ts.settings, '{}'::jsonb), '{plan_code}', to_jsonb(v_plan_code), true),
            updated_at = now()
        WHERE ts.tenant_id = v_tenant_id;
    END IF;

    RETURN QUERY
    SELECT
        s.tenant_id,
        s.plan_code,
        s.status,
        s.trial_ends_at,
        s.current_period_ends_at,
        s.cancel_at_period_end,
        s.canceled_at,
        s.past_due_since,
        s.suspended_at,
        s.provider,
        s.provider_ref,
        coalesce(s.metadata, '{}'::jsonb)
    FROM saas_control.tenant_subscriptions AS s
    WHERE s.tenant_id = v_tenant_id
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION platform_core.get_active_tenant_subscription() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_core.update_active_tenant_subscription(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION platform_core.get_active_tenant_subscription() TO authenticated;
GRANT EXECUTE ON FUNCTION platform_core.update_active_tenant_subscription(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, JSONB) TO authenticated;

GRANT EXECUTE ON FUNCTION platform_core.get_active_tenant_subscription() TO service_role;
GRANT EXECUTE ON FUNCTION platform_core.update_active_tenant_subscription(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, JSONB) TO service_role;
