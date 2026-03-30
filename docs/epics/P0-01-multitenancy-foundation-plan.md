# Épica: P0-01 — Multitenancy Foundation
## Análisis del Estado Actual y Plan de Implementación

### 1. Análisis Técnico del Estado Actual Real

Tras inspeccionar el repositorio `IA-ContactCenter-Saas` y el archivo `apps/web/database/schema/demo_callcenter_schema.sql`, se identifican los siguientes puntos clave:

- **Esquema Legado:** `demo_callcenter` centraliza toda la lógica operativa actual (leads, campañas, llamadas, métricas).
- **Entidades Core:** Las tablas base son `campaigns`, `leads` y `calls`, con relaciones fuertes (`campaign_id`, `lead_id`).
- **Lógica de Negocio en DB:** Existen múltiples funciones PL/pgSQL (`recompute_lead_wow`, `rpc_calls_table`, etc.) y vistas críticas para los dashboards.
- **Sin Aislamiento:** No existe actualmente ninguna columna `tenant_id` ni el concepto de organización/tenant en el esquema.
- **Vistas Dependientes:** Se han identificado >10 vistas que agregan datos de múltiples tablas y que son la fuente de verdad del frontend actual.

### 2. Mapeo Conceptual vs. Real

| Concepto Backlog | Entidad Real MVP | Estado |
| :--- | :--- | :--- |
| `conversations` | `demo_callcenter.calls` | Mapeado |
| `conversation_messages` | `demo_callcenter.call_messages` | Mapeado |
| `audit_logs` | `demo_callcenter.notifications_log` | Mapeado |
| `channels` | N/A | Pendiente (Documentar) |
| `ai_agents` | N/A | Pendiente (Documentar) |
| `tenants` | N/A | **A crear en esta épica** |

### 3. Propuesta Incremental de Implementación

Para cumplir con la regla de **Peligro de Regresión Mínimo**, se seguirá este flujo:

1. **Infraestructura de Esquemas:** Crear los esquemas de dominio (`platform_core`, `saas_control`, etc.) para sentar las bases futuras.
2. **Modelo de Identidad Multitenant:** Implementar `tenants` y `tenant_users` en `platform_core`.
3. **Expansión de Datos (Legado):** Inyectar `tenant_id` (nullable) en las 9 tablas core del MVP.
4. **Normalización y Backfill:** Crear un `Default Tenant`, asignar todos los datos actuales a él, y asegurar que los nuevos registros también lo tengan.
5. **Endurecimiento Capa DB:** Aplicar `NOT NULL` y `FOREIGN KEY` una vez validado el backfill.
6. **Adaptación de Vistas:** Modificar las vistas críticas para que incluyan `tenant_id` sin romper su estructura de columnas actual.
7. **Capa de Abstracción en Aplicación:** Implementar resolvers de tenant en `apps/web/lib` para filtrar consultas.

### 4. Riesgos y Mitigación

| Riesgo | Impacto | Mitigación |
| :--- | :--- | :--- |
| **Rotura de Vistas** | Alto | No cambiar nombres de columnas existentes; solo agregar `tenant_id` al final. |
| **Falla en Backfill** | Medio | Realizar el backfill antes de aplicar el constraint `NOT NULL`. |
| **Data Leakage** | Alto | Implementar un `tenant-resolver` robusto en el middleware o capa de servicio. |
| **Performance** | Bajo/Medio | Añadir índices compuestos `(tenant_id, id)` y `(tenant_id, [parent_id])` en tablas grandes. |

### 5. Estrategia de Compatibilidad

- **Superadmin Bypass:** Los usuarios con rol `superadmin` podrán ver datos de todos los tenants inyectando `IS NULL` o saltando el filtro en la capa de aplicación.
- **Esquema demo_callcenter:** Se mantiene como el esquema principal de datos por ahora, pero sus tablas se vuelven "Tenant Aware".

---

## Roadmap de Entregables P0-01

- [ ] `supabase/migrations/0001_create_component_schemas.sql`
- [ ] `supabase/migrations/0002_platform_core_multitenancy.sql`
- [ ] `supabase/migrations/0003_add_tenant_id_to_legacy_mvp.sql`
- [ ] `supabase/migrations/0004_add_legacy_tenant_fks_and_indexes.sql`
- [ ] `supabase/migrations/0005_seed_default_tenant_and_backfill.sql`
- [ ] `supabase/migrations/0006_harden_tenant_constraints.sql`
- [ ] **Application Helpers** en `apps/web/lib/*`
