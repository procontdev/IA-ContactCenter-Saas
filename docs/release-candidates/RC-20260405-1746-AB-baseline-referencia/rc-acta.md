# Acta de Release Candidate / Cierre técnico

## 0) Metadatos

- **RC_ID:** `RC-20260405-1746-AB-baseline-referencia`
- **Fecha/hora de cierre (UTC):** `2026-04-05T17:47:04Z`
- **Entorno evaluado:** `local`
- **Pack evaluado:** `AB` + `Pack C manual`
- **Commit evaluado (SHA):** `8badbc3`
- **Branch/Tag:** `main`
- **Responsable técnico:** `PENDIENTE_MANUAL`
- **Responsable operación:** `PENDIENTE_MANUAL`

## 1) Resultado ejecutivo

- **Preflight:** `FAIL`
- **Runner técnico:** `FAIL`
- **Pack C manual:** `FAIL` (no ejecutado aún)
- **Resultado consolidado:** `NO_GO` (borrador estructurado)

Resumen breve (3-8 líneas):

Esta primera corrida RC documentada se ejecutó en local para validar el flujo documental real.
El preflight detectó drift/prerequisitos faltantes (APP_BASE_URL y credenciales smoke/demo).
El runner técnico falló en prechecks críticos por las mismas variables faltantes.
Pack C manual aún no se ejecutó, por lo que se mantiene en estado pendiente/bloqueado.
La decisión queda estructurada como `NO_GO` de referencia operativa hasta completar configuración mínima.

## 2) Evidencias mínimas obligatorias

| Bloque | Estado | Evidencia principal | Evidencia secundaria |
|---|---|---|---|
| Preflight | `FAIL` | `docs/release-candidates/RC-20260405-1746-AB-baseline-referencia/preflight-report.json` | `docs/release-candidates/RC-20260405-1746-AB-baseline-referencia/logs/preflight.log` |
| Runner técnico (Pack A/AB) | `FAIL` | `docs/release-candidates/RC-20260405-1746-AB-baseline-referencia/runner-report.json` | `docs/release-candidates/RC-20260405-1746-AB-baseline-referencia/logs/runner.log` |
| Pack C manual | `FAIL` | `docs/release-candidates/RC-20260405-1746-AB-baseline-referencia/pack-c-manual-checklist.md` | `docs/release-candidates/RC-20260405-1746-AB-baseline-referencia/notes/pack-c-notes.md` |
| Manifest final | `OK` | `docs/release-candidates/RC-20260405-1746-AB-baseline-referencia/evidence-manifest.json` | n/a |

## 3) Hallazgos y riesgos

### 3.1 Hallazgos críticos
- Faltan variables obligatorias para corrida AB (`APP_BASE_URL`, `SMOKE_EMAIL`, `SMOKE_PASSWORD`, `SMOKE_BASIC_TENANT_ID`, `SMOKE_PRO_TENANT_ID`, `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`).
- Runner técnico bloqueado en prechecks críticos por falta de prerequisitos.

### 3.2 Observaciones no bloqueantes
- Falta variable recomendada `SMOKE_API_BASE_URL`.
- Gating básico omitido en preflight por falta de credenciales mínimas.

### 3.3 Riesgos conocidos y mitigación
- Riesgo: avanzar con release sin validar Pack AB ni Pack C en entorno operativo.
- Mitigación: completar variables obligatorias, re-ejecutar preflight + runner y cerrar Pack C manual antes de nueva decisión.

## 4) Decisión formal

- [ ] **GO**
- [ ] **GO con observaciones**
- [x] **NO-GO**

Justificación de decisión:

La corrida no cumple gating mínimo técnico: preflight `FAIL`, runner técnico `FAIL` y Pack C manual pendiente. Se deja como ejemplo base documentado para repetir flujo con configuración correcta.

Condiciones para siguiente paso (si aplica):

1. Configurar variables obligatorias para Pack AB.
2. Re-ejecutar preflight y runner técnico con `jsonOut` versionado por RC_ID.
3. Ejecutar Pack C manual y completar aprobaciones técnica/operación.

## 5) Aprobaciones

- **Técnica (nombre / fecha):** `PENDIENTE_MANUAL`
- **Operación (nombre / fecha):** `PENDIENTE_MANUAL`

## 6) Trazabilidad de ejecución

### 6.1 Local
```bash
node scripts/preflight-release-candidate.js --pack AB --jsonOut .tmp/preflight-release-RC-20260405-1746-AB-baseline-referencia.json
node scripts/run-release-smokes.js --pack AB --skipPreflight true --jsonOut .tmp/release-smokes-RC-20260405-1746-AB-baseline-referencia.json
```

### 6.2 VPS (pull)
```bash
cd /srv/ia-contactcenter-saas && git pull --ff-only
```

### 6.3 Scripts ejecutados
```bash
node scripts/preflight-release-candidate.js --pack AB --jsonOut .tmp/preflight-release-RC-20260405-1746-AB-baseline-referencia.json
node scripts/run-release-smokes.js --pack AB --skipPreflight true --jsonOut .tmp/release-smokes-RC-20260405-1746-AB-baseline-referencia.json
```
