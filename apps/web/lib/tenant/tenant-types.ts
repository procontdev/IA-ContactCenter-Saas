// apps/web/lib/tenant/tenant-types.ts

export type UserRole = 'superadmin' | 'tenant_admin' | 'supervisor' | 'agent';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  metadata?: Record<string, any>;
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
