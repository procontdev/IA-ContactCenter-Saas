import { NextResponse } from 'next/server';
import { canPerform } from '@/lib/permissions/access-control';
import { mergeLeadFields, pickDedupMatchKind, type DedupMatchKind } from '@/lib/leads/dedup-policy';
import { buildIntakeRaw, normalizeLeadIntake } from '@/lib/leads/intake-normalizer';
import { resolveTenantFromRequest } from '@/lib/tenant/tenant-request';
import { extractBearerToken } from '@/lib/tenant/tenant-rpc-server';
import type { UserRole } from '@/lib/tenant/tenant-types';

type IntakeItem = {
    campaign_id?: string;
    campaign_code?: string;
    campaign?: string;

    source_id?: string;
    form_id?: string;
    email?: string | null;
    source?: string;
    origin?: string;
    channel?: string;

    fecha?: string | null;
    phone?: string | null;

    queue_start?: string | null;
    queue_end?: string | null;
    estado_cliente?: string | null;
    estado_usuario?: string | null;
    usuario?: string | null;
    extension?: string | null;
    duracion_sec?: number | null;
    call_state_general?: string | null;
    call_state?: string | null;
    sale_state_general?: string | null;
    sale_state?: string | null;
    depto?: string | null;
    provincia?: string | null;
    distrito?: string | null;

    raw?: unknown;
    metadata?: unknown;
};

type CampaignRow = {
    id: string;
    code: string;
    tenant_id: string;
};

