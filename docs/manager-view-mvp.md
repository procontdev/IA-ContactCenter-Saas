# Manager View MVP (Reporting operativo)

## Resumen funcional

El módulo **Manager View MVP** entrega una vista de supervisión operativa para leads, enfocada en:

- carga operativa total,
- distribución por estado de trabajo,
- ownership / takeover,
- SLA (due soon, overdue, escalado),
- listado priorizado para seguimiento diario.

Componentes principales:

- API: `GET /api/aap/leads/manager-view`
- UI: `/leads/manager`

## KPIs incluidos (alto nivel)

El endpoint calcula en runtime (sin BI persistente):

- total de leads filtrados,
- conteo por `work_status` (`queued`, `assigned`, `in_progress`, `done`),
- `with_owner` y `unassigned`,
- takeover (`taken`, `released`, `closed`, `none`),
- SLA `due_soon` (próximos 15 min), `overdue`, `escalated`.

Además, retorna:

- `alerts` booleanas para foco operativo,
- `items` priorizados por prioridad/SLA/takeover.

## Filtros disponibles

- `campaign_id` (UUID de campaña)
- `work_status` (`queued`, `assigned`, `in_progress`, `done`)

## Roles permitidos

Acceso permitido solo para:

- `supervisor`
- `tenant_admin`
- `superadmin`

Requiere:

- Bearer token,
- tenant activo,
- permiso de lectura de leads.

## Smoke del módulo

Script: `pnpm smoke:manager-view`

Precondición para validación HTTP 200:

- Definir `SMOKE_BEARER_TOKEN` con sesión real manager.

Ejemplos:

- Validar denegación sin token (espera 401):
  - `pnpm smoke:manager-view -- --expectStatus 401`
- Validar 200 con token manager:
  - `set SMOKE_BEARER_TOKEN=<JWT_MANAGER>`
  - `pnpm smoke:manager-view`
- Validar filtro campaña:
  - `pnpm smoke:manager-view -- --campaignId <CAMPAIGN_UUID>`

## Limitaciones actuales del MVP

- Métricas calculadas en runtime (sin snapshots históricos ni cubos BI).
- No incluye drill-down analítico avanzado por intervalos de tiempo.
- No reemplaza dashboard analítico; complementa operación diaria de supervisión.

## Nota de alcance (error preexistente no relacionado)

Existe un error de typecheck fuera de este bloque en `apps/web/app/leads/mgym-page.tsx` por import faltante de `./LeadsClient`.

No forma parte del módulo Manager View MVP y no fue modificado en este cierre.

