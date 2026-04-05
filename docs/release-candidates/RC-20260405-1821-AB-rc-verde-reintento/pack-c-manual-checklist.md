# Pack C manual - checklist

## Metadatos

- **RC_ID:** `RC-20260405-1821-AB-rc-verde-reintento`
- **Fecha/hora de ejecución (UTC):** `2026-04-05T18:24:00Z`
- **Fecha/hora de reevaluación documental (UTC):** `2026-04-05T19:39:00Z`
- **Responsable:** `PENDIENTE_MANUAL`
- **Entorno:** `local`

## Checklist de validación manual (Pack C)

> Estado permitido por ítem: `PASS | FAIL | N/A`.

| # | Ítem manual | Estado | Evidencia |
|---|---|---|---|
| C1 | Ejecutar guía `scripts/smoke-executive-demo-dashboard.md` y validar narrativa ejecutiva end-to-end | N/A (pendiente manual) | `notes/pack-c-notes.md` |
| C2 | Ejecutar guía `scripts/smoke-demo-narrative-support.md` y validar narrativa de soporte | N/A (pendiente manual) | `notes/pack-c-notes.md` |
| C3 | Verificar que no existan regresiones funcionales visibles en demo principal tras Pack A/AB | N/A (pendiente manual) | `notes/pack-c-notes.md` |
| C4 | Registrar observaciones operativas (UX, datos demo, tiempos de respuesta) | PASS (documental) | `notes/pack-c-notes.md`, `rc-acta.md` |

## Protocolo manual ejecutable (C1/C2/C3)

> Este bloque define **cómo** ejecutar cada pendiente sin ambigüedad. No reemplaza ejecución humana real.

### Evidencia mínima obligatoria por ítem

- Captura 1 (inicio): pantalla de entrada a la ruta principal del flujo.
- Captura 2 (resultado): pantalla final con el resultado observado.
- Registro breve en `notes/pack-c-notes.md` con:
  - fecha/hora UTC,
  - usuario/rol que ejecutó,
  - tenant,
  - resultado (`PASS` o `FAIL`),
  - hallazgos (si aplica).

### C1 - Narrativa ejecutiva (`scripts/smoke-executive-demo-dashboard.md`)

1. Ingresar con rol permitido (`supervisor`, `tenant_admin` o `superadmin`).
2. Abrir `/leads/executive` y confirmar carga sin error.
3. Cambiar filtro de campaña y confirmar refresco de KPIs/ranking.
4. Validar visualmente KPIs, funnel, ranking, alertas y continuidad de navegación.
5. Ejecutar prueba de guardrail con rol `agent` en `/leads/executive` y verificar acceso restringido.
6. Registrar resultado en `notes/pack-c-notes.md` y actualizar estado C1.

### C2 - Narrativa demo por audiencias (`scripts/smoke-demo-narrative-support.md`)

1. Abrir `/demo`.
2. Validar presencia de bloques base del launcher.
3. Ejecutar recorrido `Comercial / Producto` y verificar CTAs/rutas.
4. Ejecutar recorrido `Operativo / Desk` y verificar CTAs/rutas.
5. Ejecutar recorrido `Ejecutivo / Investor` y verificar CTAs/rutas.
6. Registrar resultado en `notes/pack-c-notes.md` y actualizar estado C2.

### C3 - Regresión funcional visible post AB

1. Desde `/demo`, ejecutar al menos un CTA por cada recorrido (comercial, operativo, ejecutivo).
2. Confirmar que rutas críticas cargan sin error visible: `/leads/executive`, `/leads/commercial`, `/leads/manager`, `/leads/desk`, `/leads/workspace`.
3. Verificar que no haya bloqueos visuales severos (pantalla en blanco, error de permisos inesperado, navegación rota).
4. Registrar resultado en `notes/pack-c-notes.md` y actualizar estado C3.

### Regla de cierre honesto

- Si C1/C2/C3 no tienen evidencia humana mínima: mantener `N/A (pendiente manual)` y `GO con observaciones`.
- Solo marcar `PASS` en C1/C2/C3 cuando exista evidencia trazable y registro explícito.

## Hallazgos manuales

### Bloqueantes (si existen)
- Pendiente ejecución manual de C1/C2/C3 para cerrar Pack C.

### No bloqueantes
- Flujo técnico AB quedó completamente verde.
- C4 quedó documentado con evidencia existente (sin reemplazar validación humana de C1/C2/C3).

## Resultado Pack C manual

- **Resultado consolidado:** `FAIL`
- **Comentario final:** Reevaluación documental confirma cierre parcial (C4) y define protocolo ejecutable para C1/C2/C3. Hasta ejecutar y evidenciar esos ítems, no corresponde declarar GO pleno.

