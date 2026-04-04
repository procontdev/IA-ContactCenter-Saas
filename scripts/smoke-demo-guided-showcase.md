# Smoke manual — Demo flow / guided showcase MVP

## Precondiciones
- Sesión iniciada en la app.
- Tenant activo con seed demo (`DEMOSEED_*`).
- Si hace falta regenerar dataset:
  - `pnpm seed:demo`
  - `pnpm validate:seed-demo`

## Flujo de validación
1. Abrir `http://localhost:3000/demo` (o la URL local configurada).
2. Confirmar que carga **Demo Launcher** con:
   - Recorrido sugerido.
   - Accesos rápidos a Human Desk / Manager View / Workspace.
   - Tarjetas de casos (escalado, takeover, cerrado, dedup/merge).
3. Desde el launcher, abrir cada enlace y validar navegación:
    - `/leads/manager`
    - `/leads/commercial`
    - `/leads/desk`
    - `/leads/workspace?leadId=...&callId=...` (si hay caso takeover detectado)
    - `/leads/wow/view?id=...` para los casos scenario.
4. Abrir módulo de campañas y validar señalización demo:
   - `/campaigns`
   - Badge `DEMO` en campañas `DEMOSEED_*`.
   - Botón **Ver solo DEMOSEED_** deja listo el filtro comercial.
5. Confirmar que no hay fuga cross-tenant:
   - Cambiar tenant desde switcher.
   - Verificar que el launcher y casos cambian al dataset del tenant activo.

## Resultado esperado
- El flujo de demo se ejecuta sin recordar IDs manualmente.
- Los módulos clave se abren desde un único punto de entrada.
- La navegación es más presentable/comercial y repetible.
