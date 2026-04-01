type InsertLeadActivityEventInput = {
    tenantId: string;
    leadId: string;
    campaignId?: string | null;
    eventType: string;
    eventAt?: string | null;
    actorUserId?: string | null;
    actorLabel?: string | null;
    source?: string | null;
    payload?: Record<string, unknown>;
};

function pickKey() {
    return (
        process.env.SUPABASE_ANON_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        ''
    ).trim();
}

function authHeaders(token: string) {
    const key = pickKey();
    if (!key) throw new Error('Missing SUPABASE key for lead activity events');

    return {
        apikey: key,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Accept-Profile': 'contact_center',
        'Content-Profile': 'contact_center',
        'Content-Type': 'application/json',
    };
}

export async function insertLeadActivityEvents(args: {
    baseUrl: string;
    token: string;
    events: InsertLeadActivityEventInput[];
}) {
    const events = Array.isArray(args.events) ? args.events : [];
    if (!events.length) return;

    const rows = events
        .map((ev) => {
            const eventType = String(ev.eventType || '').trim();
            const source = String(ev.source || 'system').trim();
            if (!ev.tenantId || !ev.leadId || !eventType || !source) return null;

            return {
                tenant_id: ev.tenantId,
                lead_id: ev.leadId,
                campaign_id: ev.campaignId || null,
                event_type: eventType,
                event_at: ev.eventAt || new Date().toISOString(),
                actor_user_id: ev.actorUserId || null,
                actor_label: ev.actorLabel || null,
                source,
                payload: ev.payload && typeof ev.payload === 'object' ? ev.payload : {},
            };
        })
        .filter((r): r is NonNullable<typeof r> => !!r);

    if (!rows.length) return;

    const endpoint = `${args.baseUrl.replace(/\/+$/, '')}/rest/v1/lead_activity_events`;
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            ...authHeaders(args.token),
            Prefer: 'return=minimal',
        },
        body: JSON.stringify(rows),
        cache: 'no-store',
    });

    if (!res.ok) {
        const details = await res.text().catch(() => '');
        throw new Error(`PostgREST lead_activity_events insert failed (${res.status}): ${details}`);
    }
}

