import { NextResponse } from 'next/server';
import { callPlatformCoreRpc, toHttpError } from '@/lib/tenant/tenant-rpc-server';

type MembershipRow = {
    tenant_id: string;
    name: string;
    slug: string;
    role: string;
    is_primary: boolean;
    is_active: boolean;
};

function json(status: number, body: unknown) {
    return NextResponse.json(body, { status });
}

export async function GET(req: Request) {
    try {
        const rows = await callPlatformCoreRpc<MembershipRow[]>(req, 'list_my_tenants', {});
        return json(200, { items: rows ?? [] });
    } catch (e: unknown) {
        const err = toHttpError(e);
        return json(err.status, { error: err.message, details: err.details });
    }
}

