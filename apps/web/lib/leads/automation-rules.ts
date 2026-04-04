type WorkStatus = 'queued' | 'assigned' | 'in_progress' | 'done';
type TakeoverStatus = 'none' | 'taken' | 'released' | 'closed';
type Priority = 'P1' | 'P2' | 'P3' | null;

export type LeadAutomationOperation =
    | 'assign'
    | 'release'
    | 'set_status'
    | 'takeover_take'
    | 'takeover_release'
    | 'takeover_close'
    | 'unknown';

export type LeadAutomationState = {
    work_status?: string | null;
    work_assignee_user_id?: string | null;
    priority?: string | null;
    next_best_action?: string | null;
    sla_status?: string | null;
    sla_is_escalated?: boolean | null;
    human_takeover_status?: string | null;
};

export type AppliedAutomationRule = {
    rule_id: string;
    trigger: string;
    reason: string;
    changes: Record<string, unknown>;
};

export type LeadAutomationResolution = {
    patch: Record<string, unknown>;
    applied_rules: AppliedAutomationRule[];
};

function low(v: unknown) {
    return String(v || '').trim().toLowerCase();
}

function up(v: unknown) {
    return String(v || '').trim().toUpperCase();
}

function txt(v: unknown) {
    return String(v || '').trim();
}

function asWorkStatus(v: unknown): WorkStatus {
    const value = low(v);
    if (value === 'assigned') return 'assigned';
    if (value === 'in_progress') return 'in_progress';
    if (value === 'done') return 'done';
    return 'queued';
}

function asTakeoverStatus(v: unknown): TakeoverStatus {
    const value = low(v);
    if (value === 'taken') return 'taken';
    if (value === 'released') return 'released';
    if (value === 'closed') return 'closed';
    return 'none';
}

function asPriority(v: unknown): Priority {
    const value = up(v);
    if (value === 'P1' || value === 'P2' || value === 'P3') return value;
    return null;
}

function isGenericNba(value: unknown) {
    const nba = low(value);
    if (!nba) return true;
    return (
        nba.startsWith('primer_contacto_') ||
        nba === 'seguimiento_operativo' ||
        nba === 'escalacion_sla_humana' ||
        nba === 'handoff_humano_prioritario'
    );
}

export function resolveLeadAutomationRules(input: {
    operation: LeadAutomationOperation;
    current: LeadAutomationState;
    draftPatch: Record<string, unknown>;
}): LeadAutomationResolution {
    const patch: Record<string, unknown> = {};
    const applied_rules: AppliedAutomationRule[] = [];

    const effective = {
        work_status: asWorkStatus(input.draftPatch.work_status ?? input.current.work_status),
        work_assignee_user_id: txt(input.draftPatch.work_assignee_user_id ?? input.current.work_assignee_user_id) || null,
        priority: asPriority(input.draftPatch.priority ?? input.current.priority),
        next_best_action: txt(input.draftPatch.next_best_action ?? input.current.next_best_action) || null,
        sla_status: low(input.draftPatch.sla_status ?? input.current.sla_status),
        sla_is_escalated: Boolean(input.draftPatch.sla_is_escalated ?? input.current.sla_is_escalated),
        human_takeover_status: asTakeoverStatus(input.draftPatch.human_takeover_status ?? input.current.human_takeover_status),
    };

    if (effective.sla_is_escalated && effective.sla_status === 'overdue' && effective.priority !== 'P1') {
        patch.priority = 'P1';
        applied_rules.push({
            rule_id: 'auto_priority_raise_on_sla_overdue',
            trigger: 'lead.sla.overdue',
            reason: 'SLA vencido y escalado: elevar prioridad para atención inmediata',
            changes: { priority: 'P1' },
        });
        effective.priority = 'P1';
    }

    if (effective.sla_is_escalated && effective.sla_status === 'overdue' && isGenericNba(effective.next_best_action)) {
        patch.next_best_action = 'escalacion_sla_humana';
        applied_rules.push({
            rule_id: 'auto_nba_on_sla_overdue',
            trigger: 'lead.sla.overdue',
            reason: 'SLA vencido y escalado: forzar acción recomendada de recuperación',
            changes: { next_best_action: 'escalacion_sla_humana' },
        });
        effective.next_best_action = 'escalacion_sla_humana';
    }

    if (effective.human_takeover_status === 'released' && isGenericNba(effective.next_best_action)) {
        patch.next_best_action = 'retomar_contacto_post_takeover';
        applied_rules.push({
            rule_id: 'auto_nba_on_takeover_release',
            trigger: 'lead.takeover.released',
            reason: 'Takeover liberado: dejar acción explícita para retomar gestión en cola',
            changes: { next_best_action: 'retomar_contacto_post_takeover' },
        });
        effective.next_best_action = 'retomar_contacto_post_takeover';
    }

    if (
        effective.work_status === 'assigned' &&
        !!effective.work_assignee_user_id &&
        (input.operation === 'assign' || input.operation === 'set_status') &&
        isGenericNba(effective.next_best_action)
    ) {
        patch.next_best_action = 'iniciar_gestion_owner_asignado';
        applied_rules.push({
            rule_id: 'auto_nba_on_assigned_stale_risk',
            trigger: 'lead.assignment.assigned',
            reason: 'Lead asignado: sugerir arranque operativo para evitar envejecimiento en assigned',
            changes: { next_best_action: 'iniciar_gestion_owner_asignado' },
        });
        effective.next_best_action = 'iniciar_gestion_owner_asignado';
    }

    if (
        (input.operation === 'takeover_close' || effective.human_takeover_status === 'closed' || effective.work_status === 'done') &&
        isGenericNba(effective.next_best_action)
    ) {
        patch.next_best_action = 'validar_cierre_y_trazabilidad';
        applied_rules.push({
            rule_id: 'auto_nba_on_operational_close',
            trigger: 'lead.work.done',
            reason: 'Lead cerrado: sugerir validación de cierre/timeline para auditoría operativa',
            changes: { next_best_action: 'validar_cierre_y_trazabilidad' },
        });
    }

    return { patch, applied_rules };
}

