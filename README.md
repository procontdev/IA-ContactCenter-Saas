# IA-ContactCenter-Saas

Base de evolución del MVP `IA-ContactCenter-Multichannel-MVP` hacia un producto SaaS multitenant de Contact Center + CRM + IA.

## Estructura
- `apps/web`: aplicación principal heredada del MVP
- `packages/*`: módulos compartidos de dominio, aplicación, infraestructura y utilitarios
- `supabase/*`: migraciones, políticas, views y RPC
- `docs/*`: arquitectura, épicas y runbooks

## Estado actual
- Base inicial copiada desde el MVP
- Próxima épica: `P0-01 Multitenancy foundation`

## Scripts
```bash
pnpm install
pnpm dev

# Release candidate smokes (runner maestro mínimo)
pnpm preflight:release:pack-a
pnpm preflight:release:pack-ab
pnpm smoke:release:pack-a
pnpm smoke:release:pack-ab
pnpm smoke:release:ci

# Preflight standalone (opcional JSON)
node scripts/preflight-release-candidate.js --pack AB --jsonOut .tmp/preflight-release.json

# Reporte JSON opcional
node scripts/run-release-smokes.js --pack AB --jsonOut .tmp/release-smokes.json
```

## RC preflight (gate rápido previo al runner)

Script: `scripts/preflight-release-candidate.js`

- Ejecuta validaciones rápidas de prerequisitos y drift antes del runner técnico.
- Cobertura mínima:
  - reachability de `APP_BASE_URL` y Supabase,
  - variables obligatorias/recomendadas/opcionales,
  - resolución de tenants demo `basic/pro` por ID o slug,
  - validación mínima de dataset demo (reutiliza `validate-demo-seed-data`),
  - gating básico esperado,
  - drift crítico de prerequisitos por pack.
- Estado final: `PASS`, `WARN`, `FAIL`.
- Exit code: `1` solo en `FAIL` (bloquea ejecución), `0` en `PASS/WARN`.
- Soporta `--jsonOut <ruta>` para artifact/reporting.
- Soporta `--skipDataset true` para diagnóstico puntual (no recomendado para cierre RC).

## Release candidate smoke runner (Pack A + Pack B)

Runner maestro: `scripts/run-release-smokes.js`

- Soporta `--pack A` o `--pack AB`.
- Corre preflight automáticamente al inicio (gate previo).
- Se puede omitir el preflight con `--skipPreflight` (solo para diagnóstico puntual).
- Estado por smoke: `PASS`, `FAIL`, `SKIP`.
- Si falta precondición en smoke crítico, por defecto el runner marca `FAIL` (fast-fail) para evitar cierres falsamente verdes.
- Se puede desactivar ese comportamiento con `--allowCriticalSkip` (solo para diagnóstico puntual).
- Muestra duración por smoke y resumen final consolidado.
- Exit code `0` cuando no falla ningún smoke crítico.
- Exit code `1` cuando falla al menos un smoke crítico.
- Permite reporte JSON con `--jsonOut <ruta>`.
- Si faltan `SMOKE_BASIC_TENANT_ID` o `SMOKE_PRO_TENANT_ID`, intenta resolverlos por slug vía `/api/tenant/memberships`.

### Variables de entorno

El runner toma variables de `apps/web/.env.local`, `.env.antigravity.local` y `process.env`.

Variables comunes:
- `APP_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SMOKE_EMAIL`
- `SMOKE_PASSWORD`
- `SMOKE_BASIC_TENANT_ID`
- `SMOKE_PRO_TENANT_ID`
- `SMOKE_BASIC_TENANT_SLUG` (default runner: `eventprolabs-demo-b2b`)
- `SMOKE_PRO_TENANT_SLUG` (default runner: `eventprolabs-demo-ops`)
- `DEMO_ADMIN_EMAIL`
- `DEMO_ADMIN_PASSWORD`
- `SUPABASE_SERVICE_ROLE_KEY` (para smokes de onboarding/settings)

