// apps/web/lib/tenant/tenant-types.ts

export type UserRole = 'superadmin' | 'tenant_admin' | 'supervisor' | 'agent';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  metadata?: Record<string, unknown>;
}

export interface TenantUser {
  id: string;
  tenant_id: string;
  user_id: string;
  role: UserRole;
  is_primary: boolean;
}

export interface TenantContext {
  tenantId: string | null;
  role: UserRole | null;
  isSuperAdmin: boolean;
}

export interface TenantMembership {
  tenant_id: string;
  name: string;
  slug: string;
  role: UserRole;
  is_primary: boolean;
  is_active: boolean;
}

export interface TenantMember {
  tenant_id: string;
  user_id: string;
  email: string | null;
  role: UserRole;
  is_primary: boolean;
  joined_at: string | null;
  invited_at: string | null;
}

export interface TenantSettings {
  tenant_id: string;
  name: string;
  slug: string;
  metadata: Record<string, unknown>;
  settings: Record<string, unknown>;
  timezone: string | null;
  locale: string | null;
  branding: Record<string, unknown>;
}
