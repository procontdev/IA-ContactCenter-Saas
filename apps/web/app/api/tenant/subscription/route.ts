import { NextResponse } from 'next/server';
import { isPlanCode } from '@/lib/packaging/plan-catalog';
import { callPlatformCoreRpc, normalizeRpcPayload, toHttpError } from '@/lib/tenant/tenant-rpc-server';

type SubscriptionRow = {
    tenant_id: string;
    plan_code: string;
    status: string;
    trial_ends_at: string | null;
    current_period_ends_at: string | null;
    cancel_at_period_end: boolean;
    canceled_at: string | null;
    past_due_since: string | null;
    suspended_at: string | null;
    provider: string | null;
    provider_ref: string | null;
    metadata: Record<string, unknown>;
};

type UpdateBody = {
    status?: string;
    plan_code?: string;
    trial_ends_at?: string | null;
    current_period_ends_at?: string | null;
    cancel_at_period_end?: boolean;
    metadata_patch?: Record<string, unknown>;
};

const STATUS_SET = new Set(['trial', 'active', 'past_due', 'suspended', 'canceled']);

function json(status: number, body: unknown) {
    return NextResponse.json(body, { status });
}

function isObject(v: unknown): v is Record<string, unknown> {
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function normalizeIsoOrNull(value: unknown): string | null {
    const str = String(value || '').trim();
    if (!str) return null;
    const date = new Date(str);
    if (Number.isNaN(date.getTime())) throw new Error('Invalid ISO datetime value');
    return date.toISOString();
}

export async function GET(req: Request) {
    try {
        const raw = await callPlatformCoreRpc<SubscriptionRow[] | SubscriptionRow>(req, 'get_active_tenant_subscription', {});
        const item = normalizeRpcPayload(raw);
        if (!item) return json(404, { error: 'Tenant subscription not found' });
        return json(200, { item });
    } catch (e: unknown) {
        const err = toHttpError(e);
        return json(err.status, { error: err.message, details: err.details });
    }
}

export async function PATCH(req: Request) {
    try {
        const body = (await req.json().catch(() => ({}))) as UpdateBody;
        const payload: Record<string, unknown> = {};

        if (Object.prototype.hasOwnProperty.call(body, 'status')) {
            const status = String(body?.status || '').trim().toLowerCase();
            if (!STATUS_SET.has(status)) {
                return json(400, { error: 'status inválido. Usa trial, active, past_due, suspended o canceled' });
            }
            payload.p_status = status;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'plan_code')) {
            const planCode = String(body?.plan_code || '').trim().toLowerCase();
            if (!isPlanCode(planCode)) {
                return json(400, { error: 'plan_code inválido. Usa basic, pro o enterprise' });
            }
            payload.p_plan_code = planCode;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'trial_ends_at')) {
            payload.p_trial_ends_at = normalizeIsoOrNull(body.trial_ends_at);
        }

        if (Object.prototype.hasOwnProperty.call(body, 'current_period_ends_at')) {
            payload.p_current_period_ends_at = normalizeIsoOrNull(body.current_period_ends_at);
        }

        if (Object.prototype.hasOwnProperty.call(body, 'cancel_at_period_end')) {
            payload.p_cancel_at_period_end = Boolean(body.cancel_at_period_end);
        }

        if (Object.prototype.hasOwnProperty.call(body, 'metadata_patch')) {
            if (!isObject(body.metadata_patch)) return json(400, { error: 'metadata_patch must be an object' });
            payload.p_metadata_patch = body.metadata_patch;
        }

        if (Object.keys(payload).length === 0) {
            return json(400, { error: 'No fields to update' });
        }

        const raw = await callPlatformCoreRpc<SubscriptionRow[] | SubscriptionRow>(
            req,
            'update_active_tenant_subscription',
            payload
        );

        const item = normalizeRpcPayload(raw);
        if (!item) return json(500, { error: 'No tenant subscription returned from RPC' });

        return json(200, { item });
    } catch (e: unknown) {
        const err = toHttpError(e);
        return json(err.status, { error: err.message, details: err.details });
    }
}

