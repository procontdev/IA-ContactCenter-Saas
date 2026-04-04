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

async function createOrGetUser(baseUrl, serviceKey, email, password) {
    const createRes = await reqJson(`${baseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            user_metadata: { source: 'validate-lead-human-takeover-report' },
            app_metadata: { role: 'agent' },
        }),
    });
    if (createRes.ok && createRes.body?.id) return String(createRes.body.id);
    const listRes = await reqJson(`${baseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
        method: 'GET',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    const found = listRes.body?.users?.find((u) => String(u.email).toLowerCase() === email.toLowerCase());
    if (found?.id) return String(found.id);
    throw new Error('cannot create/get user');
}

function h(token) { return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }; }
function short(v) { return JSON.stringify(v).slice(0, 220); }

async function main() {
    loadEnv(path.resolve('.env.antigravity.local'));
    loadEnv(path.resolve('.env'));

    const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
    const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
    const adminEmail = String(process.env.DEMO_ADMIN_EMAIL || 'demo.admin@local.test');
    const adminPassword = String(process.env.DEMO_ADMIN_PASSWORD || 'DemoAdmin123!');

    const out = [];
    const adminToken = await login(supabaseUrl, anonKey, adminEmail, adminPassword);
    const campaignsRes = await reqJson(
        `${supabaseUrl}/rest/v1/campaigns?select=id,tenant_id&order=created_at.desc&limit=1`,
        { method: 'GET', headers: { apikey: anonKey, Authorization: `Bearer ${adminToken}`, 'Accept-Profile': 'contact_center' } }
    );
    const campaign = campaignsRes.body?.[0];

    const seed = Date.now();
    const intake = await reqJson(`${appBaseUrl}/api/leads/intake`, {
        method: 'POST',
        headers: h(adminToken),
        body: JSON.stringify({
            items: [{
                campaign_id: campaign.id,
                source_id: `VAL-HT-${seed}`,
                source: 'meta_ads',
                origin: 'landing_form',
                channel: 'web',
                phone: '999654323',
                email: `lead.val.take.${seed}@mailinator.com`,
                metadata: { smoke: true, lane: 'validate-lead-human-takeover' },
            }],
        }),
    });
    const leadId = intake.body?.items?.[0]?.id;

    const take = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST', headers: h(adminToken), body: JSON.stringify({ lead_id: leadId, operation: 'takeover_take' }),
    });
    out.push({
        check: 'A.takeover_take', endpoint: '/api/aap/leads/work-queue/assign', status: take.status,
        pass: take.ok && take.body?.item?.human_takeover_status === 'taken',
        snippet: short({ status: take.body?.item?.human_takeover_status, by: take.body?.item?.human_takeover_by_label, at: take.body?.item?.human_takeover_at, work_status: take.body?.item?.work_status }),
    });

    const release = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST', headers: h(adminToken), body: JSON.stringify({ lead_id: leadId, operation: 'takeover_release' }),
    });
    out.push({
        check: 'B.takeover_release', endpoint: '/api/aap/leads/work-queue/assign', status: release.status,
        pass: release.ok && release.body?.item?.human_takeover_status === 'released',
        snippet: short({ status: release.body?.item?.human_takeover_status, released_at: release.body?.item?.human_takeover_released_at, owner: release.body?.item?.work_assignee_user_id, work_status: release.body?.item?.work_status }),
    });

    const close = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST', headers: h(adminToken), body: JSON.stringify({ lead_id: leadId, operation: 'takeover_close' }),
    });
    out.push({
        check: 'C.takeover_close', endpoint: '/api/aap/leads/work-queue/assign', status: close.status,
        pass: close.ok && close.body?.item?.human_takeover_status === 'closed' && close.body?.item?.work_status === 'done',
        snippet: short({ status: close.body?.item?.human_takeover_status, closed_at: close.body?.item?.human_takeover_closed_at, work_status: close.body?.item?.work_status }),
    });

    const queue = await reqJson(`${appBaseUrl}/api/aap/leads/wow-queue?campaign_id=${encodeURIComponent(campaign.id)}&q=999654323&limit=50`, {
        method: 'GET', headers: h(adminToken),
    });
    const queueItem = Array.isArray(queue.body?.items) ? queue.body.items.find((it) => it.id === leadId) : null;
    out.push({
        check: 'D.wow_queue_continuidad', endpoint: '/api/aap/leads/wow-queue', status: queue.status,
        pass: queue.ok && !!queueItem && queueItem.human_takeover_status === 'closed' && queueItem.work_status === 'done',
        snippet: short({ takeover: queueItem?.human_takeover_status, work_status: queueItem?.work_status, owner: queueItem?.human_takeover_by_label || queueItem?.work_assignee_label }),
    });

    const outScope = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST', headers: h(adminToken), body: JSON.stringify({ lead_id: '11111111-1111-4111-8111-111111111111', operation: 'takeover_take' }),
    });
    out.push({
        check: 'E.scope_guardrail', endpoint: '/api/aap/leads/work-queue/assign', status: outScope.status,
        pass: outScope.status === 404,
        snippet: short(outScope.body),
    });

    if (serviceKey) {
        const tempEmail = `demo.take.role.${Date.now()}@local.test`;
        const tempPassword = 'DemoAgent123!';
        const tempUserId = await createOrGetUser(supabaseUrl, serviceKey, tempEmail, tempPassword);

        const addMember = await reqJson(`${appBaseUrl}/api/tenant/members`, {
            method: 'POST', headers: h(adminToken), body: JSON.stringify({ email: tempEmail, role: 'agent' }),
        });

        const agentToken = await login(supabaseUrl, anonKey, tempEmail, tempPassword);
        const roleAssign = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
            method: 'POST', headers: h(agentToken), body: JSON.stringify({ lead_id: leadId, operation: 'assign', assignee_user_id: tempUserId }),
        });
        out.push({
            check: 'E.role_guardrail_assign', endpoint: '/api/aap/leads/work-queue/assign', status: roleAssign.status,
            pass: roleAssign.status === 403,
            snippet: short(roleAssign.body),
        });

        const seed2 = Date.now();
        const intake2 = await reqJson(`${appBaseUrl}/api/leads/intake`, {
            method: 'POST',
            headers: h(adminToken),
            body: JSON.stringify({
                items: [{
                    campaign_id: campaign.id,
                    source_id: `VAL-HT-AG-${seed2}`,
                    source: 'meta_ads',
                    origin: 'landing_form',
                    channel: 'web',
                    phone: '999654324',
                    email: `lead.val.take.agent.${seed2}@mailinator.com`,
                    metadata: { smoke: true, lane: 'validate-lead-human-takeover-agent' },
                }],
            }),
        });
        const leadAgent = intake2.body?.items?.[0]?.id;

        const roleTake = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
            method: 'POST', headers: h(agentToken), body: JSON.stringify({ lead_id: leadAgent, operation: 'takeover_take' }),
        });
        out.push({
            check: 'E.role_takeover_agent', endpoint: '/api/aap/leads/work-queue/assign', status: roleTake.status,
            pass: roleTake.status === 200 && roleTake.body?.item?.human_takeover_status === 'taken',
            snippet: short({ status: roleTake.body?.item?.human_takeover_status, by: roleTake.body?.item?.human_takeover_by_label }),
        });

        await reqJson(`${appBaseUrl}/api/tenant/members/${tempUserId}`, { method: 'DELETE', headers: h(adminToken) });
        out.push({ check: 'E.cleanup_temp_member', endpoint: '/api/tenant/members/[userId]', status: 200, pass: !!addMember.ok, snippet: short(addMember.body) });
    }

    console.log(JSON.stringify({ pass: out.every((x) => x.pass), checks: out }, null, 2));
}

main().catch((e) => {
    console.error(e?.stack || String(e));
    process.exit(1);
});

