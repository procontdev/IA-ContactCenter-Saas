#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function loadEnv(filePath) {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const idx = t.indexOf('=');
        if (idx < 0) continue;
        const key = t.slice(0, idx).trim();
        const val = t.slice(idx + 1).trim();
        if (!(key in process.env)) process.env[key] = val;
    }
}

async function reqJson(url, init) {
    const res = await fetch(url, init);
    const txt = await res.text();
    let body = null;
    try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
    return { ok: res.ok, status: res.status, body };
}

async function login(baseUrl, anonKey, email, password) {
    const res = await reqJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok || !res.body?.access_token) throw new Error(`Login failed ${email}`);
    return String(res.body.access_token);
}

function h(token) {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function short(v) {
    return JSON.stringify(v).slice(0, 260);
}

async function fetchActor(baseUrl, anonKey, token) {
    const res = await reqJson(`${baseUrl}/auth/v1/user`, {
        method: 'GET',
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    return String(res.body?.id || '').trim() || null;
}

async function main() {
    loadEnv(path.resolve('.env.antigravity.local'));
    loadEnv(path.resolve('.env'));

    const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
    const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
    const adminEmail = String(process.env.DEMO_ADMIN_EMAIL || 'demo.admin@local.test');
    const adminPassword = String(process.env.DEMO_ADMIN_PASSWORD || 'DemoAdmin123!');

    const out = [];
    const adminToken = await login(supabaseUrl, anonKey, adminEmail, adminPassword);
    const actorId = await fetchActor(supabaseUrl, anonKey, adminToken);

    const campaignsRes = await reqJson(
        `${supabaseUrl}/rest/v1/campaigns?select=id,tenant_id&order=created_at.desc&limit=1`,
        { method: 'GET', headers: { apikey: anonKey, Authorization: `Bearer ${adminToken}`, 'Accept-Profile': 'contact_center' } }
    );
    const campaign = campaignsRes.body?.[0];
    if (!campaign?.id) throw new Error('No campaign found for validation');

    const seed = Date.now();
    const sourceId = `VAL-TL-${seed}`;

    const intake1 = await reqJson(`${appBaseUrl}/api/leads/intake`, {
        method: 'POST',
        headers: h(adminToken),
        body: JSON.stringify({
            items: [{
                campaign_id: campaign.id,
                source_id: sourceId,
                source: 'meta_ads',
                origin: 'landing_form',
                channel: 'web',
                phone: '999771111',
                email: `lead.val.timeline.${seed}@mailinator.com`,
                metadata: { smoke: true, lane: 'validate-lead-activity-timeline' },
            }],
        }),
    });

    const leadId = intake1.body?.items?.[0]?.id;
    out.push({
        check: 'A.intake_create',
        endpoint: '/api/leads/intake',
        status: intake1.status,
        pass: intake1.ok && !!leadId,
        snippet: short(intake1.body?.meta || intake1.body),
    });

    const intake2 = await reqJson(`${appBaseUrl}/api/leads/intake`, {
        method: 'POST',
        headers: h(adminToken),
        body: JSON.stringify({
            items: [{
                campaign_id: campaign.id,
                source_id: sourceId,
                source: 'meta_ads',
                origin: 'landing_form',
                channel: 'web',
                phone: '999771111',
                email: `lead.val.timeline.${seed}@mailinator.com`,
                metadata: { smoke: true, lane: 'validate-lead-activity-timeline-merge' },
            }],
        }),
    });
    out.push({
        check: 'B.intake_merge',
        endpoint: '/api/leads/intake',
        status: intake2.status,
        pass: intake2.ok,
        snippet: short(intake2.body?.meta || intake2.body),
    });

    const assign = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: h(adminToken),
        body: JSON.stringify({ lead_id: leadId, operation: 'assign', assignee_user_id: actorId }),
    });
    out.push({
        check: 'C.assignment',
        endpoint: '/api/aap/leads/work-queue/assign',
        status: assign.status,
        pass: assign.ok && !!assign.body?.item,
        snippet: short({ work_status: assign.body?.item?.work_status, assignee: assign.body?.item?.work_assignee_user_id }),
    });

    const takeover = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: h(adminToken),
        body: JSON.stringify({ lead_id: leadId, operation: 'takeover_take' }),
    });
    out.push({
        check: 'D.takeover_take',
        endpoint: '/api/aap/leads/work-queue/assign',
        status: takeover.status,
        pass: takeover.ok && takeover.body?.item?.human_takeover_status === 'taken',
        snippet: short({ status: takeover.body?.item?.human_takeover_status, by: takeover.body?.item?.human_takeover_by_label }),
    });

    const setStatus = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: h(adminToken),
        body: JSON.stringify({ lead_id: leadId, operation: 'set_status', work_status: 'in_progress' }),
    });
    out.push({
        check: 'E.status_change',
        endpoint: '/api/aap/leads/work-queue/assign',
        status: setStatus.status,
        pass: setStatus.ok && setStatus.body?.item?.work_status === 'in_progress',
        snippet: short({ work_status: setStatus.body?.item?.work_status }),
    });

    const takeoverRelease = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: h(adminToken),
        body: JSON.stringify({ lead_id: leadId, operation: 'takeover_release' }),
    });
    out.push({
        check: 'F.takeover_release',
        endpoint: '/api/aap/leads/work-queue/assign',
        status: takeoverRelease.status,
        pass: takeoverRelease.ok && takeoverRelease.body?.item?.human_takeover_status === 'released',
        snippet: short({ status: takeoverRelease.body?.item?.human_takeover_status, released_at: takeoverRelease.body?.item?.human_takeover_released_at }),
    });

    const takeoverClose = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: h(adminToken),
        body: JSON.stringify({ lead_id: leadId, operation: 'takeover_close' }),
    });
    out.push({
        check: 'G.takeover_close',
        endpoint: '/api/aap/leads/work-queue/assign',
        status: takeoverClose.status,
        pass: takeoverClose.ok && takeoverClose.body?.item?.human_takeover_status === 'closed',
        snippet: short({ status: takeoverClose.body?.item?.human_takeover_status, closed_at: takeoverClose.body?.item?.human_takeover_closed_at }),
    });

    const timeline = await reqJson(`${appBaseUrl}/api/aap/leads/${encodeURIComponent(leadId)}/timeline?limit=120`, {
        method: 'GET',
        headers: h(adminToken),
    });

    const timelineItems = Array.isArray(timeline.body?.items) ? timeline.body.items : [];
    const eventTypes = timelineItems.map((it) => String(it.event_type || ''));
    const hasCreate = eventTypes.includes('lead.intake.created');
    const hasMerge = eventTypes.includes('lead.intake.merged');
    const hasAssign = eventTypes.includes('lead.assignment.assigned');
    const hasRouting = eventTypes.includes('lead.qualification.routed');
    const hasTakeover = eventTypes.includes('lead.takeover.taken');
    const hasStatus = eventTypes.includes('lead.work.status_changed');
    const hasTakeoverRelease = eventTypes.includes('lead.takeover.released');
    const hasTakeoverClose = eventTypes.includes('lead.takeover.closed');
    out.push({
        check: 'H.timeline_read_order_payload',
        endpoint: '/api/aap/leads/[leadId]/timeline',
        status: timeline.status,
        pass: timeline.ok && hasCreate && hasMerge && hasRouting && hasAssign && hasStatus && hasTakeover && hasTakeoverRelease && hasTakeoverClose,
        snippet: short({ count: timelineItems.length, first_types: eventTypes.slice(0, 8) }),
    });

    const noToken = await reqJson(`${appBaseUrl}/api/aap/leads/${encodeURIComponent(leadId)}/timeline`, {
        method: 'GET',
    });
    out.push({
        check: 'I.role_guardrail_missing_token',
        endpoint: '/api/aap/leads/[leadId]/timeline',
        status: noToken.status,
        pass: noToken.status === 401,
        snippet: short(noToken.body),
    });

    const outScope = await reqJson(`${appBaseUrl}/api/aap/leads/11111111-1111-4111-8111-111111111111/timeline`, {
        method: 'GET',
        headers: h(adminToken),
    });
    out.push({
        check: 'J.scope_guardrail',
        endpoint: '/api/aap/leads/[leadId]/timeline',
        status: outScope.status,
        pass: outScope.status === 404,
        snippet: short(outScope.body),
    });

    console.log(JSON.stringify({ pass: out.every((x) => x.pass), checks: out }, null, 2));
}

main().catch((e) => {
    console.error(e?.stack || String(e));
    process.exit(1);
});

