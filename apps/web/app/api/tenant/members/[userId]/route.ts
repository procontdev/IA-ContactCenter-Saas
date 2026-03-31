import { NextResponse } from 'next/server';
import { callPlatformCoreRpc, normalizeRpcPayload, toHttpError } from '@/lib/tenant/tenant-rpc-server';

type MemberRow = {
    tenant_id: string;
    user_id: string;
    email: string | null;
    role: string;
    is_primary: boolean;
};

type RemoveResult = {
    tenant_id: string;
    user_id: string;
    removed: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBER_ROLES = new Set(['tenant_admin', 'supervisor', 'agent']);

function json(status: number, body: unknown) {
    return NextResponse.json(body, { status });
}

function getUserId(params: { userId: string }) {
    const userId = String(params?.userId || '').trim();
    if (!UUID_RE.test(userId)) {
        throw { status: 400, message: 'userId must be a valid UUID' };
    }
    return userId;
}

export async function PATCH(req: Request, context: { params: Promise<{ userId: string }> }) {
    try {
        const params = await context.params;
        const userId = getUserId(params);
        const body = (await req.json().catch(() => ({}))) as { role?: string };
        const role = String(body?.role || '').trim().toLowerCase();

        if (!MEMBER_ROLES.has(role)) {
            return json(400, { error: 'role inválido. Usa tenant_admin, supervisor o agent' });
        }

        const raw = await callPlatformCoreRpc<MemberRow[] | MemberRow>(req, 'update_active_tenant_member_role', {
            p_user_id: userId,
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

export async function DELETE(req: Request, context: { params: Promise<{ userId: string }> }) {
    try {
        const params = await context.params;
        const userId = getUserId(params);
        const raw = await callPlatformCoreRpc<RemoveResult[] | RemoveResult>(req, 'remove_member_from_active_tenant', {
            p_user_id: userId,
        });

        const item = normalizeRpcPayload(raw);
        if (!item) return json(500, { error: 'No remove status returned from RPC' });

        return json(200, { item });
    } catch (e: unknown) {
        const err = toHttpError(e);
        return json(err.status, { error: err.message, details: err.details });
    }
}

