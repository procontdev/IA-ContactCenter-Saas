import { NextResponse } from 'next/server';
import { canPerform } from '@/lib/permissions/access-control';
import { extractBearerToken } from '@/lib/tenant/tenant-rpc-server';
import { resolveTenantFromRequest } from '@/lib/tenant/tenant-request';
import type { UserRole } from '@/lib/tenant/tenant-types';
import { CHANNEL_SET, isObject, normalizeOpsSettings, normalizeChannelList } from '@/lib/campaigns/provisioning';

type CampaignRow = {
    id: string;
    tenant_id: string;
    inbound_enabled: boolean;
    inbound_default_mode: 'human' | 'llm';
    inbound_llm_text_enabled: boolean;
    llm_fallback_to_human: boolean;
    wa_instance: string | null;
    wa_business_phone: string | null;
    ops_settings: Record<string, unknown> | null;
    llm_policy?: Record<string, unknown> | null;
    updated_at: string;
};

type PatchBody = {
    primary_channel?: string;
    enabled_channels?: string[];
    handoff?: Record<string, unknown>;
    flags?: Record<string, unknown>;
    inbound_enabled?: boolean;
    inbound_default_mode?: 'human' | 'llm';
    inbound_llm_text_enabled?: boolean;
    llm_fallback_to_human?: boolean;
    wa_instance?: string | null;
    wa_business_phone?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let HAS_OPS_SETTINGS_COLUMN: boolean | null = null;

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

function ensureUuid(id: string) {
    if (!UUID_RE.test(id)) {
        throw new Error('campaign id must be a valid UUID');
    }
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

async function fetchCampaignById(campaignId: string, tenantId: string, token: string): Promise<CampaignRow | null> {
    const baseUrl = env('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
    const selectWithOps =
        'id,tenant_id,inbound_enabled,inbound_default_mode,inbound_llm_text_enabled,llm_fallback_to_human,wa_instance,wa_business_phone,ops_settings,llm_policy,updated_at';
    const selectWithoutOps =
        'id,tenant_id,inbound_enabled,inbound_default_mode,inbound_llm_text_enabled,llm_fallback_to_human,wa_instance,wa_business_phone,llm_policy,updated_at';

    const select = HAS_OPS_SETTINGS_COLUMN === false ? selectWithoutOps : selectWithOps;
    const params = new URLSearchParams({
        select,
        id: `eq.${campaignId}`,
        tenant_id: `eq.${tenantId}`,
        limit: '1',
    });

    const res = await fetch(`${baseUrl}/rest/v1/campaigns?${params.toString()}`, {
        method: 'GET',
        headers: authHeaders(token),
        cache: 'no-store',
    });

    if (!res.ok) {
        const details = await res.text().catch(() => '');
        if (HAS_OPS_SETTINGS_COLUMN !== false && details.includes('ops_settings does not exist')) {
            HAS_OPS_SETTINGS_COLUMN = false;
            return fetchCampaignById(campaignId, tenantId, token);
        }
        throw new Error(`PostgREST GET campaigns failed (${res.status}): ${details}`);
    }

    if (HAS_OPS_SETTINGS_COLUMN === null) HAS_OPS_SETTINGS_COLUMN = true;

    const rows = (await res.json().catch(() => [])) as CampaignRow[];
    return rows?.[0] ?? null;
}

function toResponseItem(row: CampaignRow) {
    const llmPolicy = isObject(row.llm_policy) ? row.llm_policy : {};
    const fallbackOps = isObject(llmPolicy.campaign_ops_settings) ? llmPolicy.campaign_ops_settings : null;
    const opsRaw = row.ops_settings ?? fallbackOps;
    return {
        campaign_id: row.id,
        tenant_id: row.tenant_id,
        inbound_enabled: row.inbound_enabled,
        inbound_default_mode: row.inbound_default_mode,
        inbound_llm_text_enabled: row.inbound_llm_text_enabled,
        llm_fallback_to_human: row.llm_fallback_to_human,
        wa_instance: row.wa_instance,
        wa_business_phone: row.wa_business_phone,
        ops_settings: normalizeOpsSettings(opsRaw),
        updated_at: row.updated_at,
    };
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const token = extractBearerToken(req);
        if (!token) return json(401, { error: 'Missing Bearer token' });

        const { id } = await context.params;
        const campaignId = String(id || '').trim();
        ensureUuid(campaignId);

        const tenant = await resolveTenantFromRequest(req, { fallbackEnabled: false });
        const role = normalizeRole(tenant.role);
        if (!tenant?.tenantId || !role) return json(403, { error: 'No active tenant context' });
        if (!canPerform(role, 'campaigns', 'read')) return json(403, { error: 'Forbidden: campaigns read required' });

        const row = await fetchCampaignById(campaignId, tenant.tenantId, token);
        if (!row) return json(404, { error: 'Campaign not found in active tenant' });

        return json(200, { item: toResponseItem(row) });
    } catch (e: unknown) {
        return json(500, { error: e instanceof Error ? e.message : 'Unexpected error' });
    }
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const token = extractBearerToken(req);
        if (!token) return json(401, { error: 'Missing Bearer token' });

        const { id } = await context.params;
        const campaignId = String(id || '').trim();
        ensureUuid(campaignId);

        const tenant = await resolveTenantFromRequest(req, { fallbackEnabled: false });
        const role = normalizeRole(tenant.role);
        if (!tenant?.tenantId || !role) return json(403, { error: 'No active tenant context' });
        if (!canPerform(role, 'campaigns', 'update')) return json(403, { error: 'Forbidden: campaigns update required' });

        const body = (await req.json().catch(() => ({}))) as PatchBody;
        const current = await fetchCampaignById(campaignId, tenant.tenantId, token);
        if (!current) return json(404, { error: 'Campaign not found in active tenant' });

        const currentLlmPolicy = isObject(current.llm_policy) ? current.llm_policy : {};
        const fallbackOps = isObject(currentLlmPolicy.campaign_ops_settings) ? currentLlmPolicy.campaign_ops_settings : null;
        const nextOps = normalizeOpsSettings(current.ops_settings ?? fallbackOps);

        if (Object.prototype.hasOwnProperty.call(body, 'primary_channel')) {
            const nextPrimary = String(body.primary_channel || '').trim().toLowerCase();
            if (!CHANNEL_SET.has(nextPrimary)) return json(400, { error: 'primary_channel inválido' });
            nextOps.primary_channel = nextPrimary;
            if (!nextOps.enabled_channels.includes(nextPrimary)) {
                nextOps.enabled_channels = [nextPrimary, ...nextOps.enabled_channels];
            }
        }

        if (Object.prototype.hasOwnProperty.call(body, 'enabled_channels')) {
            const channels = normalizeChannelList(body.enabled_channels);
            if (channels.length === 0) return json(400, { error: 'enabled_channels debe incluir al menos 1 canal válido' });
            nextOps.enabled_channels = channels;
            if (!channels.includes(nextOps.primary_channel)) {
                nextOps.primary_channel = channels[0];
            }
        }

        if (Object.prototype.hasOwnProperty.call(body, 'handoff')) {
            if (!isObject(body.handoff)) return json(400, { error: 'handoff must be an object' });
            nextOps.handoff = {
                ...nextOps.handoff,
                ...body.handoff,
            };
            nextOps.handoff = normalizeOpsSettings({ handoff: nextOps.handoff }).handoff;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'flags')) {
            if (!isObject(body.flags)) return json(400, { error: 'flags must be an object' });
            nextOps.flags = {
                ...nextOps.flags,
                ...body.flags,
            };
            nextOps.flags = normalizeOpsSettings({ flags: nextOps.flags }).flags;
        }

        const patchBody: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
            tenant_id: tenant.tenantId,
        };

        if (HAS_OPS_SETTINGS_COLUMN === false) {
            patchBody.llm_policy = {
                ...currentLlmPolicy,
                campaign_ops_settings: nextOps,
            };
        } else {
            patchBody.ops_settings = nextOps;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'inbound_enabled')) patchBody.inbound_enabled = body.inbound_enabled === true;
        if (Object.prototype.hasOwnProperty.call(body, 'inbound_default_mode')) {
            if (body.inbound_default_mode !== 'human' && body.inbound_default_mode !== 'llm') {
                return json(400, { error: 'inbound_default_mode inválido. Usa human o llm' });
            }
            patchBody.inbound_default_mode = body.inbound_default_mode;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'inbound_llm_text_enabled')) {
            patchBody.inbound_llm_text_enabled = body.inbound_llm_text_enabled === true;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'llm_fallback_to_human')) {
            patchBody.llm_fallback_to_human = body.llm_fallback_to_human === true;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'wa_instance')) {
            const nextInstance = String(body.wa_instance || '').trim();
            patchBody.wa_instance = nextInstance || null;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'wa_business_phone')) {
            const digits = String(body.wa_business_phone || '').replace(/[^\d]/g, '');
            if (digits && (digits.length < 8 || digits.length > 15)) {
                return json(400, { error: 'wa_business_phone inválido. Debe contener 8 a 15 dígitos' });
            }
            patchBody.wa_business_phone = digits || null;
        }

        const baseUrl = env('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
        const query = new URLSearchParams({ id: `eq.${campaignId}`, tenant_id: `eq.${tenant.tenantId}` });
        const res = await fetch(`${baseUrl}/rest/v1/campaigns?${query.toString()}`, {
            method: 'PATCH',
            headers: {
                ...authHeaders(token),
                Prefer: 'return=representation',
            },
            body: JSON.stringify(patchBody),
            cache: 'no-store',
        });

        if (!res.ok) {
            const details = await res.text().catch(() => '');
            return json(res.status, { error: 'PostgREST PATCH campaigns failed', details });
        }

        const rows = (await res.json().catch(() => [])) as CampaignRow[];
        const row = rows?.[0] ?? null;
        if (!row) return json(500, { error: 'No campaign returned after update' });

        return json(200, { item: toResponseItem(row) });
    } catch (e: unknown) {
        return json(500, { error: e instanceof Error ? e.message : 'Unexpected error' });
    }
}

