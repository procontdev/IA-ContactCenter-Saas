import { NextResponse } from 'next/server';
import { canPerform } from '@/lib/permissions/access-control';
import { CHANNEL_SET, isObject, normalizeOpsSettings } from '@/lib/campaigns/provisioning';
import { resolveTenantFromRequest } from '@/lib/tenant/tenant-request';
import { extractBearerToken } from '@/lib/tenant/tenant-rpc-server';
import type { UserRole } from '@/lib/tenant/tenant-types';

type CreateCampaignBody = {
    code?: string;
    name?: string;
    is_active?: boolean;

    description?: string;
    objective?: string;
    success_criteria?: string;
    target_audience?: string;

    llm_policy?: Record<string, unknown>;
    llm_system_prompt?: string;

    qualification_fields?: unknown[];
    allowed_intents?: unknown[];
    disallowed_topics?: unknown[];
    closing_reasons?: unknown[];

    opening_script?: string;
    opening_question?: string;

    inbound_enabled?: boolean;
    inbound_default_mode?: 'human' | 'llm';
    inbound_llm_text_enabled?: boolean;
    llm_model?: string | null;
    llm_fallback_to_human?: boolean;
    wa_instance?: string | null;
    wa_business_phone?: string | null;

    ops_settings?: Record<string, unknown>;
};

type CampaignRow = {
    id: string;
    tenant_id: string;
    code: string;
    name: string;
    is_active: boolean;
    inbound_enabled: boolean;
    inbound_default_mode: 'human' | 'llm';
    inbound_llm_text_enabled: boolean;
    llm_fallback_to_human: boolean;
    wa_instance: string | null;
    wa_business_phone: string | null;
    ops_settings?: Record<string, unknown> | null;
    llm_policy?: Record<string, unknown> | null;
    updated_at: string;
    created_at: string;
};

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
    const key =
        (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!key) throw new Error('Missing SUPABASE key');
    return {
        apikey: key,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Accept-Profile': 'contact_center',
        'Content-Profile': 'contact_center',
        'Content-Type': 'application/json',
    };
}

function strOrEmpty(v: unknown) {
    return String(v ?? '').trim();
}

function optionalTrimmed(v: unknown): string | null {
    const text = String(v ?? '').trim();
    return text || null;
}

function ensureDigitsPhone(v: unknown): string | null {
    const digits = String(v ?? '').replace(/[^\d]/g, '');
    if (!digits) return null;
    if (digits.length < 8 || digits.length > 15) {
        throw new Error('wa_business_phone inválido. Debe contener 8 a 15 dígitos');
    }
    return digits;
}

function ensureArray(v: unknown): unknown[] {
    return Array.isArray(v) ? v : [];
}

