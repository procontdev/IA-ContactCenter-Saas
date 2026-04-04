# Smoke manual — Omnichannel Conversation Workspace MVP

## Precondiciones
- Usuario autenticado en `eventprolabs`.
- Tenant activo con leads y al menos un call/mensaje existente.
- Rol recomendado para smoke completo: `tenant_admin` o `supervisor`.

## 1) Abrir workspace de caso
1. Ir a `Leads > Human Desk`.
2. Seleccionar un lead y hacer clic en **Abrir Omnichannel Workspace**.
3. Validar que abra `/leads/workspace?leadId=<uuid>`.

## 2) Ver contexto lead/canal/campaña
1. Confirmar panel **Contexto unificado** visible.
2. Verificar presencia de: lead, campaña, canal, owner, takeover, estado de trabajo, NBA, prioridad, SLA.

## 3) Ver ownership/takeover/estado
1. En panel **Ownership / Takeover**, probar:
   - `Asignar`
   - `En curso`
   - `Tomar`
2. Confirmar que el contexto se refresca y refleja el nuevo estado.

## 4) Ver historial/timeline
1. Ir al panel **Timeline**.
2. Confirmar lista de eventos o fallback `Sin eventos en timeline`.
3. Validar que no hay fuga cross-tenant (solo eventos del tenant activo).

## 5) Acción operativa básica en conversación
1. En bloque **Conversación / Interacciones**, elegir un `call`.
2. Ejecutar `Tomar conversación`.
3. Si está en modo humano activo, enviar un mensaje desde **Respuesta rápida**.
4. Validar refresco de mensajes y continuidad en `Inbox Detail`.

## 6) Guardrails tenant/rol
1. Cambiar a usuario rol `agent` (o rol sin `leads.update`).
2. Abrir mismo workspace.
3. Confirmar banner de alcance limitado y acciones de ownership/takeover deshabilitadas.
4. Confirmar que la vista no rompe y mantiene contexto conversacional de solo lectura.

## 7) Continuidad con superficies existentes
Desde el workspace validar enlaces funcionales a:
- `Human Desk`
- `Inbox`
- `WOW Detail`
- `Call Detail`

Resultado esperado: experiencia integrada de caso/conversación operable para demo y operación humana MVP, sin romper flujos previos.
