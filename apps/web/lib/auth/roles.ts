// apps/web/lib/auth/roles.ts
import { UserRole } from '../tenant/tenant-types';

export const ROLES: Record<string, UserRole> = {
  SUPERADMIN: 'superadmin',
  TENANT_ADMIN: 'tenant_admin',
  SUPERVISOR: 'supervisor',
  AGENT: 'agent',
};

export const ROLE_HIERARCHY: UserRole[] = [
  'agent',
  'supervisor',
  'tenant_admin',
  'superadmin',
];

/**
 * Checks if a user has at least a specific role level.
 */
export function hasMinimumRole(userRole: UserRole, targetRole: UserRole): boolean {
  const userIdx = ROLE_HIERARCHY.indexOf(userRole);
  const targetIdx = ROLE_HIERARCHY.indexOf(targetRole);
  return userIdx >= targetIdx;
}