function toResponseItem(row: CampaignRow) {
    const llmPolicy = isObject(row.llm_policy) ? row.llm_policy : {};
    const fallbackOps = isObject(llmPolicy.campaign_ops_settings) ? llmPolicy.campaign_ops_settings : null;

    return {
        id: row.id,
        tenant_id: row.tenant_id,
        code: row.code,
        name: row.name,
        is_active: row.is_active,
        inbound_enabled: row.inbound_enabled,
        inbound_default_mode: row.inbound_default_mode,
        inbound_llm_text_enabled: row.inbound_llm_text_enabled,
        llm_fallback_to_human: row.llm_fallback_to_human,
        wa_instance: row.wa_instance,
        wa_business_phone: row.wa_business_phone,
        ops_settings: normalizeOpsSettings(row.ops_settings ?? fallbackOps),
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

async function createCampaign(
    body: CreateCampaignBody,
    tenantId: string,
    token: string,
): Promise<{ row: CampaignRow | null; usedLlmPolicyFallback: boolean }> {
    const baseUrl = env('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
    const code = strOrEmpty(body.code);
    const name = strOrEmpty(body.name);
    if (!code || !name) {
        throw new Error('code y name son obligatorios');
    }

    const inboundDefaultMode = body.inbound_default_mode === 'llm' ? 'llm' : 'human';
    const waBusinessPhone = ensureDigitsPhone(body.wa_business_phone);

    const llmPolicy = isObject(body.llm_policy) ? body.llm_policy : {};
    const nextOps = normalizeOpsSettings(body.ops_settings);

    if (!CHANNEL_SET.has(nextOps.primary_channel)) {
        throw new Error('ops_settings.primary_channel inválido');
    }

    const insertBody: Record<string, unknown> = {
        tenant_id: tenantId,
        code,
        name,
        is_active: body.is_active !== false,
        description: String(body.description ?? ''),
        objective: String(body.objective ?? ''),
        success_criteria: String(body.success_criteria ?? ''),
        target_audience: String(body.target_audience ?? ''),
        llm_policy: llmPolicy,
        llm_system_prompt: String(body.llm_system_prompt ?? ''),
        qualification_fields: ensureArray(body.qualification_fields),
        allowed_intents: ensureArray(body.allowed_intents),
        disallowed_topics: ensureArray(body.disallowed_topics),
        closing_reasons: ensureArray(body.closing_reasons),
        opening_script: String(body.opening_script ?? ''),
        opening_question: String(body.opening_question ?? ''),
        inbound_enabled: body.inbound_enabled !== false,
        inbound_default_mode: inboundDefaultMode,
        inbound_llm_text_enabled: body.inbound_llm_text_enabled === true,
        llm_model: optionalTrimmed(body.llm_model),
        llm_fallback_to_human: body.llm_fallback_to_human !== false,
        wa_instance: optionalTrimmed(body.wa_instance),
        wa_business_phone: waBusinessPhone,
        ops_settings: nextOps,
    };

    const endpoint = `${baseUrl}/rest/v1/campaigns`;

    let res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            ...authHeaders(token),
            Prefer: 'return=representation',
        },
        body: JSON.stringify(insertBody),
        cache: 'no-store',
    });

    if (!res.ok) {
        const details = await res.text().catch(() => '');
        if (!details.includes('ops_settings does not exist')) {
            throw new Error(`PostgREST create campaign failed (${res.status}): ${details}`);
        }

        const fallbackBody: Record<string, unknown> = {
            ...insertBody,
            llm_policy: {
                ...llmPolicy,
                campaign_ops_settings: nextOps,
            },
        };
        delete fallbackBody.ops_settings;

        res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                ...authHeaders(token),
                Prefer: 'return=representation',
            },
            body: JSON.stringify(fallbackBody),
            cache: 'no-store',
        });

        if (!res.ok) {
            const fallbackDetails = await res.text().catch(() => '');
            throw new Error(`PostgREST create campaign fallback failed (${res.status}): ${fallbackDetails}`);
        }

        const rows = (await res.json().catch(() => [])) as CampaignRow[];
        return { row: rows?.[0] ?? null, usedLlmPolicyFallback: true };
    }

    const rows = (await res.json().catch(() => [])) as CampaignRow[];
    return { row: rows?.[0] ?? null, usedLlmPolicyFallback: false };
}

export async function POST(req: Request) {
    try {
        const token = extractBearerToken(req);
        if (!token) return json(401, { error: 'Missing Bearer token' });

        const tenant = await resolveTenantFromRequest(req, { fallbackEnabled: false });
        const role = normalizeRole(tenant.role);
        if (!tenant?.tenantId || !role) return json(403, { error: 'No active tenant context' });
        if (!canPerform(role, 'campaigns', 'create')) return json(403, { error: 'Forbidden: campaigns create required' });

        const body = (await req.json().catch(() => ({}))) as CreateCampaignBody;
        const { row, usedLlmPolicyFallback } = await createCampaign(body, tenant.tenantId, token);

        if (!row) return json(500, { error: 'No campaign returned after create' });

        return json(201, {
            item: toResponseItem(row),
            meta: {
                onboarding_provisioned: true,
                storage_fallback: usedLlmPolicyFallback ? 'llm_policy.campaign_ops_settings' : 'ops_settings',
            },
        });
    } catch (e: unknown) {
        return json(500, { error: e instanceof Error ? e.message : 'Unexpected error' });
    }
}

