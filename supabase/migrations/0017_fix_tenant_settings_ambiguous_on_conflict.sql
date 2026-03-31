-- Migration: 0017_fix_tenant_settings_ambiguous_on_conflict
-- Description: Corrige ambigüedad de tenant_id en ON CONFLICT dentro de funciones de tenant settings.

CREATE OR REPLACE FUNCTION platform_core.get_active_tenant_settings()
RETURNS TABLE (
    tenant_id UUID,
    name TEXT,
    slug TEXT,
    metadata JSONB,
    settings JSONB,
    timezone TEXT,
    locale TEXT,
    branding JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform_core, auth, public
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_caller_role TEXT;
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

    INSERT INTO platform_core.tenant_settings (tenant_id, settings, limits)
    VALUES (v_tenant_id, '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT ON CONSTRAINT tenant_settings_pkey DO NOTHING;

    RETURN QUERY
    SELECT
        t.id,
        t.name,
        t.slug,
        coalesce(t.metadata, '{}'::jsonb),
        coalesce(ts.settings, '{}'::jsonb),
        nullif(btrim(coalesce(ts.settings ->> 'timezone', '')), '') AS timezone,
        nullif(btrim(coalesce(ts.settings ->> 'locale', '')), '') AS locale,
        CASE
            WHEN jsonb_typeof(ts.settings -> 'branding') = 'object' THEN ts.settings -> 'branding'
            ELSE '{}'::jsonb
        END AS branding
    FROM platform_core.tenants t
    LEFT JOIN platform_core.tenant_settings ts ON ts.tenant_id = t.id
    WHERE t.id = v_tenant_id
    LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION platform_core.update_active_tenant_settings(
    p_name TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT NULL,
    p_timezone TEXT DEFAULT NULL,
    p_locale TEXT DEFAULT NULL,
    p_branding JSONB DEFAULT NULL,
    p_settings_patch JSONB DEFAULT NULL
)
RETURNS TABLE (
    tenant_id UUID,
    name TEXT,
    slug TEXT,
    metadata JSONB,
    settings JSONB,
    timezone TEXT,
    locale TEXT,
    branding JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform_core, auth, public
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_caller_role TEXT;
    v_name TEXT;
    v_timezone TEXT;
    v_locale TEXT;
    v_settings JSONB;
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

    INSERT INTO platform_core.tenant_settings (tenant_id, settings, limits)
    VALUES (v_tenant_id, '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT ON CONSTRAINT tenant_settings_pkey DO NOTHING;

    IF p_name IS NOT NULL THEN
        v_name := btrim(p_name);
        IF v_name = '' THEN
            RAISE EXCEPTION 'name cannot be empty';
        END IF;

        UPDATE platform_core.tenants t
        SET name = v_name,
            updated_at = now()
        WHERE t.id = v_tenant_id;
    END IF;

    IF p_metadata IS NOT NULL THEN
        IF jsonb_typeof(p_metadata) <> 'object' THEN
            RAISE EXCEPTION 'metadata must be a JSON object';
        END IF;

        UPDATE platform_core.tenants t
        SET metadata = coalesce(t.metadata, '{}'::jsonb) || p_metadata,
            updated_at = now()
        WHERE t.id = v_tenant_id;
    END IF;

    SELECT coalesce(ts.settings, '{}'::jsonb)
    INTO v_settings
    FROM platform_core.tenant_settings ts
    WHERE ts.tenant_id = v_tenant_id
    LIMIT 1;

    IF p_timezone IS NOT NULL THEN
        v_timezone := btrim(p_timezone);
        IF v_timezone = '' THEN
            v_settings := v_settings - 'timezone';
        ELSE
            v_settings := jsonb_set(v_settings, '{timezone}', to_jsonb(v_timezone), true);
        END IF;
    END IF;

    IF p_locale IS NOT NULL THEN
        v_locale := btrim(p_locale);
        IF v_locale = '' THEN
            v_settings := v_settings - 'locale';
        ELSE
            v_settings := jsonb_set(v_settings, '{locale}', to_jsonb(v_locale), true);
        END IF;
    END IF;

    IF p_branding IS NOT NULL THEN
        IF jsonb_typeof(p_branding) <> 'object' THEN
            RAISE EXCEPTION 'branding must be a JSON object';
        END IF;
        v_settings := jsonb_set(v_settings, '{branding}', p_branding, true);
    END IF;

    IF p_settings_patch IS NOT NULL THEN
        IF jsonb_typeof(p_settings_patch) <> 'object' THEN
            RAISE EXCEPTION 'settings patch must be a JSON object';
        END IF;
        v_settings := v_settings || p_settings_patch;
    END IF;

    UPDATE platform_core.tenant_settings ts
    SET settings = v_settings,
        updated_at = now()
    WHERE ts.tenant_id = v_tenant_id;

    RETURN QUERY
    SELECT
        t.id,
        t.name,
        t.slug,
        coalesce(t.metadata, '{}'::jsonb),
        coalesce(ts.settings, '{}'::jsonb),
        nullif(btrim(coalesce(ts.settings ->> 'timezone', '')), '') AS timezone,
        nullif(btrim(coalesce(ts.settings ->> 'locale', '')), '') AS locale,
        CASE
            WHEN jsonb_typeof(ts.settings -> 'branding') = 'object' THEN ts.settings -> 'branding'
            ELSE '{}'::jsonb
        END AS branding
    FROM platform_core.tenants t
    LEFT JOIN platform_core.tenant_settings ts ON ts.tenant_id = t.id
    WHERE t.id = v_tenant_id
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION platform_core.get_active_tenant_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_core.update_active_tenant_settings(TEXT, JSONB, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION platform_core.get_active_tenant_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION platform_core.update_active_tenant_settings(TEXT, JSONB, TEXT, TEXT, JSONB, JSONB) TO authenticated;

GRANT EXECUTE ON FUNCTION platform_core.get_active_tenant_settings() TO service_role;
GRANT EXECUTE ON FUNCTION platform_core.update_active_tenant_settings(TEXT, JSONB, TEXT, TEXT, JSONB, JSONB) TO service_role;

