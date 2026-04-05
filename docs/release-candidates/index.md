# Release Candidates - base documental mínima

Este bloque define una base **manual, usable y versionable** para cerrar RCs sin automatización compleja.

## 1) Convención explícita de RC_ID

Formato recomendado:

`RC-YYYYMMDD-HHMM-PACK-ALCANCE`

Reglas:
- `YYYYMMDD-HHMM`: timestamp UTC del inicio/cierre de corrida.
- `PACK`: `A` o `AB` (el Pack C se documenta como manual en checklist).
- `ALCANCE`: identificador corto kebab-case (ej. `billing-hardening`).

Ejemplo:

`RC-20260405-1530-AB-billing-hardening`

## 2) Estructura mínima por corrida RC

```text
docs/release-candidates/
  index.md
  templates/
    rc-acta-template.md
    pack-c-manual-checklist-template.md
    evidence-manifest-template.json
  <RC_ID>/
    rc-acta.md
    pack-c-manual-checklist.md
    evidence-manifest.json
    logs/
    notes/
```

## 3) Flujo mínimo de uso (manual + ensamblado mínimo)

1. Definir `RC_ID`.
2. Ejecutar ensamblado mínimo:
   - `pnpm rc:assemble -- --rcId <RC_ID>`
   - Crea `docs/release-candidates/<RC_ID>/`, `logs/`, `notes/`, copia templates y actualiza manifest base.
3. Ejecutar preflight + runner técnico (Pack A o AB) con `jsonOut` versionado por `RC_ID`.
4. Ejecutar de nuevo `pnpm rc:assemble -- --rcId <RC_ID>` para copiar evidencias técnicas desde `.tmp` al paquete RC y refrescar manifest.
5. Ejecutar Pack C manual y completar checklist.
6. Completar acta RC con decisión: `GO`, `GO con observaciones` o `NO-GO`.

## 4) Criterio mínimo de decisión

- **GO**
  - Preflight `PASS` o `WARN` controlado.
  - Runner técnico sin fallas críticas.
  - Pack C manual en `PASS`.
- **GO con observaciones**
  - Sin fallas críticas, pero con riesgos/no-bloqueantes documentados y mitigación acordada.
- **NO-GO**
  - Preflight `FAIL`, o fallas críticas en runner técnico, o fallo manual bloqueante en Pack C.

## 5) Alcance fuera de esta versión

- Publicación automática de artefactos.
- Generación automática de actas/manifiestos.

## 6) Corridas documentadas

- [`RC-20260405-1746-AB-baseline-referencia`](docs/release-candidates/RC-20260405-1746-AB-baseline-referencia/rc-acta.md): primera corrida RC documentada real (base de referencia), con resultado `NO_GO` por prerequisitos faltantes.

