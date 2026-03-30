// apps/web/lib/tenant/tenant-resolver.ts
import { TenantContext, UserRole } from './tenant-types';

/**
 * Resuelve el contexto del tenant del usuario actual.
 * En esta fase inicial, esta función abstrae de dónde obtenemos el tenant_id.
 * Se espera que este ID venga de la sesión o de una cookie de administración.
 */
export async function resolveTenantContext(userSession: any): Promise<TenantContext> {
  const user_id = userSession?.user?.id;
  
  // En producción, aquí haríamos un fetch a `platform_core.tenant_users` 
  // para obtener el tenant_id activo del usuario y su rol.
  
  // Por ahora, simulamos la devolución del contexto
  return {
    tenantId: userSession?.tenant_id || null, // Se espera que la sesión lleve el tenant_id
    role: (userSession?.role as UserRole) || 'agent',
    isSuperAdmin: userSession?.role === 'superadmin'
  };
}

/**
 * Helper para inyectar el filtro de tenant en las queries de Supabase PostgREST.
 */
export function injectTenantFilter(query: any, context: TenantContext) {
  if (context.isSuperAdmin) {
    return query; // Superadmin ve todo
  }
  
  if (!context.tenantId) {
    throw new Error('Tenant context is missing for tenant-isolated request');
  }
  
  return query.eq('tenant_id', context.tenantId);
}
