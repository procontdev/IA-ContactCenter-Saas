-- Migration: 0025_packaging_plans_feature_gating_mvp
-- Description: base MVP para packaging/plans/feature gating y límites por tenant (sin billing).

CREATE OR REPLACE FUNCTION platform_core.get_active_tenant_plan()
RETURNS TABLE (
    tenant_id UUID,
    plan_code TEXT,
    settings JSONB,
    limits JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform_core, auth, public
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_plan_code TEXT;
    v_settings JSONB;
    v_limits JSONB;
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

    INSERT INTO platform_core.tenant_settings (tenant_id, settings, limits)
    VALUES (v_tenant_id, '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (tenant_id) DO NOTHING;

    SELECT
        coalesce(ts.settings, '{}'::jsonb),
        coalesce(ts.limits, '{}'::jsonb)
    INTO
        v_settings,
        v_limits
    FROM platform_core.tenant_settings ts
    WHERE ts.tenant_id = v_tenant_id
    LIMIT 1;

    v_plan_code := lower(btrim(coalesce(v_settings ->> 'plan_code', 'pro')));
    IF v_plan_code NOT IN ('basic', 'pro', 'enterprise') THEN
        v_plan_code := 'pro';
    END IF;

    RETURN QUERY
    SELECT
        v_tenant_id,
        v_plan_code,
        v_settings,
        v_limits;
END;
$$;

CREATE OR REPLACE FUNCTION platform_core.update_active_tenant_plan(
    p_plan_code TEXT
)
RETURNS TABLE (
    tenant_id UUID,
    plan_code TEXT,
    settings JSONB,
    limits JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform_core, auth, public
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_caller_role TEXT;
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

    v_plan_code := lower(btrim(coalesce(p_plan_code, '')));
    IF v_plan_code NOT IN ('basic', 'pro', 'enterprise') THEN
        RAISE EXCEPTION 'Invalid plan code. Allowed: basic, pro, enterprise';
    END IF;

    INSERT INTO platform_core.tenant_settings (tenant_id, settings, limits)
    VALUES (v_tenant_id, '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (tenant_id) DO NOTHING;

    UPDATE platform_core.tenant_settings ts
    SET settings = jsonb_set(coalesce(ts.settings, '{}'::jsonb), '{plan_code}', to_jsonb(v_plan_code), true),
        updated_at = now()
    WHERE ts.tenant_id = v_tenant_id;

    RETURN QUERY
    SELECT p.tenant_id, p.plan_code, p.settings, p.limits
    FROM platform_core.get_active_tenant_plan() p;
END;
$$;

REVOKE ALL ON FUNCTION platform_core.get_active_tenant_plan() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_core.update_active_tenant_plan(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION platform_core.get_active_tenant_plan() TO authenticated;
GRANT EXECUTE ON FUNCTION platform_core.update_active_tenant_plan(TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION platform_core.get_active_tenant_plan() TO service_role;
GRANT EXECUTE ON FUNCTION platform_core.update_active_tenant_plan(TEXT) TO service_role;

