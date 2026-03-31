import { NextResponse } from 'next/server';
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

