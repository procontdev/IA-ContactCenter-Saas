# Smoke - Executive Demo Dashboard / Investor View MVP

## Objetivo
Validar que la vista ejecutiva `/leads/executive` entrega una lectura rápida y comercial, tenant-safe y role-safe, reutilizando métricas existentes.

## Precondiciones
- Entorno `eventprolabs` activo.
- Usuario autenticado con tenant resuelto.
- Seed demo cargado (`DEMOSEED_` en campañas/leads).
- App web corriendo (`pnpm --filter dashboard dev`).

## Ruta principal
1. Abrir `/leads/executive`.
2. Verificar que carga sin error para rol `supervisor`, `tenant_admin` o `superadmin`.
3. Cambiar filtro de campaña y confirmar refresco de KPIs/ranking.

## Verificaciones funcionales
1. **KPIs ejecutivos visibles**
   - Volumen total
   - Atención (%)
   - Cierre (%)
   - Takeover activo
   - SLA vencido
   - Escalación (y due soon)

2. **Funnel ejecutivo**
   - Barras para: Nuevos, Atendidos, En gestión, Cerrados.
   - Porcentaje calculado contra total.

3. **Ranking por campaña**
   - Tabla Top 5 campañas.
   - Columnas mínimas: Leads, Atención, Cierre, Riesgo.

4. **Alertas/riesgo**
   - Badge de nivel de riesgo (controlado/medio/alto).
   - Alertas visibles cuando haya overdue, escalados o sin owner.
   - Fallback “Sin alertas críticas activas” cuando aplique.

5. **Continuidad de navegación**
   - Links activos a Demo Launcher, Commercial Insights y Manager View.
   - Acceso desde sidebar y desde Demo Launcher.

## Guardrails de seguridad
1. Ingresar con rol `agent` y abrir `/leads/executive`.
2. Resultado esperado: mensaje de acceso restringido (sin datos ejecutivos).
3. Confirmar que el filtro y resultados cambian por tenant activo (tenant-safe).

## Criterio de aprobación
- La vista permite explicar valor en menos de 1 minuto con datos coherentes.
- No requiere BI adicional ni warehouse.
- No rompe rutas existentes (`/leads/manager`, `/leads/commercial`, `/demo`).
