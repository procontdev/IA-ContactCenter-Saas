# Release readiness / QA hardening MVP — eventprolabs

## Objetivo operativo
Cerrar validaciones mínimas de salida interna para demo/release sin reescritura del producto.

## Flujos críticos (deben pasar)
1. Login -> Dashboard
2. Dashboard -> Human Desk
3. Human Desk -> Omnichannel Workspace / WOW Detail
4. Manager View
5. Campañas
6. Cambio de tenant
7. Rutas privadas y guardrails API/UI por rol

## Checklist E2E (manual)

### A. Sesión y navegación base
- [ ] `/login` carga y maneja credenciales inválidas con mensaje amigable.
- [ ] Sesión válida redirige a `/dashboard`.
- [ ] Sidebar permite navegar sin links rotos entre `/dashboard`, `/leads/desk`, `/leads/manager`, `/campaigns`.

### B. Human Desk y continuidad
- [ ] `/leads/desk` lista leads o empty state consistente.
- [ ] Selección de lead muestra detalle lateral, timeline y playbook.
- [ ] Link **Abrir Omnichannel Workspace** abre `/leads/workspace?leadId=<uuid>`.
- [ ] Link **Abrir detalle completo** abre WOW Detail.

### C. Omnichannel Workspace
- [ ] Acceso sin `leadId/callId` muestra estado guiado (no error bloqueante).
- [ ] Acceso con `leadId` carga contexto, ownership/takeover, timeline y enlaces de continuidad.
- [ ] Modo lectura (sin `leads.update`) mantiene vista estable y bloquea acciones mutables.

### D. Manager View
- [ ] `/leads/manager` carga KPIs/items para roles permitidos.
- [ ] Rol sin permisos ve aviso de acceso restringido sin romper pantalla.

### E. Campañas
- [ ] `/campaigns` carga tabla o empty state consistente.
- [ ] Enlaces a detalle de campaña funcionan.

### F. Tenant switch y aislamiento
- [ ] Cambio de tenant refresca vistas principales (`dashboard`, `desk`, `manager`).
- [ ] Sin fuga cross-tenant en listas/timeline/casos.

### G. Guardrails API
- [ ] `GET /api/aap/leads/manager-view` sin token retorna 401.
- [ ] `POST /api/aap/leads/work-queue/assign` sin token retorna 401.
- [ ] Mutaciones de work queue/takeover requieren permiso `leads.update`.

## Smoke reutilizable para release interna

### 1) Smoke técnico rápido
```bash
node scripts/smoke-release-readiness.js --apiBaseUrl http://localhost:3001
```

Opcional con token (amplía validaciones autenticadas):
```bash
node scripts/smoke-release-readiness.js --apiBaseUrl http://localhost:3001 --token <bearer_token> --leadId <lead_uuid>
```

### 2) Smokes específicos ya existentes
- `node scripts/smoke-dashboard.js`
- `node scripts/smoke-manager-view.js --expectStatus 200 --token <bearer_token>`
- `scripts/smoke-omnichannel-workspace.md`
- `scripts/smoke-playbooks-next-best-action.md`

## Criterio MVP de salida
- Todos los checks del smoke técnico en PASS.
- Checklist manual completo sin bloqueantes severos.
- Sin regresiones visibles en login/dashboard/desk/workspace/manager/campaigns/tenant-switch.

