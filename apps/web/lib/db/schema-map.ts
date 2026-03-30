// apps/web/lib/db/schema-map.ts

/**
 * Mapeo de dominios de negocio a esquemas físicos de base de datos.
 * Esto permite desacoplar el código de la ubicación exacta de las tablas
 * mientras se realiza la migración física posterior.
 */
export const SCHEMA_MAP = {
  CORE: 'platform_core',
  SaaS: 'saas_control',
  CRM: 'contact_center',
  CONTACT_CENTER: 'contact_center',
  AI: 'contact_center', // Aún en contact_center, pronto en 'ai'
  ANALYTICS: 'contact_center', // Aún en contact_center, pronto en 'analytics'
  AUDIT: 'contact_center', // Aún en contact_center, pronto en 'audit'
  LEGACY: 'contact_center' // Alias para compatibilidad
} as const;

export type Domain = keyof typeof SCHEMA_MAP;

/**
 * Devuelve el nombre calificado de una tabla basado en su dominio.
 */
export function getQualifiedTable(domain: Domain, table: string): string {
  return `${SCHEMA_MAP[domain]}.${table}`;
}
