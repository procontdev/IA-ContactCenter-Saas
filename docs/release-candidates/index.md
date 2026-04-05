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

## 3) Flujo mínimo de uso (manual)

1. Crear carpeta de corrida: `docs/release-candidates/<RC_ID>/`.
2. Copiar templates:
   - `templates/rc-acta-template.md` -> `<RC_ID>/rc-acta.md`
   - `templates/pack-c-manual-checklist-template.md` -> `<RC_ID>/pack-c-manual-checklist.md`
   - `templates/evidence-manifest-template.json` -> `<RC_ID>/evidence-manifest.json`
3. Ejecutar preflight + runner técnico (Pack A o AB) y guardar JSON/reportes.
4. Ejecutar Pack C manual y completar checklist.
5. Completar acta RC con decisión: `GO`, `GO con observaciones` o `NO-GO`.
6. Completar `evidence-manifest.json` con rutas reales y responsables.

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

- Ensamblado automático de paquete final.
- Publicación automática de artefactos.
- Generación automática de actas/manifiestos.

## 6) Corridas documentadas

- [`RC-20260405-1746-AB-baseline-referencia`](docs/release-candidates/RC-20260405-1746-AB-baseline-referencia/rc-acta.md): primera corrida RC documentada real (base de referencia), con resultado `NO_GO` por prerequisitos faltantes.

