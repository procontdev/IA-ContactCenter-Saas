# Notas de Migración: P0-01 Baseline - Multitenancy 기초

Este documento contiene notas técnicas y riesgos específicos para aplicar el baseline multitenancy (P0-01) sobre la base legado.

## Resumen de Cambios (SQL)

- **Creación de esquemas:** 7 nuevos esquemas administrativos y funcionales.
- **Modelado de identidad:** `tenants`, `tenant_users`.
- **Tenant-awareness:** Tabla por tabla añadida `tenant_id` en `demo_callcenter`.
- **Backfill:** Se asignó el UUID `00000000-0000-0000-0000-000000000001` como tenant por defecto para toda la historia del MVP.

## Impacto en Vistas Críticas

Se han actualizado las siguientes vistas para incluir `tenant_id` al final de sus columnas:

- `v_calls_audit`: Actualizada.
- `v_calls_outbound_dashboard`: Actualizada.
- `v_campaign_stats`: Actualizada con inyección de lógica de agregación por tenant.
- `v_inbox_threads`: Actualizada.

**Nota:** Las demás vistas (`v_leads_with_campaign`, `v_lead_duplicates`, `v_leads_wow_queue`) siguen funcionando por compatibilidad pero aún no exponen el `tenant_id`. Se deben actualizar en la fase P1 o a demanda del frontend.

## Riesgos de Ejecución

1. **Locking de Tablas:** Ejecutar la adición de `tenant_id` sobre tablas grandes (`calls`, `leads`) puede generar un breve bloqueo de escritura en BD.
2. **PostgREST Cache:** Supabase API Cache puede necesitar un refresco (`NOTIFY pgrst, 'reload schema'`) para reconocer las nuevas columnas en las tablas legadas.
3. **NOT NULL Constraint:** No aplicar la migración `0006_harden_tenant_constraints` antes de confirmar que el backfill de la migración `0005` ha terminado sin errores.

## Próximos Pasos (P1):

- Activación de Supabase RLS (Row Level Security) masiva.
- Migración física de tablas legadas de `demo_callcenter` hacia `crm` y `contact_center`.
- Implementación de Middleware de Next.js para inyectar automáticamente el `tenant_id` en las cookies de sesión.
