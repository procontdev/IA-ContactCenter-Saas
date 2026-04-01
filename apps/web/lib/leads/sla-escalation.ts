export type LeadSlaStatus = 'no_sla' | 'on_time' | 'due_soon' | 'overdue';
export type LeadSlaEscalationLevel = 'none' | 'warning' | 'critical';

export type EvaluateLeadSlaPolicyInput = {
    sla_due_at?: string | null;
    priority?: string | null;
    work_status?: string | null;
    human_takeover_status?: string | null;
    now?: Date;
    dueSoonMinutes?: number;
    criticalOverdueMinutes?: number;
};

export type EvaluatedLeadSlaPolicy = {
    sla_status: LeadSlaStatus;
    sla_is_escalated: boolean;
    sla_escalation_level: LeadSlaEscalationLevel;
    due_in_minutes: number | null;
    overdue_minutes: number | null;
    should_raise_priority: boolean;
    suggested_priority: 'P1' | 'P2' | 'P3' | null;
};

function normalizePriority(input: unknown): 'P1' | 'P2' | 'P3' | null {
    const value = String(input || '').trim().toUpperCase();
    if (value === 'P1' || value === 'P2' || value === 'P3') return value;
    return null;
}

function normalizeWorkStatus(input: unknown): 'queued' | 'assigned' | 'in_progress' | 'done' {
    const value = String(input || '').trim().toLowerCase();
    if (value === 'assigned') return 'assigned';
    if (value === 'in_progress') return 'in_progress';
    if (value === 'done') return 'done';
    return 'queued';
}

function normalizeTakeoverStatus(input: unknown): 'none' | 'taken' | 'released' | 'closed' {
    const value = String(input || '').trim().toLowerCase();
    if (value === 'taken') return 'taken';
    if (value === 'released') return 'released';
    if (value === 'closed') return 'closed';
    return 'none';
}

export function evaluateLeadSlaPolicy(input: EvaluateLeadSlaPolicyInput): EvaluatedLeadSlaPolicy {
    const now = input.now ?? new Date();
    const dueSoonMinutes = Math.max(1, Math.floor(input.dueSoonMinutes ?? 15));
    const criticalOverdueMinutes = Math.max(1, Math.floor(input.criticalOverdueMinutes ?? 60));

    const dueDate = input.sla_due_at ? new Date(input.sla_due_at) : null;
    const dueMs = dueDate && Number.isFinite(dueDate.getTime()) ? dueDate.getTime() : null;
    const priority = normalizePriority(input.priority);
    const workStatus = normalizeWorkStatus(input.work_status);
    const takeoverStatus = normalizeTakeoverStatus(input.human_takeover_status);

    if (dueMs == null) {
        return {
            sla_status: 'no_sla',
            sla_is_escalated: false,
            sla_escalation_level: 'none',
            due_in_minutes: null,
            overdue_minutes: null,
            should_raise_priority: false,
            suggested_priority: priority,
        };
    }

    const diffMinutes = Math.floor((dueMs - now.getTime()) / 60000);
    const overdueMinutes = diffMinutes < 0 ? Math.abs(diffMinutes) : null;
    const isOverdue = diffMinutes < 0;
    const isDueSoon = !isOverdue && diffMinutes <= dueSoonMinutes;

    const slaStatus: LeadSlaStatus = isOverdue ? 'overdue' : isDueSoon ? 'due_soon' : 'on_time';
    const activeForEscalation = workStatus !== 'done' && takeoverStatus !== 'closed';
    const isEscalated = isOverdue && activeForEscalation;
    const escalationLevel: LeadSlaEscalationLevel = !isEscalated
        ? 'none'
        : (overdueMinutes ?? 0) >= criticalOverdueMinutes
            ? 'critical'
            : 'warning';

    const shouldRaisePriority = isEscalated && priority !== 'P1';

    return {
        sla_status: slaStatus,
        sla_is_escalated: isEscalated,
        sla_escalation_level: escalationLevel,
        due_in_minutes: diffMinutes,
        overdue_minutes: overdueMinutes,
        should_raise_priority: shouldRaisePriority,
        suggested_priority: shouldRaisePriority ? 'P1' : priority,
    };
}

