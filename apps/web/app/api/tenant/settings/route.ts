import { NextResponse } from 'next/server';
import { callPlatformCoreRpc, normalizeRpcPayload, toHttpError } from '@/lib/tenant/tenant-rpc-server';

type TenantSettingsRow = {
    tenant_id: string;
    name: string;
    slug: string;
    metadata: Record<string, unknown>;
    settings: Record<string, unknown>;
    timezone: string | null;
    locale: string | null;
    branding: Record<string, unknown>;
};

type UpdateBody = {
    name?: string;
    metadata?: Record<string, unknown>;
    timezone?: string | null;
    locale?: string | null;
    branding?: Record<string, unknown>;
    settings_patch?: Record<string, unknown>;
};

function json(status: number, body: unknown) {
    return NextResponse.json(body, { status });
}

function isObject(v: unknown): v is Record<string, unknown> {
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export async function GET(req: Request) {
    try {
        const raw = await callPlatformCoreRpc<TenantSettingsRow[] | TenantSettingsRow>(req, 'get_active_tenant_settings', {});
        const item = normalizeRpcPayload(raw);
        if (!item) return json(404, { error: 'Tenant settings not found' });
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

        if (Object.prototype.hasOwnProperty.call(body, 'name')) {
            const name = String(body?.name || '').trim();
            if (!name) return json(400, { error: 'name cannot be empty' });
            if (name.length > 120) return json(400, { error: 'name too long (max 120)' });
            payload.p_name = name;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'metadata')) {
            if (!isObject(body.metadata)) return json(400, { error: 'metadata must be an object' });
            payload.p_metadata = body.metadata;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'timezone')) {
            payload.p_timezone = body.timezone == null ? '' : String(body.timezone);
        }

        if (Object.prototype.hasOwnProperty.call(body, 'locale')) {
            payload.p_locale = body.locale == null ? '' : String(body.locale);
        }

        if (Object.prototype.hasOwnProperty.call(body, 'branding')) {
            if (!isObject(body.branding)) return json(400, { error: 'branding must be an object' });
            payload.p_branding = body.branding;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'settings_patch')) {
            if (!isObject(body.settings_patch)) return json(400, { error: 'settings_patch must be an object' });
            payload.p_settings_patch = body.settings_patch;
        }

        if (Object.keys(payload).length === 0) {
            return json(400, { error: 'No fields to update' });
        }

        const raw = await callPlatformCoreRpc<TenantSettingsRow[] | TenantSettingsRow>(
            req,
            'update_active_tenant_settings',
            payload
        );

        const item = normalizeRpcPayload(raw);
        if (!item) return json(500, { error: 'No tenant settings returned from RPC' });

        return json(200, { item });
    } catch (e: unknown) {
        const err = toHttpError(e);
        return json(err.status, { error: err.message, details: err.details });
    }
}

