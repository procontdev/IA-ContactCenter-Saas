import { NextResponse } from 'next/server';
import { callPlatformCoreRpc, toHttpError } from '@/lib/tenant/tenant-rpc-server';
import { isPlanCode } from '@/lib/packaging/plan-catalog';
import { resolveTenantPlanFromRequest } from '@/lib/packaging/tenant-plan';

function json(status: number, body: unknown) {
    return NextResponse.json(body, { status });
}

export async function GET(req: Request) {
    try {
        const item = await resolveTenantPlanFromRequest(req);
        return json(200, { item });
    } catch (e: unknown) {
        const err = toHttpError(e);
        return json(err.status, { error: err.message, details: err.details });
    }
}

export async function PATCH(req: Request) {
    try {
        const body = (await req.json().catch(() => ({}))) as { plan_code?: string };
        const nextPlan = String(body?.plan_code || '').trim().toLowerCase();

        if (!isPlanCode(nextPlan)) {
            return json(400, { error: 'plan_code inválido. Usa basic, pro o enterprise' });
        }

        await callPlatformCoreRpc(req, 'update_active_tenant_plan', { p_plan_code: nextPlan });
        const item = await resolveTenantPlanFromRequest(req);

        return json(200, { item });
    } catch (e: unknown) {
        const err = toHttpError(e);
        return json(err.status, { error: err.message, details: err.details });
    }
}

