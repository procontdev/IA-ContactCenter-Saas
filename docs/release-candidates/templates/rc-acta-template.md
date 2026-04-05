# Acta de Release Candidate / Cierre técnico (template)

> Copiar este archivo a `docs/release-candidates/<RC_ID>/rc-acta.md`.

## 0) Metadatos

- **RC_ID:** `RC-YYYYMMDD-HHMM-PACK-ALCANCE`
- **Fecha/hora de cierre (UTC):**
- **Entorno evaluado:** `local | staging | vps`
- **Pack evaluado:** `A | AB` + `Pack C manual`
- **Commit evaluado (SHA):**
- **Branch/Tag:**
- **Responsable técnico:**
- **Responsable operación:**

## 1) Resultado ejecutivo

- **Preflight:** `PASS | WARN | FAIL`
- **Runner técnico:** `PASS | FAIL`
- **Pack C manual:** `PASS | FAIL`
- **Resultado consolidado:** `GO | GO_CON_OBSERVACIONES | NO_GO`

Resumen breve (3-8 líneas):

## 2) Evidencias mínimas obligatorias

| Bloque | Estado | Evidencia principal | Evidencia secundaria |
|---|---|---|---|
| Preflight | `PASS/WARN/FAIL` | `.tmp/preflight-release-<RC_ID>.json` | log terminal |
| Runner técnico (Pack A/AB) | `PASS/FAIL` | `.tmp/release-smokes-<RC_ID>.json` | log terminal |
| Pack C manual | `PASS/FAIL` | `pack-c-manual-checklist.md` | capturas/notas |
| Manifest final | `OK/PENDIENTE` | `evidence-manifest.json` | n/a |

## 3) Hallazgos y riesgos

### 3.1 Hallazgos críticos
- (si no hay, dejar explícito: "Sin hallazgos críticos")

### 3.2 Observaciones no bloqueantes
- 

### 3.3 Riesgos conocidos y mitigación
- Riesgo:
- Mitigación:

## 4) Decisión formal

- [ ] **GO**
- [ ] **GO con observaciones**
- [ ] **NO-GO**

Justificación de decisión:

Condiciones para siguiente paso (si aplica):

## 5) Aprobaciones

- **Técnica (nombre / fecha):**
- **Operación (nombre / fecha):**

## 6) Trazabilidad de ejecución

> Registrar exactamente los comandos usados para reproducibilidad.

### 6.1 Local
```bash
# ejemplo
pnpm preflight:release:pack-ab
pnpm smoke:release:pack-ab
```

### 6.2 VPS (pull)
```bash
# ejemplo
cd /ruta/proyecto && git pull --ff-only
```

### 6.3 Scripts ejecutados
```bash
# ejemplo
node scripts/preflight-release-candidate.js --pack AB --jsonOut .tmp/preflight-release-<RC_ID>.json
node scripts/run-release-smokes.js --pack AB --jsonOut .tmp/release-smokes-<RC_ID>.json
```

