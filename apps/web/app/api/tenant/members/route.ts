import { NextResponse } from 'next/server';
import { getPlanLimit, resolveTenantPlanFromRequest } from '@/lib/packaging/tenant-plan';
import { callPlatformCoreRpc, normalizeRpcPayload, toHttpError } from '@/lib/tenant/tenant-rpc-server';

type MemberRow = {
    tenant_id: string;
    user_id: string;
    email: string | null;
    role: string;
    is_primary: boolean;
    joined_at: string | null;
    invited_at: string | null;
};

const MEMBER_ROLES = new Set(['tenant_admin', 'supervisor', 'agent']);

function json(status: number, body: unknown) {
    return NextResponse.json(body, { status });
}

export async function GET(req: Request) {
    try {
        const rows = await callPlatformCoreRpc<MemberRow[]>(req, 'list_active_tenant_members', {});
        return json(200, { items: rows ?? [] });
    } catch (e: unknown) {
        const err = toHttpError(e);
        return json(err.status, { error: err.message, details: err.details });
    }
}

export async function POST(req: Request) {
    try {
        const body = (await req.json().catch(() => ({}))) as { email?: string; role?: string };
        const email = String(body?.email || '').trim().toLowerCase();
        const role = String(body?.role || 'agent').trim().toLowerCase();

        if (!email) return json(400, { error: 'email is required' });
        if (!MEMBER_ROLES.has(role)) {
            return json(400, { error: 'role inválido. Usa tenant_admin, supervisor o agent' });
        }

        const plan = await resolveTenantPlanFromRequest(req);
        const maxMembers = getPlanLimit(plan, 'max_members');
        if (maxMembers != null) {
            const currentMembers = await callPlatformCoreRpc<MemberRow[]>(req, 'list_active_tenant_members', {});
            const currentCount = Array.isArray(currentMembers) ? currentMembers.length : 0;
            if (currentCount >= maxMembers) {
                return json(403, {
                    error: 'Plan limit reached for tenant members',
                    code: 'PLAN_LIMIT_REACHED',
                    limit: 'max_members',
                    max_allowed: maxMembers,
                    current_count: currentCount,
                    plan_code: plan.plan_code,
                });
            }
        }

        const raw = await callPlatformCoreRpc<MemberRow[] | MemberRow>(req, 'add_member_to_active_tenant', {
            p_email: email,
            p_role: role,
        });

        const item = normalizeRpcPayload(raw);
        if (!item) return json(500, { error: 'No member returned from RPC' });

        return json(200, { item });
    } catch (e: unknown) {
        const err = toHttpError(e);
        return json(err.status, { error: err.message, details: err.details });
    }
}

