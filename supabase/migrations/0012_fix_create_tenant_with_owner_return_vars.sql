-- Migration: 0012_fix_create_tenant_with_owner_return_vars
-- Description: Evita ambigüedad de nombres de salida en PL/pgSQL retornando vía variables OUT.

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

    SELECT t.id
    INTO v_tenant_id
    FROM platform_core.tenants AS t
    WHERE t.slug = v_slug
    LIMIT 1;

    IF v_tenant_id IS NULL THEN
        INSERT INTO platform_core.tenants (name, slug, is_active, metadata)
        VALUES (
            v_name,
            v_slug,
            true,
            jsonb_build_object('source', '0012_fix_create_tenant_with_owner_return_vars', 'owner_user_id', v_user_id)
        )
        RETURNING id INTO v_tenant_id;
    ELSE
        SELECT EXISTS(
            SELECT 1
            FROM platform_core.tenant_users AS tu
            WHERE tu.tenant_id = v_tenant_id
              AND tu.user_id = v_user_id
        )
        INTO v_user_has_membership;

        IF NOT v_user_has_membership THEN
            RAISE EXCEPTION 'Slug already exists';
        END IF;
    END IF;

    INSERT INTO platform_core.tenant_settings (tenant_id, settings, limits)
    VALUES (v_tenant_id, '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (tenant_id) DO NOTHING;

    UPDATE platform_core.tenant_users AS tu
    SET is_primary = false,
        updated_at = now()
    WHERE tu.user_id = v_user_id
      AND tu.tenant_id <> v_tenant_id
      AND tu.is_primary = true;

    INSERT INTO platform_core.tenant_users (tenant_id, user_id, role, is_primary)
    VALUES (v_tenant_id, v_user_id, 'tenant_admin', true)
    ON CONFLICT ON CONSTRAINT tenant_users_tenant_id_user_id_key
    DO UPDATE SET
        role = 'tenant_admin',
        is_primary = true,
        updated_at = now();

    tenant_id := v_tenant_id;
    slug := v_slug;
    role := 'tenant_admin';
    is_primary := true;

    RETURN NEXT;
END;
$$;

