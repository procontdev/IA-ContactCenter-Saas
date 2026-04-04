# Seed demo data / demo scenarios MVP

Este bloque deja un dataset demo **reproducible** para `eventprolabs` sin preparación manual.

## Qué crea

- Tenants demo (idempotentes por slug):
  - `eventprolabs-demo-ops`
  - `eventprolabs-demo-b2b`
- Campañas demo por tenant con código prefijo `DEMOSEED_`.
- Escenarios por tenant:
  - lead nuevo (queued)
  - lead duplicado (intake merged por dedup)
  - lead asignado (owner explícito)
  - lead takeover tomado
  - lead escalado por SLA (overdue + escalated)
  - lead cerrado (takeover_close / done)
- Caso omnicanal para Workspace:
  - `calls` + `call_messages` asociados a lead takeover.

## Requisitos

- Entorno con variables válidas en `.env.antigravity.local` o `apps/web/.env.local`:
  - `NEXT_PUBLIC_SUPABASE_URL` (o `SUPABASE_URL`)
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (o `SUPABASE_ANON_KEY`)
  - `DEMO_ADMIN_EMAIL`
  - `DEMO_ADMIN_PASSWORD`
- App Next corriendo (API interna): `APP_BASE_URL` (default `http://localhost:3001`).

## Comandos

- Seed con reset previo (recomendado):

```bash
pnpm seed:demo
```

- Seed sin limpiar dataset demo previo:

```bash
pnpm seed:demo:no-reset
```

- Validación técnica mínima del dataset demo:

```bash
pnpm validate:seed-demo
```

## Seguridad / tenant scope

- El seed opera con contexto autenticado de `DEMO_ADMIN`.
- Cada operación fuerza tenant activo usando RPC `set_active_tenant`.
- La limpieza elimina solo entidades vinculadas a campañas con prefijo `DEMOSEED_` dentro del tenant objetivo.
- No toca `0006` ni migraciones previas.

## Rutas demo recomendadas

- Human Desk: `/leads/desk`
- Manager View: `/leads/manager`
- Workspace Omnicanal: `/leads/workspace?leadId=<lead_id>&callId=<call_id>`
- Inbox: `/inbox`

