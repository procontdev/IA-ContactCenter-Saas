# Bootstrap seguro: tenant inicial + usuario demo/admin

## Enfoque

Se implementa en 2 capas:

1. SQL idempotente de plataforma: [`0008_bootstrap_default_tenant_and_auth_link.sql`](supabase/migrations/0008_bootstrap_default_tenant_and_auth_link.sql)
2. Bootstrap operativo de Auth + vínculo tenant: [`bootstrap-demo-admin.js`](scripts/bootstrap-demo-admin.js)

No se inserta directamente en `auth.users` por SQL.

---

## Parte A — migración/seed segura

Archivo: [`0008_bootstrap_default_tenant_and_auth_link.sql`](supabase/migrations/0008_bootstrap_default_tenant_and_auth_link.sql)

Incluye:

- Asegura tenant inicial (`default-tenant`) con UUID fijo.
- Asegura fila en `platform_core.tenant_settings`.
- Crea helper [`platform_core.resolve_bootstrap_tenant_id()`](supabase/migrations/0008_bootstrap_default_tenant_and_auth_link.sql:31)
- Crea RPC idempotente [`platform_core.bootstrap_link_user_to_default_tenant()`](supabase/migrations/0008_bootstrap_default_tenant_and_auth_link.sql:55)
  - valida `p_role`
  - hace `upsert` en `platform_core.tenant_users`
  - permite `p_make_primary=true` para marcar primario
- Otorga ejecución al `service_role` para bootstrap controlado.

---

## Parte B — bootstrap de usuario demo/admin

Archivo: [`bootstrap-demo-admin.js`](scripts/bootstrap-demo-admin.js)

Flujo:

1. Lee env de [`/.env.antigravity.local`](.env.antigravity.local) y [`apps/web/.env.local`](apps/web/.env.local).
2. Crea usuario por endpoint oficial `auth/v1/admin/users`.
3. Si ya existe, lo recupera por listado `auth/v1/admin/users`.
4. Llama RPC [`bootstrap_link_user_to_default_tenant`](supabase/migrations/0008_bootstrap_default_tenant_and_auth_link.sql:55).
5. Devuelve JSON con `userId`, `tenant_id`, `role`, `is_primary`.

---

## Ejecución paso a paso

1. Aplicar migración [`0008_bootstrap_default_tenant_and_auth_link.sql`](supabase/migrations/0008_bootstrap_default_tenant_and_auth_link.sql)
2. Definir variables de bootstrap (opcional):
   - `DEMO_ADMIN_EMAIL`
   - `DEMO_ADMIN_PASSWORD`
   - `DEMO_ADMIN_ROLE` (default: `tenant_admin`)
3. Ejecutar:

```bash
node scripts/bootstrap-demo-admin.js
```

4. Verificar salida `ok: true` y revisar `tenantLink`.

---

## Riesgos y consideraciones

- Si PostgREST bloquea SELECT directo sobre `platform_core.tenant_users`, la RPC `SECURITY DEFINER` permite vínculo sin abrir permisos globales.
- Rotar `DEMO_ADMIN_PASSWORD` tras bootstrap inicial.
- En producción, usar correo controlado y política MFA/SSO según estándar interno.

---

## Recomendación sobre tocar `auth.users` por SQL

**No recomendado** para este proyecto.

Motivos:

- Supabase gestiona lógica adicional de Auth (hash de password, metadatos, auditoría, compatibilidad de versión).
- El endpoint admin `auth/v1/admin/users` es el mecanismo correcto y soportado.
- SQL directo a `auth.users` solo sería justificable en recuperación extrema/offline con conocimiento completo del esquema interno de GoTrue y validación integral posterior.

