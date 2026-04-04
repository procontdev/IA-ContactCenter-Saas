export type PlaybookSeverity = 'critical' | 'warning' | 'info';

export type PlaybookActionId =
    | 'assign_owner'
    | 'set_in_progress'
    | 'set_done'
    | 'takeover_take'
    | 'takeover_release'
    | 'takeover_close'
    | 'open_timeline'
    | 'open_detail';

export type PlaybookAction = {
    id: PlaybookActionId;
    label: string;
    hint?: string;
};

export type LeadPlaybookSignals = {
    next_best_action?: string | null;
    priority?: 'P1' | 'P2' | 'P3' | null;
    sla_status?: 'no_sla' | 'on_time' | 'due_soon' | 'overdue' | null;
    sla_is_escalated?: boolean | null;
    sla_escalation_level?: 'none' | 'warning' | 'critical' | null;
    work_status?: 'queued' | 'assigned' | 'in_progress' | 'done' | null;
    human_takeover_status?: 'none' | 'taken' | 'released' | 'closed' | null;
    lead_temperature?: 'caliente' | 'tibio' | 'frio' | null;
    work_assignee_user_id?: string | null;
    work_assignee_label?: string | null;
};

export type LeadPlaybookResolution = {
    id: string;
    title: string;
    summary: string;
    severity: PlaybookSeverity;
    actions: PlaybookAction[];
    rawNextBestAction: string | null;
};

function txt(v: unknown) {
    return String(v ?? '').trim();
}

function low(v: unknown) {
    return txt(v).toLowerCase();
}

function normalizeNbaLabel(raw: string | null) {
    if (!raw) return 'sin_nba_persistido';
    return raw
        .split('_')
        .filter(Boolean)
        .join(' ');
}

export function resolveLeadPlaybook(signals: LeadPlaybookSignals): LeadPlaybookResolution {
    const priority = txt(signals.priority).toUpperCase();
    const slaStatus = low(signals.sla_status || 'no_sla');
    const escalationLevel = low(signals.sla_escalation_level || 'none');
    const workStatus = low(signals.work_status || 'queued');
    const takeoverStatus = low(signals.human_takeover_status || 'none');
    const temp = low(signals.lead_temperature || '');
    const rawNextBestAction = txt(signals.next_best_action) || null;
    const hasOwner = Boolean(txt(signals.work_assignee_user_id) || txt(signals.work_assignee_label));

    if (workStatus === 'done' || takeoverStatus === 'closed') {
        return {
            id: 'playbook_closed_followup',
            title: 'Lead cerrado: validar cierre y trazabilidad',
            summary: 'El caso está marcado como cerrado. Confirma timeline/auditoría y evita reabrir sin causa.',
            severity: 'info',
            actions: [
                { id: 'open_timeline', label: 'Revisar timeline' },
                { id: 'open_detail', label: 'Abrir detalle completo' },
            ],
            rawNextBestAction,
        };
    }

    if (slaStatus === 'overdue') {
        return {
            id: 'playbook_sla_overdue_recovery',
            title: 'SLA vencido: recuperación inmediata',
            summary: 'Prioriza toma del lead, owner activo y avance operativo en este turno.',
            severity: escalationLevel === 'critical' ? 'critical' : 'warning',
            actions: [
                ...(!hasOwner ? [{ id: 'assign_owner' as const, label: 'Asignar owner ahora' }] : []),
                ...(takeoverStatus !== 'taken' ? [{ id: 'takeover_take' as const, label: 'Tomar lead (takeover)' }] : []),
                { id: 'set_in_progress', label: 'Mover a in_progress' },
                { id: 'open_timeline', label: 'Revisar timeline' },
            ],
            rawNextBestAction,
        };
    }

    if (signals.sla_is_escalated || escalationLevel === 'critical' || escalationLevel === 'warning') {
        return {
            id: 'playbook_escalated_followup',
            title: 'Lead escalado: seguimiento supervisado',
            summary: 'Caso en escalación activa. Requiere owner claro y trazabilidad explícita.',
            severity: escalationLevel === 'critical' ? 'critical' : 'warning',
            actions: [
                ...(!hasOwner ? [{ id: 'assign_owner' as const, label: 'Asignar owner' }] : []),
                ...(takeoverStatus === 'none' || takeoverStatus === 'released'
                    ? [{ id: 'takeover_take' as const, label: 'Tomar takeover' }]
                    : []),
                { id: 'set_in_progress', label: 'Marcar en curso' },
                { id: 'open_timeline', label: 'Auditar timeline' },
            ],
            rawNextBestAction,
        };
    }

    if (takeoverStatus === 'taken') {
        return {
            id: 'playbook_human_takeover_active',
            title: 'Takeover humano activo',
            summary: 'Mantén foco en resolución, registra avances y cierra takeover al completar.',
            severity: 'info',
            actions: [
                { id: 'set_in_progress', label: 'Confirmar in_progress' },
                { id: 'takeover_close', label: 'Cerrar takeover' },
                { id: 'open_timeline', label: 'Revisar timeline' },
            ],
            rawNextBestAction,
        };
    }

    if (takeoverStatus === 'released') {
        return {
            id: 'playbook_takeover_released_reengage',
            title: 'Takeover liberado: retomar ownership',
            summary: 'El takeover fue liberado. Reasigna/toma el lead para evitar pérdida operativa.',
            severity: 'warning',
            actions: [
                { id: 'assign_owner', label: 'Asignar owner' },
                { id: 'takeover_take', label: 'Retomar takeover' },
                { id: 'set_in_progress', label: 'Marcar en curso' },
            ],
            rawNextBestAction,
        };
    }

    if (workStatus === 'queued' && !hasOwner) {
        return {
            id: 'playbook_initial_triage',
            title: 'Lead nuevo en cola: triage inicial',
            summary: 'Asegura owner responsable y primer contacto según campaña/cola.',
            severity: 'info',
            actions: [
                { id: 'assign_owner', label: 'Asignar owner inicial' },
                { id: 'set_in_progress', label: 'Iniciar gestión' },
            ],
            rawNextBestAction,
        };
    }

    if (workStatus === 'assigned') {
        return {
            id: 'playbook_assigned_start_execution',
            title: 'Lead asignado: iniciar ejecución',
            summary: 'El lead ya tiene owner. Activar gestión y evitar envejecimiento en assigned.',
            severity: 'info',
            actions: [
                { id: 'set_in_progress', label: 'Pasar a in_progress' },
                { id: 'takeover_take', label: 'Tomar takeover (si aplica)' },
            ],
            rawNextBestAction,
        };
    }

    if (priority === 'P1' || temp === 'caliente') {
        return {
            id: 'playbook_priority_contact',
            title: 'Prioridad alta: contacto prioritario',
            summary: 'Lead de alta prioridad/temperatura. Ejecutar contacto y seguimiento corto.',
            severity: 'warning',
            actions: [
                { id: 'set_in_progress', label: 'Priorizar en curso' },
                { id: 'takeover_take', label: 'Tomar takeover' },
                { id: 'open_detail', label: 'Abrir detalle completo' },
            ],
            rawNextBestAction,
        };
    }

    return {
        id: 'playbook_generic_followup',
        title: 'Seguimiento operativo estándar',
        summary: `Aplicar flujo base y usar NBA actual: ${normalizeNbaLabel(rawNextBestAction)}.`,
        severity: 'info',
        actions: [
            { id: 'set_in_progress', label: 'Continuar gestión' },
            { id: 'open_timeline', label: 'Ver timeline' },
        ],
        rawNextBestAction,
    };
}
