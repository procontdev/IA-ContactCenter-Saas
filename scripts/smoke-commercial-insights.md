# Smoke manual — Commercial funnel / conversion insights MVP

## Precondiciones
- Sesión iniciada en la app.
- Tenant activo con seed demo (`DEMOSEED_*`).
- Si hace falta regenerar dataset:
  - `pnpm seed:demo`
  - `pnpm validate:seed-demo`

## Flujo de validación
1. Abrir `http://localhost:3000/leads/commercial`.
2. Validar que la vista carga para rol `supervisor`/`tenant_admin`/`superadmin`.
3. Confirmar cards globales:
   - Leads totales
   - Atendidos
   - Cerrados
   - Takeover activo
   - Escalados / SLA vencido
   - Conversion % y Bottleneck %
4. Revisar funnel mínimo:
   - `Nuevo/En cola`
   - `Asignado`
   - `En progreso`
   - `Cerrado`
5. Revisar ranking por campaña:
   - columnas de leads, atendidos, en progreso, cerrados, conv%, escalados, SLA vencido.
6. Aplicar filtro por campaña y verificar coherencia de métricas.
7. Cambiar `work_status` y confirmar que cards/funnel/tabla responden al corte.

## Guardrails
1. Con rol `agent`, abrir `/leads/commercial` y validar mensaje de acceso restringido.
2. Cambiar tenant en switcher y volver a `/leads/commercial`:
   - el dataset debe cambiar al tenant activo,
   - no deben aparecer campañas/leads de otro tenant.

## Smoke API opcional
- 200 esperado:
  - `pnpm smoke:commercial-insights`
- 401 esperado sin token:
  - `node scripts/smoke-commercial-insights.js --expectStatus 401`

## Resultado esperado
- Vista comercial/gerencial útil para storytelling demo.
- Señal clara de avance, conversión y cuellos por campaña.
- Sin fuga cross-tenant y con guardrail por rol.
