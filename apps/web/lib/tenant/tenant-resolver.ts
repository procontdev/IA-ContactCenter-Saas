import { TenantContext, UserRole } from './tenant-types';

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Resuelve el contexto del tenant del usuario actual.
 * En esta fase inicial priorizamos:
 * 1. El tenant_id explícito en la sesión (si existe)
 * 2. Un fallback al tenant por defecto del sistema para propósitos de testing y migración.
 */
export async function resolveTenantContext(userSession?: any): Promise<TenantContext> {
  // En el futuro, aquí usaremos sbFetch para consultar platform_core.tenant_users
  // si solo tenemos el user_id.
  
  const tenantId = userSession?.tenant_id || DEFAULT_TENANT_ID;
  const role = (userSession?.role as UserRole) || 'agent';

  return {
    tenantId,
    role,
    isSuperAdmin: role === 'superadmin'
  };
}

/**
 * Helper para inyectar el filtro de tenant en las queries de Supabase PostgREST.
 * Útil cuando no se usa el helper automático de supabaseRest.
 */
export function injectTenantFilter(query: any, context: TenantContext) {
  if (context.isSuperAdmin) {
    return query; // Superadmin ve todo
  }
  
  if (!context.tenantId) {
    throw new Error('Tenant context is missing');
  }
  
  return query.eq('tenant_id', context.tenantId);
}
