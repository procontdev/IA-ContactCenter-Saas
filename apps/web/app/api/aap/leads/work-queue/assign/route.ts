import { NextResponse } from 'next/server';
import { canPerform } from '@/lib/permissions/access-control';
import { resolveTenantFromRequest } from '@/lib/tenant/tenant-request';
import { callPlatformCoreRpc, extractBearerToken } from '@/lib/tenant/tenant-rpc-server';
import type { UserRole } from '@/lib/tenant/tenant-types';

type LeadRow = {
    id: string;
    tenant_id: string;
    queue_start: string | null;
    work_queue: string | null;
    work_status: string | null;
    work_assignee_user_id: string | null;
};

type MemberRow = {
    user_id: string;
    email: string | null;
};

type AssignBody = {
    lead_id?: string;
    operation?: 'assign' | 'release' | 'set_status';
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
        select: 'id,tenant_id,queue_start,work_queue,work_status,work_assignee_user_id',
        id: `eq.${leadId}`,
        tenant_id: `eq.${tenantId}`,
        limit: '1',
    });

    const res = await fetch(`${baseUrl}/rest/v1/leads?${params.toString()}`, {
        method: 'GET',
        headers: authHeaders(token),
        cache: 'no-store',
    });

    if (!res.ok) {
        const details = await res.text().catch(() => '');
        throw new Error(`PostgREST GET leads failed (${res.status}): ${details}`);
    }

    const rows = (await res.json().catch(() => [])) as LeadRow[];
    return rows?.[0] ?? null;
}

export async function POST(req: Request) {
    try {
        const token = extractBearerToken(req);
        if (!token) return json(401, { error: 'Missing Bearer token' });

        const tenant = await resolveTenantFromRequest(req, { fallbackEnabled: false });
        const role = normalizeRole(tenant.role);
        if (!tenant?.tenantId || !role) return json(403, { error: 'No active tenant context' });
        if (!canPerform(role, 'leads', 'update')) return json(403, { error: 'Forbidden: leads update required' });

        const body = (await req.json().catch(() => ({}))) as AssignBody;
        const leadId = String(body?.lead_id || '').trim();
        const operation = String(body?.operation || '').trim().toLowerCase();
        const requestedStatus = String(body?.work_status || '').trim().toLowerCase();

        if (!UUID_RE.test(leadId)) return json(400, { error: 'lead_id must be a valid UUID' });
        if (!['assign', 'release', 'set_status'].includes(operation)) {
            return json(400, { error: 'operation inválida. Usa assign, release o set_status' });
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

        const baseUrl = env('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
        const params = new URLSearchParams({
            id: `eq.${leadId}`,
            tenant_id: `eq.${tenant.tenantId}`,
            select: 'id,tenant_id,work_queue,work_status,work_assignee_user_id,work_assignee_label,work_assigned_at,updated_at',
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

        return json(200, { item });
    } catch (e: unknown) {
        return json(500, { error: e instanceof Error ? e.message : 'Unexpected error' });
    }
}

