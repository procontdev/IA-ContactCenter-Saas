-- Migration: 0015_fix_member_management_email_type
-- Description: Hotfix para casteo explícito de auth.users.email (varchar) a TEXT en funciones de member management.

CREATE OR REPLACE FUNCTION platform_core.list_active_tenant_members()
RETURNS TABLE (
    tenant_id UUID,
    user_id UUID,
    email TEXT,
    role TEXT,
    is_primary BOOLEAN,
    joined_at TIMESTAMPTZ,
    invited_at TIMESTAMPTZ
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

    RETURN QUERY
    SELECT
        tu.tenant_id,
        tu.user_id,
        au.email::text,
        tu.role,
        tu.is_primary,
        tu.joined_at,
        tu.invited_at
    FROM platform_core.tenant_users AS tu
    LEFT JOIN auth.users AS au ON au.id = tu.user_id
    WHERE tu.tenant_id = v_tenant_id
    ORDER BY
        CASE tu.role
            WHEN 'tenant_admin' THEN 0
            WHEN 'supervisor' THEN 1
            WHEN 'agent' THEN 2
            ELSE 3
        END,
        lower(coalesce(au.email, '')) ASC,
        tu.joined_at ASC NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION platform_core.add_member_to_active_tenant(
    p_email TEXT,
    p_role TEXT DEFAULT 'agent'
)
RETURNS TABLE (
    tenant_id UUID,
    user_id UUID,
    email TEXT,
    role TEXT,
    is_primary BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform_core, auth, public
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_caller_role TEXT;
    v_email TEXT;
    v_target_user_id UUID;
    v_role TEXT;
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

    v_email := lower(btrim(coalesce(p_email, '')));
    v_role := lower(btrim(coalesce(p_role, 'agent')));

    IF v_email = '' THEN
        RAISE EXCEPTION 'p_email is required';
    END IF;

    IF v_role NOT IN ('tenant_admin', 'supervisor', 'agent') THEN
        RAISE EXCEPTION 'Invalid role. Allowed: tenant_admin, supervisor, agent';
    END IF;

    SELECT au.id
    INTO v_target_user_id
    FROM auth.users AS au
    WHERE lower(coalesce(au.email, '')) = v_email
    LIMIT 1;

    IF v_target_user_id IS NULL THEN
        RAISE EXCEPTION 'User not found by email';
    END IF;

    INSERT INTO platform_core.tenant_users (tenant_id, user_id, role, is_primary, invited_at, joined_at)
    VALUES (v_tenant_id, v_target_user_id, v_role, false, now(), now())
    ON CONFLICT ON CONSTRAINT tenant_users_tenant_id_user_id_key
    DO UPDATE SET
        role = EXCLUDED.role,
        updated_at = now();

    RETURN QUERY
    SELECT
        tu.tenant_id,
        tu.user_id,
        au.email::text,
        tu.role,
        tu.is_primary
    FROM platform_core.tenant_users AS tu
    LEFT JOIN auth.users AS au ON au.id = tu.user_id
    WHERE tu.tenant_id = v_tenant_id
      AND tu.user_id = v_target_user_id
    LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION platform_core.update_active_tenant_member_role(
    p_user_id UUID,
    p_role TEXT
)
RETURNS TABLE (
    tenant_id UUID,
    user_id UUID,
    email TEXT,
    role TEXT,
    is_primary BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform_core, auth, public
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_caller_role TEXT;
    v_role TEXT;
    v_old_role TEXT;
    v_admin_count INTEGER;
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

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'p_user_id is required';
    END IF;

    v_role := lower(btrim(coalesce(p_role, '')));
    IF v_role NOT IN ('tenant_admin', 'supervisor', 'agent') THEN
        RAISE EXCEPTION 'Invalid role. Allowed: tenant_admin, supervisor, agent';
    END IF;

    SELECT tu.role
    INTO v_old_role
    FROM platform_core.tenant_users AS tu
    WHERE tu.tenant_id = v_tenant_id
      AND tu.user_id = p_user_id
    LIMIT 1;

    IF v_old_role IS NULL THEN
        RAISE EXCEPTION 'Member not found in active tenant';
    END IF;

    IF p_user_id = v_user_id AND v_role <> 'tenant_admin' THEN
        RAISE EXCEPTION 'Cannot demote your own admin role';
    END IF;

    IF v_old_role = 'tenant_admin' AND v_role <> 'tenant_admin' THEN
        SELECT count(*)
        INTO v_admin_count
        FROM platform_core.tenant_users AS tu
        WHERE tu.tenant_id = v_tenant_id
          AND tu.role = 'tenant_admin';

        IF coalesce(v_admin_count, 0) <= 1 THEN
            RAISE EXCEPTION 'At least one tenant_admin must remain';
        END IF;
    END IF;

    UPDATE platform_core.tenant_users AS tu
    SET role = v_role,
        updated_at = now()
    WHERE tu.tenant_id = v_tenant_id
      AND tu.user_id = p_user_id;

    RETURN QUERY
    SELECT
        tu.tenant_id,
        tu.user_id,
        au.email::text,
        tu.role,
        tu.is_primary
    FROM platform_core.tenant_users AS tu
    LEFT JOIN auth.users AS au ON au.id = tu.user_id
    WHERE tu.tenant_id = v_tenant_id
      AND tu.user_id = p_user_id
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION platform_core.list_active_tenant_members() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_core.add_member_to_active_tenant(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_core.update_active_tenant_member_role(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION platform_core.list_active_tenant_members() TO authenticated;
GRANT EXECUTE ON FUNCTION platform_core.add_member_to_active_tenant(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION platform_core.update_active_tenant_member_role(UUID, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION platform_core.list_active_tenant_members() TO service_role;
GRANT EXECUTE ON FUNCTION platform_core.add_member_to_active_tenant(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION platform_core.update_active_tenant_member_role(UUID, TEXT) TO service_role;

