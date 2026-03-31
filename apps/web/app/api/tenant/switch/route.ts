import { NextResponse } from 'next/server';
import { callPlatformCoreRpc, normalizeRpcPayload, toHttpError } from '@/lib/tenant/tenant-rpc-server';

type ActiveTenantContext = {
    tenant_id: string;
    name: string;
    slug: string;
    role: string;
    is_primary: boolean;
    is_active: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status: number, body: unknown) {
    return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
    try {
        const body = (await req.json().catch(() => ({}))) as { tenant_id?: string };
        const tenantId = String(body?.tenant_id || '').trim();

        if (!tenantId) return json(400, { error: 'tenant_id is required' });
        if (!UUID_RE.test(tenantId)) return json(400, { error: 'tenant_id must be a valid UUID' });

        const raw = await callPlatformCoreRpc<ActiveTenantContext[] | ActiveTenantContext>(
            req,
            'set_active_tenant',
            { p_tenant_id: tenantId }
        );

        const item = normalizeRpcPayload(raw);
        if (!item) return json(404, { error: 'Tenant membership not found' });

        return json(200, { item });
    } catch (e: unknown) {
        const err = toHttpError(e);
        return json(err.status, { error: err.message, details: err.details });
    }
}

