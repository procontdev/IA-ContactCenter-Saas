-- Migration: 0008_bootstrap_default_tenant_and_auth_link
-- Description: Idempotent bootstrap helpers for default tenant onboarding and safe auth-user linking.

DO $$
DECLARE
    v_default_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    -- Ensure default tenant exists by fixed ID.
    INSERT INTO platform_core.tenants (id, name, slug, is_active, metadata)
    VALUES (
        v_default_tenant_id,
        'Default Tenant / Bootstrap',
        'default-tenant',
        true,
        jsonb_build_object('source', '0008_bootstrap_default_tenant_and_auth_link')
    )
    ON CONFLICT (id) DO NOTHING;

    -- Ensure settings row exists for default tenant.
    INSERT INTO platform_core.tenant_settings (tenant_id, settings, limits)
    VALUES (
        v_default_tenant_id,
        '{}'::jsonb,
        '{}'::jsonb
    )
    ON CONFLICT (tenant_id) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION platform_core.resolve_bootstrap_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform_core, public
AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Prefer slug for human-friendly bootstrap semantics.
    SELECT t.id INTO v_tenant_id
    FROM platform_core.tenants t
    WHERE t.slug = 'default-tenant'
    LIMIT 1;

    -- Fallback to fixed ID.
    IF v_tenant_id IS NULL THEN
        SELECT t.id INTO v_tenant_id
        FROM platform_core.tenants t
        WHERE t.id = '00000000-0000-0000-0000-000000000001'
        LIMIT 1;
    END IF;

    RETURN v_tenant_id;
END;
$$;

CREATE OR REPLACE FUNCTION platform_core.bootstrap_link_user_to_default_tenant(
    p_user_id UUID,
    p_role TEXT DEFAULT 'tenant_admin',
    p_make_primary BOOLEAN DEFAULT true
)
RETURNS TABLE (
    tenant_id UUID,
    user_id UUID,
    role TEXT,
    is_primary BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform_core, public
AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'p_user_id is required';
    END IF;

    IF p_role IS NULL OR p_role NOT IN ('superadmin', 'tenant_admin', 'supervisor', 'agent') THEN
        RAISE EXCEPTION 'Invalid p_role: %', p_role;
    END IF;

    v_tenant_id := platform_core.resolve_bootstrap_tenant_id();
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'No bootstrap tenant found (slug=default-tenant or fixed default UUID)';
    END IF;

    -- Optional single-primary behavior per user (keeps this tenant as primary).
    IF p_make_primary THEN
        UPDATE platform_core.tenant_users tu
        SET is_primary = false
        WHERE tu.user_id = p_user_id
          AND tu.tenant_id <> v_tenant_id
          AND tu.is_primary = true;
    END IF;

    INSERT INTO platform_core.tenant_users (tenant_id, user_id, role, is_primary)
    VALUES (v_tenant_id, p_user_id, p_role, p_make_primary)
    ON CONFLICT ON CONSTRAINT tenant_users_tenant_id_user_id_key
    DO UPDATE SET
        role = EXCLUDED.role,
        is_primary = EXCLUDED.is_primary,
        updated_at = now();

    RETURN QUERY
    SELECT
        tu.tenant_id AS tenant_id,
        tu.user_id AS user_id,
        tu.role AS role,
        tu.is_primary AS is_primary
    FROM platform_core.tenant_users tu
    WHERE tu.tenant_id = v_tenant_id
      AND tu.user_id = p_user_id
    LIMIT 1;
END;
$$;

GRANT USAGE ON SCHEMA platform_core TO service_role;
GRANT EXECUTE ON FUNCTION platform_core.resolve_bootstrap_tenant_id() TO service_role;
GRANT EXECUTE ON FUNCTION platform_core.bootstrap_link_user_to_default_tenant(UUID, TEXT, BOOLEAN) TO service_role;

