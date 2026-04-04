# Smoke manual — Demo script / narrative support MVP

## Objetivo
Validar que `/demo` permite ejecutar una narrativa guiada y repetible para tres audiencias:
- Comercial / producto
- Operativo / desk
- Ejecutivo / investor

## Precondiciones
- Sesión iniciada en la app.
- Tenant activo con seed demo (`DEMOSEED_*`).
- Si hace falta regenerar dataset:
  - `pnpm seed:demo`
  - `pnpm validate:seed-demo`
- App web corriendo (`pnpm --filter dashboard dev`).

## Flujo de validación
1. Abrir `http://localhost:3000/demo`.
2. Confirmar bloques base del launcher:
   - `Pre-flight demo checklist`
   - `Narrativa guiada por audiencia`
   - `Recorrido sugerido`
   - tarjetas de casos demo (escalado / takeover / cerrado / dedup)

### A. Recorrido Comercial / Producto
1. En `Narrativa guiada por audiencia`, seleccionar `Comercial / Producto`.
2. Verificar que cada paso muestre:
   - `Qué mostrar`
   - `Qué contar`
   - CTA de navegación
3. Ejecutar los CTAs en orden y validar apertura de rutas:
   - `/login`
   - `/leads/executive`
   - `/leads/commercial`
   - `/leads/workspace` (con `leadId/callId` cuando hay caso takeover detectado)

### B. Recorrido Operativo / Desk
1. Seleccionar `Operativo / Desk`.
2. Validar secuencia y copy por paso.
3. Ejecutar CTAs en orden:
   - `/leads/manager`
   - `/leads/desk`
   - `/leads/wow/view?id=...` (caso escalado si detectado)
   - `/leads/workspace` (idealmente caso takeover)

### C. Recorrido Ejecutivo / Investor
1. Seleccionar `Ejecutivo / Investor`.
2. Validar secuencia y copy por paso.
3. Ejecutar CTAs en orden:
   - `/leads/executive`
   - `/leads/commercial`
   - `/leads/manager`
   - `/leads/wow/view?id=...` (caso cerrado si detectado)

## Criterios de aprobación
- La demo puede ejecutarse sin memorizar rutas o IDs manuales.
- Existe narrativa corta por paso para “qué mostrar” y “qué contar”.
- Los tres recorridos permiten adaptar mensaje según audiencia.
- Se mantiene continuidad con launcher demo existente y casos seed.
- No se requiere backend nuevo ni cambios de arquitectura.
