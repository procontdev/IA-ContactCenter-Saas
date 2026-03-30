-- Migration: 0001_create_component_schemas
-- Description: Create all domain-specific schemas for the SaaS platform.

CREATE SCHEMA IF NOT EXISTS "platform_core";
CREATE SCHEMA IF NOT EXISTS "saas_control";
CREATE SCHEMA IF NOT EXISTS "crm";
CREATE SCHEMA IF NOT EXISTS "contact_center";
CREATE SCHEMA IF NOT EXISTS "ai";
CREATE SCHEMA IF NOT EXISTS "analytics";
CREATE SCHEMA IF NOT EXISTS "audit";

-- Grant usage (if needed by specific roles, e.g., authenticated, service_role)
GRANT USAGE ON SCHEMA "platform_core" TO authenticated, service_role;
GRANT USAGE ON SCHEMA "saas_control" TO authenticated, service_role;
GRANT USAGE ON SCHEMA "crm" TO authenticated, service_role;
GRANT USAGE ON SCHEMA "contact_center" TO authenticated, service_role;
GRANT USAGE ON SCHEMA "ai" TO authenticated, service_role;
GRANT USAGE ON SCHEMA "analytics" TO authenticated, service_role;
GRANT USAGE ON SCHEMA "audit" TO authenticated, service_role;
