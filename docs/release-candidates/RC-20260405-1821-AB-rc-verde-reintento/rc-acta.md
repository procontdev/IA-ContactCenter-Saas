# Acta de Release Candidate / Cierre técnico

## 0) Metadatos

- **RC_ID:** `RC-20260405-1821-AB-rc-verde-reintento`
- **Fecha/hora de cierre (UTC):** `2026-04-05T18:24:00Z`
- **Entorno evaluado:** `local`
- **Pack evaluado:** `AB` + `Pack C manual`
- **Commit evaluado (SHA):** `25ae6d0`
- **Branch/Tag:** `main`
- **Responsable técnico:** `PENDIENTE_MANUAL`
- **Responsable operación:** `PENDIENTE_MANUAL`

## 1) Resultado ejecutivo

- **Preflight:** `PASS`
- **Runner técnico:** `PASS`
- **Pack C manual:** `FAIL` (pendiente manual)
- **Resultado consolidado:** `GO_CON_OBSERVACIONES`

Resumen breve (3-8 líneas):

Se ejecutó un reintento RC AB con prerequisitos críticos saneados y flujo técnico completo.
El preflight quedó en `PASS` con 8/8 checks aprobados y sin drift de prerequisitos.
El runner técnico AB quedó en `PASS` con 7/7 smokes aprobados (0 fallas críticas, 0 skip).
El paquete documental RC quedó ensamblado con reportes técnicos versionados y manifest actualizado.
Pack C quedó preparado y parcialmente documentado, pero su ejecución manual completa queda pendiente.
Se recomienda cierre en `GO con observaciones` condicionado a completar evidencia manual de Pack C.

## 2) Evidencias mínimas obligatorias

| Bloque | Estado | Evidencia principal | Evidencia secundaria |
|---|---|---|---|
| Preflight | `PASS` | `docs/release-candidates/RC-20260405-1821-AB-rc-verde-reintento/preflight-report.json` | `docs/release-candidates/RC-20260405-1821-AB-rc-verde-reintento/logs/preflight.log` |
| Runner técnico (Pack A/AB) | `PASS` | `docs/release-candidates/RC-20260405-1821-AB-rc-verde-reintento/runner-report.json` | `docs/release-candidates/RC-20260405-1821-AB-rc-verde-reintento/logs/runner.log` |
| Pack C manual | `FAIL` (pendiente manual) | `docs/release-candidates/RC-20260405-1821-AB-rc-verde-reintento/pack-c-manual-checklist.md` | `docs/release-candidates/RC-20260405-1821-AB-rc-verde-reintento/notes/pack-c-notes.md` |
| Manifest final | `OK` | `docs/release-candidates/RC-20260405-1821-AB-rc-verde-reintento/evidence-manifest.json` | n/a |

## 3) Hallazgos y riesgos

### 3.1 Hallazgos críticos
- Sin hallazgos críticos en preflight/runner técnico para pack AB.

### 3.2 Observaciones no bloqueantes
- Pack C manual no ejecutado completamente en esta corrida (requiere validación manual de narrativa/capturas).

### 3.3 Riesgos conocidos y mitigación
- Riesgo: declarar `GO` pleno sin evidencia manual final de Pack C.
- Mitigación: completar checklist manual C1/C2/C3 y adjuntar evidencia operativa antes del cierre definitivo.

## 4) Decisión formal

- [ ] **GO**
- [x] **GO con observaciones**
- [ ] **NO-GO**

Justificación de decisión:

El bloque técnico AB queda completamente verde (`PASS` preflight y `PASS` runner). Se mantiene observación por pendiente manual de Pack C, por lo que corresponde `GO con observaciones` en lugar de `GO` pleno.

Condiciones para siguiente paso (si aplica):

1. Ejecutar manualmente C1/C2/C3 del Pack C.
2. Completar `pack-c-manual-checklist.md` con estados finales y evidencia.
3. Confirmar aprobaciones técnica/operación para elevar de `GO con observaciones` a `GO` pleno.

## 5) Aprobaciones

- **Técnica (nombre / fecha):** `PENDIENTE_MANUAL`
- **Operación (nombre / fecha):** `PENDIENTE_MANUAL`

## 6) Trazabilidad de ejecución

### 6.1 Local
```bash
set "APP_BASE_URL=http://localhost:3001"
set "SMOKE_EMAIL=demo.admin@local.test"
set "SMOKE_PASSWORD=DemoAdmin123!"
set "DEMO_ADMIN_EMAIL=demo.admin@local.test"
set "DEMO_ADMIN_PASSWORD=DemoAdmin123!"
set "SMOKE_BASIC_TENANT_ID="
set "SMOKE_PRO_TENANT_ID=2e1c36c5-adaa-4db1-b872-b3d72e879777"
node scripts/preflight-release-candidate.js --pack AB --jsonOut .tmp/preflight-release-RC-20260405-1821-AB-rc-verde-reintento.json
node scripts/run-release-smokes.js --pack AB --jsonOut .tmp/release-smokes-RC-20260405-1821-AB-rc-verde-reintento.json
pnpm rc:assemble -- --rcId RC-20260405-1821-AB-rc-verde-reintento
```

### 6.2 VPS (pull)
```bash
cd /ruta/proyecto && git pull --ff-only
```

### 6.3 Scripts ejecutados
```bash
node scripts/preflight-release-candidate.js --pack AB --jsonOut .tmp/preflight-release-RC-20260405-1821-AB-rc-verde-reintento.json
node scripts/run-release-smokes.js --pack AB --jsonOut .tmp/release-smokes-RC-20260405-1821-AB-rc-verde-reintento.json
node scripts/assemble-release-evidence.js --rcId RC-20260405-1821-AB-rc-verde-reintento
```

