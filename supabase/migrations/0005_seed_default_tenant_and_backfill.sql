-- Migration: 0005_seed_default_tenant_and_backfill
-- Description: Create a default tenant and assign all legacy data to it.

DO $$
DECLARE
    v_default_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    -- 1. Ensure Default Tenant exists
    INSERT INTO platform_core.tenants (id, name, slug)
    VALUES (v_default_tenant_id, 'Default Tenant / Initial Migration', 'default-tenant')
    ON CONFLICT (id) DO NOTHING;

    -- 2. Backfill Legacy Tables
    UPDATE contact_center.campaigns SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
    UPDATE contact_center.leads SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
    UPDATE contact_center.calls SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
    UPDATE contact_center.call_messages SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
    UPDATE contact_center.call_human_messages SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
    UPDATE contact_center.call_analysis SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
    UPDATE contact_center.campaign_products SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
    UPDATE contact_center.notifications_log SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
    UPDATE contact_center.recordings SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;

    RAISE NOTICE 'Seed and Backfill completed for Tenant: %', v_default_tenant_id;
END $$;
