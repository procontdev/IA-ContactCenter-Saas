#!/usr/bin/env node
/**
 * Smoke: lead work queue / assignment MVP
 */

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
    try {
        body = txt ? JSON.parse(txt) : null;
    } catch {
        body = txt;
    }
    return { ok: res.ok, status: res.status, body };
}

function expect(ok, message, details) {
    if (!ok) {
        const extra = details ? `\nDETAILS: ${JSON.stringify(details, null, 2)}` : '';
        throw new Error(`[FAIL] ${message}${extra}`);
    }
    console.log(`[OK] ${message}`);
}

async function login(baseUrl, anonKey, email, password) {
    const res = await reqJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok || !res.body?.access_token) {
        throw new Error(`Login failed (${email}) status=${res.status} body=${JSON.stringify(res.body)}`);
    }
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
            user_metadata: { source: 'smoke-lead-work-queue-assignment' },
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
    throw new Error(`Cannot create/get temp user: ${JSON.stringify(createRes.body)}`);
}

function authHeaders(token) {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function main() {
    loadEnv(path.resolve('.env.antigravity.local'));
    loadEnv(path.resolve('.env'));

    const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
    const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
    const adminEmail = String(process.env.DEMO_ADMIN_EMAIL || 'demo.admin@local.test');
    const adminPassword = String(process.env.DEMO_ADMIN_PASSWORD || 'DemoAdmin123!');
    const tempEmail = String(process.env.SMOKE_LEAD_WORK_QUEUE_AGENT_EMAIL || `demo.work.queue.${Date.now()}@local.test`);
    const tempPassword = String(process.env.SMOKE_LEAD_WORK_QUEUE_AGENT_PASSWORD || 'DemoAgent123!');

    expect(Boolean(supabaseUrl && anonKey), 'Supabase URL/anon key disponibles', { supabaseUrl });
    expect(Boolean(serviceKey), 'SUPABASE_SERVICE_ROLE_KEY disponible para smoke completo');

    const adminToken = await login(supabaseUrl, anonKey, adminEmail, adminPassword);

    const campaignsRes = await reqJson(
        `${supabaseUrl}/rest/v1/campaigns?select=id,code,tenant_id&order=created_at.desc&limit=1`,
        { method: 'GET', headers: { apikey: anonKey, Authorization: `Bearer ${adminToken}`, 'Accept-Profile': 'contact_center' } }
    );
    expect(campaignsRes.ok && Array.isArray(campaignsRes.body) && campaignsRes.body.length > 0, 'existe campaña para el tenant activo', campaignsRes.body);
    const campaign = campaignsRes.body[0];

    const seed = Date.now();
    const intake = await reqJson(`${appBaseUrl}/api/leads/intake`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({
            items: [{
                campaign_id: campaign.id,
                source_id: `SMK-WQ-${seed}`,
                source: 'meta_ads',
                origin: 'landing_form',
                channel: 'web',
                phone: '999654321',
                email: `lead.wq.${seed}@mailinator.com`,
                metadata: { smoke: true, lane: 'lead-work-queue-assignment' },
            }],
        }),
    });
    const lead = intake.body?.items?.[0];
    expect(intake.ok && lead?.id, 'intake crea lead de prueba para la cola', intake.body);

    const queueGet = await reqJson(`${appBaseUrl}/api/aap/leads/wow-queue?campaign_id=${encodeURIComponent(campaign.id)}&q=${encodeURIComponent('999654321')}&limit=50`, {
        method: 'GET',
        headers: authHeaders(adminToken),
    });
    const queueItem = Array.isArray(queueGet.body?.items) ? queueGet.body.items.find((it) => it.id === lead.id) : null;
    expect(queueGet.ok && queueItem, 'lead visible en wow queue (entrada a cola operativa)', queueGet.body);

    const tempUserId = await createOrGetUser(supabaseUrl, serviceKey, tempEmail, tempPassword);
    const addMember = await reqJson(`${appBaseUrl}/api/tenant/members`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ email: tempEmail, role: 'agent' }),
    });
    expect(addMember.ok && addMember.body?.item?.user_id, 'usuario temporal agregado al tenant', addMember.body);

    const assign = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'assign', assignee_user_id: tempUserId }),
    });
    expect(
        assign.ok
        && assign.body?.item?.id === lead.id
        && String(assign.body?.item?.work_assignee_user_id || '').toLowerCase() === tempUserId.toLowerCase()
        && ['assigned', 'in_progress', 'done'].includes(String(assign.body?.item?.work_status || '').toLowerCase()),
        'assignment persistido con ownership visible',
        assign.body
    );

    const inProgress = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'set_status', work_status: 'in_progress' }),
    });
    expect(inProgress.ok && inProgress.body?.item?.work_status === 'in_progress', 'cambio mínimo de estado a in_progress', inProgress.body);

    const release = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'release' }),
    });
    expect(
        release.ok
        && release.body?.item?.work_status === 'queued'
        && release.body?.item?.work_assignee_user_id == null,
        'reasignación/liberación mínima funcional',
        release.body
    );

    const persistedRes = await reqJson(
        `${supabaseUrl}/rest/v1/leads?select=id,tenant_id,work_queue,work_status,work_assignee_user_id,work_assignee_label,work_assigned_at&` +
        `id=eq.${encodeURIComponent(lead.id)}&tenant_id=eq.${encodeURIComponent(campaign.tenant_id)}&limit=1`,
        { method: 'GET', headers: { apikey: anonKey, Authorization: `Bearer ${adminToken}`, 'Accept-Profile': 'contact_center' } }
    );
    const row = Array.isArray(persistedRes.body) ? persistedRes.body[0] : null;
    expect(
        persistedRes.ok && row && row.id === lead.id && row.tenant_id === campaign.tenant_id && typeof row.work_status === 'string',
        'ownership/estado quedan persistidos tenant-safe en DB',
        persistedRes.body
    );

    const agentToken = await login(supabaseUrl, anonKey, tempEmail, tempPassword);
    const forbidden = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(agentToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'assign', assignee_user_id: tempUserId }),
    });
    expect(
        forbidden.status === 403 && String(forbidden.body?.error || '').toLowerCase().includes('forbidden'),
        'guardrail de rol: agent no puede asignar leads',
        forbidden.body
    );

    const remove = await reqJson(`${appBaseUrl}/api/tenant/members/${tempUserId}`, {
        method: 'DELETE',
        headers: authHeaders(adminToken),
    });
    expect(remove.ok && remove.body?.item?.removed === true, 'limpieza de usuario temporal', remove.body);

    console.log('\nSmoke lead work queue / assignment MVP: OK');
}

main().catch((err) => {
    console.error(String(err?.stack || err));
    process.exit(1);
});