Notas:
- Los IDs de tenant tienen prioridad si están presentes.
- Si no hay IDs, el runner intenta resolverlos por slug.
- Si tampoco logra resolver precondiciones críticas, falla temprano para proteger la decisión RC.

### CI mínima (workflow_dispatch)

Workflow: `.github/workflows/release-smokes.yml`

- Inputs:
  - `pack`: `A` o `AB`
  - `run_seed`: ejecuta `pnpm seed:demo` + `pnpm validate:seed-demo`
  - `allow_critical_skip`: permite SKIP crítico (no recomendado)
- Flujo:
  - `seed + validate` (opcional según input)
  - preflight RC (si falla, bloquea)
  - smoke runner (`--skipPreflight` para evitar duplicidad en CI)
- Artefacto: `.tmp/release-smokes-ci.json`
- Artefacto adicional: `.tmp/preflight-release-ci.json`

### Packs incluidos

Pack A (crítico):
- `scripts/smoke-release-readiness.js`
- `scripts/smoke-packaging-plans.js`
- `scripts/smoke-billing-subscription-scaffolding.js`
- `scripts/smoke-lead-automation-triggers.js`

Pack B (hardening funcional):
- `scripts/smoke-packaging-limits-guardrails.js`
- `scripts/smoke-campaign-onboarding.js`
- `scripts/smoke-campaign-settings.js`

Pack C (manual/markdown) queda fuera del runner y se ejecuta como paso final de validación manual (por ejemplo `scripts/smoke-executive-demo-dashboard.md` y `scripts/smoke-demo-narrative-support.md`).

## Acta RC + paquete final de evidencias (v1 mínima manual)

Base documental versionada:
- `docs/release-candidates/index.md`
- `docs/release-candidates/templates/rc-acta-template.md`
- `docs/release-candidates/templates/pack-c-manual-checklist-template.md`
- `docs/release-candidates/templates/evidence-manifest-template.json`

Convención explícita de RC_ID:

`RC-YYYYMMDD-HHMM-PACK-ALCANCE`

Ejemplo: `RC-20260405-1530-AB-billing-hardening`

### Flujo mínimo recomendado (orden operativo)

1) **Comandos para local**
```bash
# definir RC_ID (UTC recomendado)
set RC_ID=RC-20260405-1530-AB-billing-hardening

# preparar carpeta de corrida
mkdir docs\release-candidates\%RC_ID%
mkdir docs\release-candidates\%RC_ID%\logs
mkdir docs\release-candidates\%RC_ID%\notes

# copiar templates
copy docs\release-candidates\templates\rc-acta-template.md docs\release-candidates\%RC_ID%\rc-acta.md
copy docs\release-candidates\templates\pack-c-manual-checklist-template.md docs\release-candidates\%RC_ID%\pack-c-manual-checklist.md
copy docs\release-candidates\templates\evidence-manifest-template.json docs\release-candidates\%RC_ID%\evidence-manifest.json
```

2) **Comandos para VPS (pull)**
```bash
cd /ruta/proyecto && git pull --ff-only
```

3) **Comandos de ejecución de scripts**
```bash
# preflight técnico (pack A o AB)
node scripts/preflight-release-candidate.js --pack AB --jsonOut .tmp/preflight-release-%RC_ID%.json

# runner técnico (pack A o AB)
node scripts/run-release-smokes.js --pack AB --jsonOut .tmp/release-smokes-%RC_ID%.json

# pack c manual (completar checklist en markdown)
# scripts/smoke-executive-demo-dashboard.md
# scripts/smoke-demo-narrative-support.md
```

Cierre documental:
- Completar `rc-acta.md` con decisión `GO`, `GO con observaciones` o `NO-GO`.
- Completar `evidence-manifest.json` con rutas reales de artefactos y responsables.
