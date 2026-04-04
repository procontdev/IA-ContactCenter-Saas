# Smoke MVP — Playbooks / Next Best Action UI

## Precondiciones
- Sesión activa en `eventprolabs` con tenant válido.
- Usuario con rol `supervisor`, `tenant_admin` o `superadmin` para validar CTAs de operación.
- Tener al menos 4 leads de prueba en el tenant activo (vencido, escalado, takeover tomado, nuevo/ruteado).

## Caso 1: lead con SLA vencido
1. Ir a `/leads/desk`.
2. Filtrar por `Solo SLA vencido`.
3. Seleccionar un lead con `sla_status=overdue`.
4. Validar que el card de Playbook muestre severidad `warning` o `critical` y acciones como:
   - `Asignar owner ahora` (si no tiene owner)
   - `Tomar lead (takeover)`
   - `Mover a in_progress`

## Caso 2: lead escalado
1. En `/leads/desk`, activar `Solo escalados`.
2. Seleccionar lead con `sla_is_escalated=true`.
3. Validar título del playbook orientado a `seguimiento supervisado` y CTA de `Auditar/Revisar timeline`.

## Caso 3: lead tomado por humano
1. Seleccionar un lead con `human_takeover_status=taken`.
2. Confirmar playbook `Takeover humano activo`.
3. Confirmar CTAs sugeridas coherentes (`Confirmar in_progress`, `Cerrar takeover`).

## Caso 4: lead nuevo/ruteado
1. Seleccionar lead `work_status=queued` sin owner.
2. Confirmar playbook `triage inicial`.
3. Validar CTA `Asignar owner inicial` y `Iniciar gestión`.

## Caso 5: guardrails tenant/rol
1. Con rol `agent`, abrir `/leads/desk`.
2. Confirmar que botones de acciones mutables del playbook quedan deshabilitados.
3. Verificar que solo se visualiza recomendación sin poder mutar.

## Caso 6: no fuga cross-tenant
1. Cambiar tenant con el switch de tenant.
2. Repetir `/leads/desk` y `/leads/manager`.
3. Confirmar que los playbooks/NBA solo aparecen para leads del tenant activo.

## Validación Manager View
1. Ir a `/leads/manager`.
2. En columna `NBA`, validar segunda línea con título corto de playbook por lead.
3. Confirmar coloreado de severidad (`critical`, `warning`, `info`) según señales operativas.
