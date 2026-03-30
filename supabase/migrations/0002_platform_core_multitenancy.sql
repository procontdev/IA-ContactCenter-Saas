-- Migration: 0002_platform_core_multitenancy
-- Description: Create the foundation for multi-tenancy in platform_core.

-- 1. Tenants table
CREATE TABLE IF NOT EXISTS platform_core.tenants (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL
);

-- 2. Tenant Users table (Join table between Auth and Tenants with Roles)
CREATE TABLE IF NOT EXISTS platform_core.tenant_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES platform_core.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL, -- References auth.users(id) in Supabase
    role TEXT NOT NULL DEFAULT 'agent',
    is_primary BOOLEAN DEFAULT false NOT NULL,
    invited_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    
    -- Roles check constraint
    CONSTRAINT tenant_users_role_check CHECK (role IN ('superadmin', 'tenant_admin', 'supervisor', 'agent')),
    -- Unique user per tenant
    UNIQUE (tenant_id, user_id)
);

-- 3. Tenant Settings table
CREATE TABLE IF NOT EXISTS platform_core.tenant_settings (
    tenant_id UUID PRIMARY KEY REFERENCES platform_core.tenants(id) ON DELETE CASCADE,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    plan_id TEXT,
    limits JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION platform_core.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_tenants_updated_at
BEFORE UPDATE ON platform_core.tenants
FOR EACH ROW EXECUTE FUNCTION platform_core.set_updated_at();

CREATE TRIGGER tr_tenant_users_updated_at
BEFORE UPDATE ON platform_core.tenant_users
FOR EACH ROW EXECUTE FUNCTION platform_core.set_updated_at();

CREATE TRIGGER tr_tenant_settings_updated_at
BEFORE UPDATE ON platform_core.tenant_settings
FOR EACH ROW EXECUTE FUNCTION platform_core.set_updated_at();

-- Documentation indices
CREATE INDEX IF NOT EXISTS idx_tenant_users_user_id ON platform_core.tenant_users(user_id);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON platform_core.tenants(slug);
