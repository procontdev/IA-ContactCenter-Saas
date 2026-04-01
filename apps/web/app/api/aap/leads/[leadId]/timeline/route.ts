import { NextResponse } from 'next/server';
import { canPerform } from '@/lib/permissions/access-control';
import { resolveTenantFromRequest } from '@/lib/tenant/tenant-request';
import { extractBearerToken } from '@/lib/tenant/tenant-rpc-server';
import type { UserRole } from '@/lib/tenant/tenant-types';

type LeadRow = {
    id: string;
    tenant_id: string;
    campaign_id: string | null;
    source_id: string | null;
    channel: string | null;
    created_at: string | null;
};

type TimelineRow = {
    id: string;
    tenant_id: string;
    lead_id: string;
    campaign_id: string | null;
    event_type: string;
    event_at: string;
    actor_user_id: string | null;
    actor_label: string | null;
    source: string;
    payload: Record<string, unknown> | null;
    created_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export async function GET(req: Request, ctx: { params: Promise<{ leadId: string }> }) {
    try {
        const token = extractBearerToken(req);
        if (!token) return json(401, { error: 'Missing Bearer token' });

        const tenant = await resolveTenantFromRequest(req, { fallbackEnabled: false });
        const role = normalizeRole(tenant.role);
        if (!tenant?.tenantId || !role) return json(403, { error: 'No active tenant context' });
        if (!canPerform(role, 'leads', 'read')) return json(403, { error: 'Forbidden: leads read required' });

        const params = await ctx.params;
        const leadId = String(params?.leadId || '').trim();
        if (!UUID_RE.test(leadId)) return json(400, { error: 'leadId must be a valid UUID' });

        const requestUrl = new URL(req.url);
        const requestedLimit = Number(requestUrl.searchParams.get('limit') || 50);
        const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 50;

        const baseUrl = env('NEXT_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');

        const leadParams = new URLSearchParams({
            select: 'id,tenant_id,campaign_id,source_id,channel,created_at',
            id: `eq.${leadId}`,
            tenant_id: `eq.${tenant.tenantId}`,
            limit: '1',
        });

        const leadRes = await fetch(`${baseUrl}/rest/v1/leads?${leadParams.toString()}`, {
            method: 'GET',
            headers: authHeaders(token),
            cache: 'no-store',
        });

        if (!leadRes.ok) {
            const details = await leadRes.text().catch(() => '');
            return json(leadRes.status, { error: 'PostgREST lead lookup failed', details });
        }

        const leadRows = (await leadRes.json().catch(() => [])) as LeadRow[];
        const lead = leadRows?.[0] ?? null;
        if (!lead) return json(404, { error: 'Lead not found in active tenant' });

        const eventsParams = new URLSearchParams({
            select: 'id,tenant_id,lead_id,campaign_id,event_type,event_at,actor_user_id,actor_label,source,payload,created_at',
            tenant_id: `eq.${tenant.tenantId}`,
            lead_id: `eq.${leadId}`,
            order: 'event_at.desc,created_at.desc',
            limit: String(limit),
        });

        const eventsRes = await fetch(`${baseUrl}/rest/v1/lead_activity_events?${eventsParams.toString()}`, {
            method: 'GET',
            headers: authHeaders(token),
            cache: 'no-store',
        });

        if (!eventsRes.ok) {
            const details = await eventsRes.text().catch(() => '');
            const tableMissing = details.includes('lead_activity_events') && details.includes('does not exist');
            if (tableMissing) {
                return json(200, {
                    items: [],
                    meta: {
                        lead_id: leadId,
                        tenant_id: tenant.tenantId,
                        count: 0,
                        degraded: 'lead_activity_events table is missing (apply migration 0023)',
                    },
                });
            }
            return json(eventsRes.status, { error: 'PostgREST timeline query failed', details });
        }

        const items = (await eventsRes.json().catch(() => [])) as TimelineRow[];
        if (Array.isArray(items) && items.length > 0) {
            return json(200, {
                items,
                meta: {
                    lead_id: leadId,
                    tenant_id: tenant.tenantId,
                    count: items.length,
                },
            });
        }

        return json(200, {
            items: [
                {
                    id: `derived-${lead.id}`,
                    tenant_id: lead.tenant_id,
                    lead_id: lead.id,
                    campaign_id: lead.campaign_id,
                    event_type: 'lead.snapshot.legacy',
                    event_at: lead.created_at || new Date().toISOString(),
                    actor_user_id: null,
                    actor_label: null,
                    source: 'derived.lead.snapshot',
                    payload: {
                        note: 'Lead histórico sin eventos persistidos del timeline MVP',
                        source_id: lead.source_id,
                        channel: lead.channel,
                    },
                    created_at: lead.created_at || new Date().toISOString(),
                    derived: true,
                },
            ],
            meta: {
                lead_id: leadId,
                tenant_id: tenant.tenantId,
                count: 1,
                derived_fallback: true,
            },
        });
    } catch (e: unknown) {
        return json(500, { error: e instanceof Error ? e.message : 'Unexpected error' });
    }
}

