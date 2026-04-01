import { NextResponse } from 'next/server';
import { canPerform } from '@/lib/permissions/access-control';
import { insertLeadActivityEvents } from '@/lib/leads/activity-events';
import { evaluateLeadSlaPolicy } from '@/lib/leads/sla-escalation';
import { resolveTenantFromRequest } from '@/lib/tenant/tenant-request';
import { callPlatformCoreRpc, extractBearerToken } from '@/lib/tenant/tenant-rpc-server';
import type { UserRole } from '@/lib/tenant/tenant-types';

type LeadRow = {
    id: string;
    tenant_id: string;
    campaign_id: string | null;
    queue_start: string | null;
    work_queue: string | null;
    work_status: string | null;
    work_assignee_user_id: string | null;
    work_assigned_at: string | null;
    priority: 'P1' | 'P2' | 'P3' | null;
    sla_due_at: string | null;
    next_best_action: string | null;
    sla_status: 'no_sla' | 'on_time' | 'due_soon' | 'overdue' | null;
    sla_is_escalated: boolean | null;
    sla_escalation_level: 'none' | 'warning' | 'critical' | null;
    sla_escalated_at: string | null;
    sla_last_evaluated_at: string | null;
    human_takeover_status: string | null;
    human_takeover_by_user_id: string | null;
    human_takeover_by_label: string | null;
    human_takeover_at: string | null;
    human_takeover_released_at: string | null;
    human_takeover_closed_at: string | null;
    has_takeover_columns?: boolean;
};

type MemberRow = {
    user_id: string;
    email: string | null;
};

