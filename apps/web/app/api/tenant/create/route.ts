import { NextResponse } from 'next/server';
import { callPlatformCoreRpc, normalizeRpcPayload, toHttpError } from '@/lib/tenant/tenant-rpc-server';

type CreateTenantResult = {
    tenant_id: string;
    slug: string;
    role: string;
    is_primary: boolean;
};

function normalizeCreateResult(raw: unknown): CreateTenantResult | null {
    const payload = normalizeRpcPayload(raw as CreateTenantResult[] | CreateTenantResult | null);
    if (payload && typeof payload === 'object' && 'tenant_id' in payload) {
        return payload as CreateTenantResult;
    }

    if (payload && typeof payload === 'object' && 'create_tenant_with_owner' in payload) {
        const wrapped = (payload as { create_tenant_with_owner?: unknown }).create_tenant_with_owner;
        if (wrapped && typeof wrapped === 'object' && 'tenant_id' in wrapped) {
            return wrapped as CreateTenantResult;
        }
    }

    return null;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

function json(status: number, body: unknown) {
    return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
    try {
        const body = (await req.json().catch(() => ({}))) as { name?: string; slug?: string };
        const name = String(body?.name || '').trim();
        const slug = String(body?.slug || '').trim().toLowerCase();

        if (!name) return json(400, { error: 'name is required' });
        if (!slug) return json(400, { error: 'slug is required' });
        if (!SLUG_RE.test(slug)) {
            return json(400, {
                error: 'slug inválido. Usa minúsculas, números y guiones (3-64 caracteres)',
            });
        }

        const raw = await callPlatformCoreRpc<CreateTenantResult[] | CreateTenantResult>(
            req,
            'create_tenant_with_owner',
            { p_name: name, p_slug: slug }
        );

        const item = normalizeCreateResult(raw);
        if (!item) return json(500, { error: 'No tenant returned from RPC' });

        return json(200, { item });
    } catch (e: unknown) {
        const err = toHttpError(e);
        return json(err.status, { error: err.message, details: err.details });
    }
}