type ExistingLeadRow = {
    id: string;
    tenant_id: string;
    campaign_id: string | null;
    source_id: string | null;
    form_id: string | null;
    phone: string | null;
    phone_norm: string | null;
    email: string | null;
    email_norm: string | null;
    raw: unknown;
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

function toArray(body: unknown): IntakeItem[] {
    if (Array.isArray((body as { items?: unknown[] } | null)?.items)) return ((body as { items: unknown[] }).items as IntakeItem[]);

    const item = (body as { item?: unknown } | null)?.item;
    if (item && typeof item === 'object') return [item as IntakeItem];

    if (typeof body === 'object' && body && !Array.isArray(body)) return [body as IntakeItem];
    return [];
}

async function fetchCampaignById(baseUrl: string, token: string, tenantId: string, campaignId: string): Promise<CampaignRow | null> {
    const params = new URLSearchParams();
    params.set('select', 'id,code,tenant_id');
    params.set('id', `eq.${campaignId}`);
    params.set('tenant_id', `eq.${tenantId}`);
    params.set('limit', '1');

    const res = await fetch(`${baseUrl}/rest/v1/campaigns?${params.toString()}`, {
        method: 'GET',
        headers: authHeaders(token),
        cache: 'no-store',
    });

    if (!res.ok) throw new Error(`Error consultando campaign_id (${res.status})`);
    const rows = (await res.json().catch(() => [])) as CampaignRow[];
    return rows?.[0] ?? null;
}

async function fetchCampaignByCode(baseUrl: string, token: string, tenantId: string, code: string): Promise<CampaignRow | null> {
    const params = new URLSearchParams();
    params.set('select', 'id,code,tenant_id');
    params.set('code', `eq.${code}`);
    params.set('tenant_id', `eq.${tenantId}`);
    params.set('limit', '1');

    const res = await fetch(`${baseUrl}/rest/v1/campaigns?${params.toString()}`, {
        method: 'GET',
        headers: authHeaders(token),
        cache: 'no-store',
    });

    if (!res.ok) throw new Error(`Error consultando campaign_code (${res.status})`);
    const rows = (await res.json().catch(() => [])) as CampaignRow[];
    return rows?.[0] ?? null;
}

async function fetchExistingLeadByKey(
    baseUrl: string,
    token: string,
    tenantId: string,
    campaignId: string,
    input: { source_id: string | null; email_norm: string | null; phone_norm: string | null }
): Promise<{ row: ExistingLeadRow | null; matchKind: DedupMatchKind }> {
    const matchKind = pickDedupMatchKind(input);
    if (matchKind === 'none') return { row: null, matchKind };

    const requestByKind = async (kind: DedupMatchKind, includeEmailColumns: boolean) => {
        const select = includeEmailColumns
            ? 'id,tenant_id,campaign_id,source_id,form_id,phone,phone_norm,email,email_norm,raw'
            : 'id,tenant_id,campaign_id,source_id,form_id,phone,phone_norm,raw';

        const params = new URLSearchParams();
        params.set('select', select);
        params.set('tenant_id', `eq.${tenantId}`);
        params.set('campaign_id', `eq.${campaignId}`);
        params.set('limit', '1');
        params.set('order', 'updated_at.desc');

        if (kind === 'source_id') {
            params.set('source_id', `eq.${input.source_id}`);
        } else if (kind === 'email_norm') {
            params.set('email_norm', `eq.${input.email_norm}`);
        } else if (kind === 'phone_norm') {
            params.set('phone_norm', `eq.${input.phone_norm}`);
        }

        const res = await fetch(`${baseUrl}/rest/v1/leads?${params.toString()}`, {
            method: 'GET',
            headers: authHeaders(token),
            cache: 'no-store',
        });

        if (!res.ok) {
            const details = await res.text().catch(() => '');
            return { ok: false as const, details, rows: [] as ExistingLeadRow[] };
        }

        const rows = (await res.json().catch(() => [])) as ExistingLeadRow[];
        const normalizedRows = rows.map((row) => ({
            ...row,
            email: row.email ?? null,
            email_norm: row.email_norm ?? null,
        }));

        return { ok: true as const, details: '', rows: normalizedRows };
    };

    const firstTry = await requestByKind(matchKind, true);
    if (firstTry.ok) {
        return { row: firstTry.rows?.[0] ?? null, matchKind };
    }

    const emailColumnMissing =
        firstTry.details.toLowerCase().includes('email') && firstTry.details.toLowerCase().includes('column');
    if (!emailColumnMissing) {
        throw new Error(`Error consultando lead dedup (400): ${firstTry.details}`);
    }

    if (matchKind === 'email_norm' && input.phone_norm) {
        const fallbackPhone = await requestByKind('phone_norm', false);
        if (!fallbackPhone.ok) throw new Error(`Error consultando lead dedup (400): ${fallbackPhone.details}`);
        return { row: fallbackPhone.rows?.[0] ?? null, matchKind: 'phone_norm' };
    }

    if (matchKind === 'email_norm' && !input.phone_norm) {
        return { row: null, matchKind: 'none' };
    }

    const fallback = await requestByKind(matchKind, false);
    if (!fallback.ok) throw new Error(`Error consultando lead dedup (400): ${fallback.details}`);
    return { row: fallback.rows?.[0] ?? null, matchKind };
}

async function detectLeadEmailColumnsSupport(baseUrl: string, token: string): Promise<boolean> {
    const params = new URLSearchParams();
    params.set('select', 'id,email_norm');
    params.set('limit', '1');

    const res = await fetch(`${baseUrl}/rest/v1/leads?${params.toString()}`, {
        method: 'GET',
        headers: authHeaders(token),
        cache: 'no-store',
    });

    if (res.ok) return true;

    const details = (await res.text().catch(() => '')).toLowerCase();
    if (details.includes('email_norm') && details.includes('column')) return false;

    throw new Error(`Error validando columnas email en leads (${res.status})`);
}

export async function POST(req: Request) {
    try {
        const token = extractBearerToken(req);
        if (!token) return json(401, { error: 'Missing Bearer token' });

        const tenant = await resolveTenantFromRequest(req, { fallbackEnabled: false });
        const role = normalizeRole(tenant.role);
        if (!tenant?.tenantId || !role) return json(403, { error: 'No active tenant context' });
        if (!canPerform(role, 'leads', 'create')) return json(403, { error: 'Forbidden: leads create required' });

        const body = await req.json().catch(() => ({}));
        const items = toArray(body);
        if (!items.length) return json(400, { error: 'No intake items provided' });
        if (items.length > 500) return json(400, { error: 'Batch too large (max 500)' });

        const baseUrl = env('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
        const nowIso = new Date().toISOString();
        const emailColumnsSupported = await detectLeadEmailColumnsSupport(baseUrl, token);

        const rowsToInsert: Record<string, unknown>[] = [];
        const rowsToMergeById: Record<string, unknown>[] = [];

        for (const item of items) {
            const preferredCampaignId = String(item?.campaign_id || '').trim();
            const preferredCampaignCode = String(item?.campaign_code || item?.campaign || '').trim();

            let campaign: CampaignRow | null = null;
            if (preferredCampaignId) {
                campaign = await fetchCampaignById(baseUrl, token, tenant.tenantId, preferredCampaignId);
            }
            if (!campaign && preferredCampaignCode) {
                campaign = await fetchCampaignByCode(baseUrl, token, tenant.tenantId, preferredCampaignCode);
            }
            if (!campaign) {
                return json(400, {
                    error: 'Campaign not found in tenant scope',
                    detail: { campaign_id: preferredCampaignId || null, campaign_code: preferredCampaignCode || null },
                });
            }

            const normalized = normalizeLeadIntake({
                source_id: item.source_id,
                form_id: item.form_id,
                email: item.email,
                source: item.source,
                origin: item.origin,
                channel: item.channel,
                phone: item.phone,
            });

            const intakeRaw = buildIntakeRaw(item.raw, {
                source: normalized.source,
                origin: normalized.origin,
                channel: normalized.channel,
                metadata: item.metadata,
            });

            const existing = await fetchExistingLeadByKey(baseUrl, token, tenant.tenantId, campaign.id, {
                source_id: normalized.source_id,
                email_norm: normalized.email_norm,
                phone_norm: normalized.phone_norm,
            });

            const dedupMeta = {
                policy: 'lead-dedup-merge-mvp-v1',
                matched_by: existing.matchKind,
                matched_lead_id: existing.row?.id ?? null,
                dedup_at: nowIso,
            };

            const intakeRawWithDedup = {
                ...intakeRaw,
                dedup: dedupMeta,
            };

            const basePayload = {
                tenant_id: tenant.tenantId,
                campaign_id: campaign.id,
                campaign: campaign.code,
                source_id: normalized.source_id,
                form_id: normalized.form_id,
                phone: normalized.phone,
                phone_norm: normalized.phone_norm,
                channel: normalized.channel,
                fecha: item.fecha || null,
                queue_start: item.queue_start ?? null,
                queue_end: item.queue_end ?? null,
                estado_cliente: item.estado_cliente ?? null,
                estado_usuario: item.estado_usuario ?? null,
                usuario: item.usuario ?? null,
                extension: item.extension ?? null,
                duracion_sec: typeof item.duracion_sec === 'number' ? item.duracion_sec : 0,
                call_state_general: item.call_state_general ?? null,
                call_state: item.call_state ?? null,
                sale_state_general: item.sale_state_general ?? null,
                sale_state: item.sale_state ?? null,
                depto: item.depto ?? null,
                provincia: item.provincia ?? null,
                distrito: item.distrito ?? null,
                updated_at: nowIso,
                raw: intakeRawWithDedup,
            };

            const basePayloadWithOptionalEmail = emailColumnsSupported
                ? {
                    ...basePayload,
                    email: normalized.email,
                    email_norm: normalized.email_norm,
                }
                : basePayload;

            if (existing.row?.id) {
                const merged = mergeLeadFields(existing.row, {
                    source_id: normalized.source_id,
                    form_id: normalized.form_id,
                    phone: normalized.phone,
                    phone_norm: normalized.phone_norm,
                    email: normalized.email,
                    email_norm: normalized.email_norm,
                    raw: buildIntakeRaw(existing.row.raw, {
                        source: normalized.source,
                        origin: normalized.origin,
                        channel: normalized.channel,
                        metadata: {
                            incoming_metadata: item.metadata ?? null,
                            dedup: dedupMeta,
                        },
                    }),
                });

                rowsToMergeById.push({
                    ...basePayloadWithOptionalEmail,
                    id: existing.row.id,
                    source_id: merged.source_id,
                    form_id: merged.form_id,
                    phone: merged.phone,
                    phone_norm: merged.phone_norm,
                    ...(emailColumnsSupported ? { email: merged.email, email_norm: merged.email_norm } : {}),
                    raw: merged.raw,
                });
            } else {
                rowsToInsert.push(basePayloadWithOptionalEmail);
            }
        }

        const select = emailColumnsSupported
            ? 'id,tenant_id,campaign_id,campaign,source_id,form_id,channel,phone,phone_norm,email,email_norm,created_at,updated_at,raw'
            : 'id,tenant_id,campaign_id,campaign,source_id,form_id,channel,phone,phone_norm,created_at,updated_at,raw';
        const saved: Array<Record<string, unknown>> = [];

        if (rowsToMergeById.length) {
            const params = new URLSearchParams();
            params.set('on_conflict', 'id');
            params.set('select', select);

            const mergeRes = await fetch(`${baseUrl}/rest/v1/leads?${params.toString()}`, {
                method: 'POST',
                headers: {
                    ...authHeaders(token),
                    Prefer: 'resolution=merge-duplicates,return=representation',
                },
                body: JSON.stringify(rowsToMergeById),
                cache: 'no-store',
            });

            if (!mergeRes.ok) {
                const details = await mergeRes.text().catch(() => '');
                return json(502, { error: 'PostgREST lead merge failed', details });
            }

            const mergedRows = (await mergeRes.json().catch(() => [])) as Array<Record<string, unknown>>;
            saved.push(...mergedRows);
        }

        if (rowsToInsert.length) {
            const params = new URLSearchParams();
            params.set('on_conflict', 'campaign_id,source_id');
            params.set('select', select);

            const insertRes = await fetch(`${baseUrl}/rest/v1/leads?${params.toString()}`, {
                method: 'POST',
                headers: {
                    ...authHeaders(token),
                    Prefer: 'resolution=merge-duplicates,return=representation',
                },
                body: JSON.stringify(rowsToInsert),
                cache: 'no-store',
            });

            if (!insertRes.ok) {
                const details = await insertRes.text().catch(() => '');
                return json(502, { error: 'PostgREST lead insert/upsert failed', details });
            }

            const insertedRows = (await insertRes.json().catch(() => [])) as Array<Record<string, unknown>>;
            saved.push(...insertedRows);
        }

        return json(201, {
            ok: true,
            items: saved,
            meta: {
                tenant_id: tenant.tenantId,
                count: saved.length,
                merged: rowsToMergeById.length,
                inserted: rowsToInsert.length,
                mapper: 'lead-intake-dedup-mvp-v1',
            },
        });
    } catch (e: unknown) {
        return json(500, { error: e instanceof Error ? e.message : 'Unexpected error' });
    }
}