type AssignBody = {
    lead_id?: string;
    operation?: 'assign' | 'release' | 'set_status' | 'takeover_take' | 'takeover_release' | 'takeover_close';
    assignee_user_id?: string | null;
    work_status?: 'queued' | 'assigned' | 'in_progress' | 'done';
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function env(name: string, required = true) {
    const v = (process.env[name] || '').trim();
    if (required && !v) throw new Error(`Missing env var: ${name}`);
    return v;
}

function json(status: number, body: unknown) {
    return NextResponse.json(body, { status });
}

function normalizeRole(input: unknown): UserRole | null {
    const val = String(input || '').toLowerCase();
    if (val === 'superadmin' || val === 'tenant_admin' || val === 'supervisor' || val === 'agent') return val;
    return null;
}

function authHeaders(token: string) {
    const key = (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
    if (!key) throw new Error('Missing SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)');
    return {
        apikey: key,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Accept-Profile': 'contact_center',
        'Content-Profile': 'contact_center',
        'Content-Type': 'application/json',
    };
}

async function fetchLead(leadId: string, tenantId: string, token: string): Promise<LeadRow | null> {
    const baseUrl = env('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
    const params = new URLSearchParams({
        select: 'id,tenant_id,campaign_id,queue_start,work_queue,work_status,work_assignee_user_id,work_assigned_at,priority,sla_due_at,next_best_action,sla_status,sla_is_escalated,sla_escalation_level,sla_escalated_at,sla_last_evaluated_at,human_takeover_status,human_takeover_by_user_id,human_takeover_by_label,human_takeover_at,human_takeover_released_at,human_takeover_closed_at',
        id: `eq.${leadId}`,
        tenant_id: `eq.${tenantId}`,
        limit: '1',
    });

    const res = await fetch(`${baseUrl}/rest/v1/leads?${params.toString()}`, {
        method: 'GET',
        headers: authHeaders(token),
        cache: 'no-store',
    });

    if (res.ok) {
        const rows = (await res.json().catch(() => [])) as LeadRow[];
        const row = rows?.[0] ?? null;
        if (!row) return null;
        return { ...row, has_takeover_columns: true };
    }

    const details = await res.text().catch(() => '');
    const missingTakeoverCols = details.includes('human_takeover_status') && details.includes('does not exist');
    if (!missingTakeoverCols) {
        throw new Error(`PostgREST GET leads failed (${res.status}): ${details}`);
    }

    const legacyParams = new URLSearchParams({
        select: 'id,tenant_id,campaign_id,queue_start,work_queue,work_status,work_assignee_user_id,work_assigned_at,priority,sla_due_at,next_best_action,sla_status,sla_is_escalated,sla_escalation_level,sla_escalated_at,sla_last_evaluated_at',
        id: `eq.${leadId}`,
        tenant_id: `eq.${tenantId}`,
        limit: '1',
    });

    const legacyRes = await fetch(`${baseUrl}/rest/v1/leads?${legacyParams.toString()}`, {
        method: 'GET',
        headers: authHeaders(token),
        cache: 'no-store',
    });
    if (!legacyRes.ok) {
        const legacyDetails = await legacyRes.text().catch(() => '');
        throw new Error(`PostgREST GET leads legacy failed (${legacyRes.status}): ${legacyDetails}`);
    }

    const legacyRows = (await legacyRes.json().catch(() => [])) as LeadRow[];
    const legacy = legacyRows?.[0] ?? null;
    if (!legacy) return null;
    return {
        ...legacy,
        human_takeover_status: null,
        human_takeover_by_user_id: null,
        human_takeover_by_label: null,
        human_takeover_at: null,
        human_takeover_released_at: null,
        human_takeover_closed_at: null,
        sla_status: legacy.sla_status ?? null,
        sla_is_escalated: legacy.sla_is_escalated ?? false,
        sla_escalation_level: legacy.sla_escalation_level ?? 'none',
        sla_escalated_at: legacy.sla_escalated_at ?? null,
        sla_last_evaluated_at: legacy.sla_last_evaluated_at ?? null,
        has_takeover_columns: false,
    };
}

type ActorInfo = {
    userId: string;
    email: string | null;
};

async function fetchActor(token: string): Promise<ActorInfo | null> {
    const baseUrl = env('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/auth/v1/user`, {
        method: 'GET',
        headers: authHeaders(token),
        cache: 'no-store',
    });
    if (!res.ok) return null;
    const user = (await res.json().catch(() => null)) as { id?: string; email?: string | null } | null;
    const id = String(user?.id || '').trim();
    if (!UUID_RE.test(id)) return null;
    return {
        userId: id,
        email: typeof user?.email === 'string' ? user.email : null,
    };
}

export async function POST(req: Request) {
    try {
        const token = extractBearerToken(req);
        if (!token) return json(401, { error: 'Missing Bearer token' });

        const tenant = await resolveTenantFromRequest(req, { fallbackEnabled: false });
        const role = normalizeRole(tenant.role);
        if (!tenant?.tenantId || !role) return json(403, { error: 'No active tenant context' });

        const body = (await req.json().catch(() => ({}))) as AssignBody;
        const leadId = String(body?.lead_id || '').trim();
        const operation = String(body?.operation || '').trim().toLowerCase();
        const requestedStatus = String(body?.work_status || '').trim().toLowerCase();
        const isTakeoverOp = ['takeover_take', 'takeover_release', 'takeover_close'].includes(operation);

        if (!isTakeoverOp && !canPerform(role, 'leads', 'update')) {
            return json(403, { error: 'Forbidden: leads update required' });
        }

        if (!UUID_RE.test(leadId)) return json(400, { error: 'lead_id must be a valid UUID' });
        if (!['assign', 'release', 'set_status', 'takeover_take', 'takeover_release', 'takeover_close'].includes(operation)) {
            return json(400, { error: 'operation inválida. Usa assign, release, set_status, takeover_take, takeover_release o takeover_close' });
        }

        const current = await fetchLead(leadId, tenant.tenantId, token);
        if (!current) return json(404, { error: 'Lead not found in active tenant' });

        const nowIso = new Date().toISOString();
        const patchBody: Record<string, unknown> = {
            updated_at: nowIso,
            work_last_state_at: nowIso,
            work_queue: current.work_queue || current.queue_start || 'wow_queue_default',
        };

        if (operation === 'assign') {
            const assigneeUserId = String(body?.assignee_user_id || '').trim();
            if (!UUID_RE.test(assigneeUserId)) return json(400, { error: 'assignee_user_id must be a valid UUID' });

            const members = await callPlatformCoreRpc<MemberRow[]>(req, 'list_active_tenant_members', {});
            const member = (members || []).find((it) => String(it.user_id || '').toLowerCase() === assigneeUserId.toLowerCase());
            if (!member) return json(400, { error: 'assignee_user_id is not an active member of this tenant' });

            patchBody.work_assignee_user_id = assigneeUserId;
            patchBody.work_assignee_label = member.email || assigneeUserId;
            patchBody.work_assigned_at = nowIso;

            const nextStatus = ['queued', 'assigned', 'in_progress', 'done'].includes(requestedStatus)
                ? requestedStatus
                : current.work_status === 'done'
                    ? 'done'
                    : 'assigned';
            patchBody.work_status = nextStatus;
        }

        if (operation === 'release') {
            patchBody.work_assignee_user_id = null;
            patchBody.work_assignee_label = null;
            patchBody.work_assigned_at = null;
            patchBody.work_status = ['queued', 'assigned', 'in_progress', 'done'].includes(requestedStatus)
                ? requestedStatus
                : 'queued';
        }

        if (operation === 'set_status') {
            if (!['queued', 'assigned', 'in_progress', 'done'].includes(requestedStatus)) {
                return json(400, { error: 'work_status inválido. Usa queued, assigned, in_progress o done' });
            }
            patchBody.work_status = requestedStatus;
            if (requestedStatus === 'queued') {
                patchBody.work_assignee_user_id = null;
                patchBody.work_assignee_label = null;
                patchBody.work_assigned_at = null;
            }
        }

        if (operation === 'takeover_take') {
            if (current.has_takeover_columns === false) {
                return json(409, { error: 'human takeover columns are missing. Apply migration 0022 first.' });
            }
            const actor = await fetchActor(token);
            if (!actor) return json(401, { error: 'No se pudo resolver usuario actor para takeover' });

            patchBody.human_takeover_status = 'taken';
            patchBody.human_takeover_by_user_id = actor.userId;
            patchBody.human_takeover_by_label = actor.email || actor.userId;
            patchBody.human_takeover_at = nowIso;
            patchBody.human_takeover_released_at = null;
            patchBody.human_takeover_closed_at = null;

            patchBody.work_assignee_user_id = actor.userId;
            patchBody.work_assignee_label = actor.email || actor.userId;
            patchBody.work_assigned_at = current.work_assigned_at || nowIso;
            patchBody.work_status = 'in_progress';
        }

        if (operation === 'takeover_release') {
            if (current.has_takeover_columns === false) {
                return json(409, { error: 'human takeover columns are missing. Apply migration 0022 first.' });
            }
            patchBody.human_takeover_status = 'released';
            patchBody.human_takeover_released_at = nowIso;
            patchBody.work_assignee_user_id = null;
            patchBody.work_assignee_label = null;
            patchBody.work_assigned_at = null;
            patchBody.work_status = 'queued';
        }

        if (operation === 'takeover_close') {
            if (current.has_takeover_columns === false) {
                return json(409, { error: 'human takeover columns are missing. Apply migration 0022 first.' });
            }
            if (!current.human_takeover_by_user_id || !current.human_takeover_at) {
                const actor = await fetchActor(token);
                if (!actor) return json(401, { error: 'No se pudo resolver usuario actor para takeover_close' });
                patchBody.human_takeover_by_user_id = actor.userId;
                patchBody.human_takeover_by_label = actor.email || actor.userId;
                patchBody.human_takeover_at = nowIso;
            }
            patchBody.human_takeover_status = 'closed';
            patchBody.human_takeover_closed_at = nowIso;
            patchBody.work_status = 'done';
        }

        const targetWorkStatus = String(patchBody.work_status || current.work_status || 'queued').toLowerCase();
        const targetTakeoverStatus = String(patchBody.human_takeover_status || current.human_takeover_status || 'none').toLowerCase();
        const targetPriority = String(patchBody.priority || current.priority || '').toUpperCase();
        const slaEval = evaluateLeadSlaPolicy({
            sla_due_at: current.sla_due_at,
            priority: targetPriority,
            work_status: targetWorkStatus,
            human_takeover_status: targetTakeoverStatus,
        });

        patchBody.sla_status = slaEval.sla_status;
        patchBody.sla_is_escalated = slaEval.sla_is_escalated;
        patchBody.sla_escalation_level = slaEval.sla_escalation_level;
        patchBody.sla_last_evaluated_at = nowIso;
        if (slaEval.sla_is_escalated) {
            patchBody.sla_escalated_at = current.sla_escalated_at || nowIso;
        }

        if (slaEval.should_raise_priority) {
            patchBody.priority = 'P1';
            if (!String(current.next_best_action || '').trim()) {
                patchBody.next_best_action = 'escalacion_sla_humana';
            }
        }

        const baseUrl = env('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
        const params = new URLSearchParams({
            id: `eq.${leadId}`,
            tenant_id: `eq.${tenant.tenantId}`,
            select: current.has_takeover_columns === false
                ? 'id,tenant_id,work_queue,work_status,work_assignee_user_id,work_assignee_label,work_assigned_at,priority,sla_due_at,sla_status,sla_is_escalated,sla_escalation_level,sla_escalated_at,sla_last_evaluated_at,updated_at'
                : 'id,tenant_id,work_queue,work_status,work_assignee_user_id,work_assignee_label,work_assigned_at,priority,sla_due_at,sla_status,sla_is_escalated,sla_escalation_level,sla_escalated_at,sla_last_evaluated_at,human_takeover_status,human_takeover_by_user_id,human_takeover_by_label,human_takeover_at,human_takeover_released_at,human_takeover_closed_at,updated_at',
            limit: '1',
        });

        const res = await fetch(`${baseUrl}/rest/v1/leads?${params.toString()}`, {
            method: 'PATCH',
            headers: {
                ...authHeaders(token),
                Prefer: 'return=representation',
            },
            body: JSON.stringify(patchBody),
            cache: 'no-store',
        });

        if (!res.ok) {
            const details = await res.text().catch(() => '');
            return json(res.status, { error: 'PostgREST PATCH lead failed', details });
        }

        const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
        const item = rows?.[0] ?? null;
        if (!item) return json(500, { error: 'No row returned after update' });

        try {
            const actor = await fetchActor(token).catch(() => null);
            const eventTypeByOperation: Record<string, string> = {
                assign: 'lead.assignment.assigned',
                release: 'lead.assignment.released',
                set_status: 'lead.work.status_changed',
                takeover_take: 'lead.takeover.taken',
                takeover_release: 'lead.takeover.released',
                takeover_close: 'lead.takeover.closed',
            };

            const eventType = eventTypeByOperation[operation] || 'lead.work.updated';
            await insertLeadActivityEvents({
                baseUrl,
                token,
                events: [
                    {
                        tenantId: tenant.tenantId,
                        leadId,
                        campaignId: current.campaign_id || null,
                        eventType,
                        source: 'api.aap.leads.work-queue.assign',
                        actorUserId: actor?.userId || null,
                        actorLabel: actor?.email || actor?.userId || null,
                        payload: {
                            operation,
                            previous: {
                                work_status: current.work_status,
                                work_assignee_user_id: current.work_assignee_user_id,
                                priority: current.priority,
                                sla_status: current.sla_status,
                                sla_is_escalated: current.sla_is_escalated,
                                sla_escalation_level: current.sla_escalation_level,
                                human_takeover_status: current.human_takeover_status,
                                human_takeover_by_user_id: current.human_takeover_by_user_id,
                            },
                            next: {
                                work_status: item.work_status ?? null,
                                work_assignee_user_id: item.work_assignee_user_id ?? null,
                                priority: item.priority ?? null,
                                sla_status: item.sla_status ?? null,
                                sla_is_escalated: item.sla_is_escalated ?? null,
                                sla_escalation_level: item.sla_escalation_level ?? null,
                                human_takeover_status: item.human_takeover_status ?? null,
                                human_takeover_by_user_id: item.human_takeover_by_user_id ?? null,
                            },
                        },
                    },
                ],
            });
        } catch {
            // MVP: no bloquear flujo operativo por fallo de auditoría
        }

        return json(200, { item });
    } catch (e: unknown) {
        return json(500, { error: e instanceof Error ? e.message : 'Unexpected error' });
    }
}

