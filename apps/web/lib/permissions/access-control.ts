// apps/web/lib/permissions/access-control.ts
import { UserRole } from '../tenant/tenant-types';

export type Action = 'read' | 'create' | 'update' | 'delete' | 'export' | 'settings_edit';
export type Resource = 'calls' | 'leads' | 'campaigns' | 'users' | 'tenants';

const ROLE_PERMISSIONS: Record<UserRole, Partial<Record<Resource, Action[]>>> = {
  superadmin: {
    calls: ['read', 'create', 'update', 'delete', 'export'],
    leads: ['read', 'create', 'update', 'delete', 'export'],
    campaigns: ['read', 'create', 'update', 'delete', 'export'],
    users: ['read', 'create', 'update', 'delete'],
    tenants: ['read', 'create', 'update', 'delete'],
  },
  tenant_admin: {
    calls: ['read', 'create', 'update', 'export'],
    leads: ['read', 'create', 'update', 'export'],
    campaigns: ['read', 'create', 'update'],
    users: ['read', 'create', 'update'],
  },
  supervisor: {
    calls: ['read', 'update'],
    leads: ['read', 'update'],
    campaigns: ['read'],
  },
  agent: {
    calls: ['read', 'update'],
    leads: ['read'],
    campaigns: ['read'],
  },
};

/**
 * Verifica si un rol tiene permiso para realizar una acción sobre un recurso.
 */
export function canPerform(role: UserRole | null, resource: Resource, action: Action): boolean {
  if (!role) return false;
  
  const permissions = ROLE_PERMISSIONS[role][resource];
  return permissions?.includes(action) || false;
}
