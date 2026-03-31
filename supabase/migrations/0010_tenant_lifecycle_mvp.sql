-- Migration: 0010_tenant_lifecycle_mvp
-- Description: MVP real de lifecycle multitenant (create/list/switch tenant activo).

CREATE OR REPLACE FUNCTION platform_core.create_tenant_with_owner(
    p_name TEXT,
    p_slug TEXT
)
RETURNS TABLE (
    tenant_id UUID,
    slug TEXT,
    role TEXT,
    is_primary BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform_core, auth, public
AS $$
DECLARE
    v_user_id UUID;
    v_name TEXT;
    v_slug TEXT;
    v_tenant_id UUID;
    v_user_has_membership BOOLEAN := false;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_name := btrim(coalesce(p_name, ''));
    v_slug := lower(btrim(coalesce(p_slug, '')));

    IF v_name = '' THEN
        RAISE EXCEPTION 'Tenant name is required';
    END IF;

    IF v_slug = '' THEN
        RAISE EXCEPTION 'Tenant slug is required';
    END IF;

    IF v_slug !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' THEN
        RAISE EXCEPTION 'Invalid slug format. Use lowercase letters, numbers and hyphen';
    END IF;

    -- 1) Busca tenant por slug (idempotencia razonable)
    SELECT t.id INTO v_tenant_id
    FROM platform_core.tenants t
    WHERE t.slug = v_slug
    LIMIT 1;

    IF v_tenant_id IS NULL THEN
        INSERT INTO platform_core.tenants (name, slug, is_active, metadata)
        VALUES (
            v_name,
            v_slug,
            true,
            jsonb_build_object('source', '0010_tenant_lifecycle_mvp', 'owner_user_id', v_user_id)
        )
        RETURNING id INTO v_tenant_id;
    ELSE
        SELECT EXISTS(
            SELECT 1
            FROM platform_core.tenant_users tu
            WHERE tu.tenant_id = v_tenant_id
              AND tu.user_id = v_user_id
        ) INTO v_user_has_membership;

        IF NOT v_user_has_membership THEN
            RAISE EXCEPTION 'Slug already exists';
        END IF;
    END IF;

    -- 2) Asegura settings del tenant
    INSERT INTO platform_core.tenant_settings (tenant_id, settings, limits)
    VALUES (v_tenant_id, '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (tenant_id) DO NOTHING;

    -- 3) Único tenant activo por usuario
    UPDATE platform_core.tenant_users tu
    SET is_primary = false,
        updated_at = now()
    WHERE tu.user_id = v_user_id
      AND tu.tenant_id <> v_tenant_id
      AND tu.is_primary = true;

    -- 4) Membership owner/admin inicial
    INSERT INTO platform_core.tenant_users (tenant_id, user_id, role, is_primary)
    VALUES (v_tenant_id, v_user_id, 'tenant_admin', true)
    ON CONFLICT ON CONSTRAINT tenant_users_tenant_id_user_id_key
    DO UPDATE SET
        role = 'tenant_admin',
        is_primary = true,
        updated_at = now();

    RETURN QUERY
    SELECT
        tu.tenant_id,
        t.slug,
        tu.role,
        tu.is_primary
    FROM platform_core.tenant_users tu
    JOIN platform_core.tenants t ON t.id = tu.tenant_id
    WHERE tu.user_id = v_user_id
      AND tu.tenant_id = v_tenant_id
    LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION platform_core.list_my_tenants()
RETURNS TABLE (
    tenant_id UUID,
    name TEXT,
    slug TEXT,
    role TEXT,
    is_primary BOOLEAN,
    is_active BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = platform_core, auth, public
AS $$
    SELECT
        t.id AS tenant_id,
        t.name,
        t.slug,
        tu.role,
        tu.is_primary,
        t.is_active
    FROM platform_core.tenant_users tu
    JOIN platform_core.tenants t ON t.id = tu.tenant_id
    WHERE tu.user_id = auth.uid()
    ORDER BY tu.is_primary DESC, t.name ASC;
$$;

CREATE OR REPLACE FUNCTION platform_core.set_active_tenant(
    p_tenant_id UUID
)
RETURNS TABLE (
    tenant_id UUID,
    name TEXT,
    slug TEXT,
    role TEXT,
    is_primary BOOLEAN,
    is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform_core, auth, public
AS $$
DECLARE
    v_user_id UUID;
    v_allowed BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'p_tenant_id is required';
    END IF;

    SELECT EXISTS(
        SELECT 1
        FROM platform_core.tenant_users tu
        WHERE tu.user_id = v_user_id
          AND tu.tenant_id = p_tenant_id
    ) INTO v_allowed;

    IF NOT v_allowed THEN
        RAISE EXCEPTION 'Forbidden tenant scope';
    END IF;

    UPDATE platform_core.tenant_users tu
    SET is_primary = (tu.tenant_id = p_tenant_id),
        updated_at = now()
    WHERE tu.user_id = v_user_id
      AND (tu.is_primary = true OR tu.tenant_id = p_tenant_id);

    RETURN QUERY
    SELECT
        t.id AS tenant_id,
        t.name,
        t.slug,
        tu.role,
        tu.is_primary,
        t.is_active
    FROM platform_core.tenant_users tu
    JOIN platform_core.tenants t ON t.id = tu.tenant_id
    WHERE tu.user_id = v_user_id
      AND tu.tenant_id = p_tenant_id
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION platform_core.create_tenant_with_owner(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_core.list_my_tenants() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_core.set_active_tenant(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION platform_core.create_tenant_with_owner(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION platform_core.list_my_tenants() TO authenticated;
GRANT EXECUTE ON FUNCTION platform_core.set_active_tenant(UUID) TO authenticated;

GRANT EXECUTE ON FUNCTION platform_core.create_tenant_with_owner(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION platform_core.list_my_tenants() TO service_role;
GRANT EXECUTE ON FUNCTION platform_core.set_active_tenant(UUID) TO service_role;

