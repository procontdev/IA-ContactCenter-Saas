// apps/web/lib/tenant/tenant-guard.ts
import { TenantContext } from './tenant-types';

/**
 * Bloquea el acceso cross-tenant en la capa de aplicación.
 * Útil para proteger endpoints o componentes.
 */
export function assertTenantAccess(context: TenantContext, resourceTenantId: string | null) {
  if (context.isSuperAdmin) {
    return true; // Acceso total
  }
  
  if (!context.tenantId) {
    throw new Error('Tenant context missing');
  }
  
  if (resourceTenantId && resourceTenantId !== context.tenantId) {
    throw new Error(`Unauthorized access to foreign tenant resource: ${resourceTenantId}`);
  }
  
  return true;
}

/**
 * Filtra un array de entidades para asegurar que solo pertenecen al tenant actual.
 * (Banda de seguridad complementaria al filtrado en DB)
 */
export function filterByTenant<T extends { tenant_id?: string | null }>(context: TenantContext, entities: T[]): T[] {
  if (context.isSuperAdmin) {
    return entities;
  }
  
  return entities.filter(e => e.tenant_id === context.tenantId);
}
