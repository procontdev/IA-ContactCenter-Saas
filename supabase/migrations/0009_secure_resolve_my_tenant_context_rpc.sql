-- Migration: 0009_secure_resolve_my_tenant_context_rpc
-- Description: Secure tenant-context resolution for authenticated users without direct table exposure.

CREATE OR REPLACE FUNCTION platform_core.resolve_my_tenant_context()
RETURNS TABLE (
    tenant_id UUID,
    role TEXT,
    is_primary BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = platform_core, auth, public
AS $$
    SELECT
        tu.tenant_id,
        tu.role,
        tu.is_primary
    FROM platform_core.tenant_users tu
    WHERE tu.user_id = auth.uid()
    ORDER BY tu.is_primary DESC, tu.joined_at ASC NULLS LAST
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION platform_core.resolve_my_tenant_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_core.resolve_my_tenant_context() TO authenticated;
GRANT EXECUTE ON FUNCTION platform_core.resolve_my_tenant_context() TO service_role;

