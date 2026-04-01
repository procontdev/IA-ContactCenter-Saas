#!/usr/bin/env node
/**
 * Smoke: human handoff / lead takeover MVP
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

function authHeaders(token) {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function main() {
    loadEnv(path.resolve('.env.antigravity.local'));
    loadEnv(path.resolve('.env'));

    const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
    const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
    const adminEmail = String(process.env.DEMO_ADMIN_EMAIL || 'demo.admin@local.test');
    const adminPassword = String(process.env.DEMO_ADMIN_PASSWORD || 'DemoAdmin123!');

    expect(Boolean(supabaseUrl && anonKey), 'Supabase URL/anon key disponibles', { supabaseUrl });

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
                source_id: `SMK-TAKE-${seed}`,
                source: 'meta_ads',
                origin: 'landing_form',
                channel: 'web',
                phone: '999654322',
                email: `lead.take.${seed}@mailinator.com`,
                metadata: { smoke: true, lane: 'lead-human-takeover', request_human: true },
            }],
        }),
    });
    const lead = intake.body?.items?.[0];
    expect(intake.ok && lead?.id, 'intake crea lead para takeover', intake.body);

    const take = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'takeover_take' }),
    });
    expect(
        take.ok
        && take.body?.item?.human_takeover_status === 'taken'
        && typeof take.body?.item?.human_takeover_at === 'string'
        && take.body?.item?.work_status === 'in_progress',
        'takeover humano explícito marca ownership y estado operativo',
        take.body
    );

    const release = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'takeover_release' }),
    });
    expect(
        release.ok
        && release.body?.item?.human_takeover_status === 'released'
        && typeof release.body?.item?.human_takeover_released_at === 'string'
        && release.body?.item?.work_status === 'queued',
        'liberación de takeover devuelve lead a la cola',
        release.body
    );

    const close = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'takeover_close' }),
    });
    expect(
        close.ok
        && close.body?.item?.human_takeover_status === 'closed'
        && typeof close.body?.item?.human_takeover_closed_at === 'string'
        && close.body?.item?.work_status === 'done',
        'cierre takeover deja trazabilidad mínima y cierre operativo',
        close.body
    );

    const persistedRes = await reqJson(
        `${supabaseUrl}/rest/v1/leads?select=id,tenant_id,work_status,human_takeover_status,human_takeover_by_user_id,human_takeover_by_label,human_takeover_at,human_takeover_released_at,human_takeover_closed_at&` +
        `id=eq.${encodeURIComponent(lead.id)}&tenant_id=eq.${encodeURIComponent(campaign.tenant_id)}&limit=1`,
        { method: 'GET', headers: { apikey: anonKey, Authorization: `Bearer ${adminToken}`, 'Accept-Profile': 'contact_center' } }
    );
    const row = Array.isArray(persistedRes.body) ? persistedRes.body[0] : null;
    expect(
        persistedRes.ok && row && row.id === lead.id && row.tenant_id === campaign.tenant_id && row.human_takeover_status === 'closed',
        'persistencia tenant-safe del takeover en DB',
        persistedRes.body
    );

    const queueGet = await reqJson(`${appBaseUrl}/api/aap/leads/wow-queue?campaign_id=${encodeURIComponent(campaign.id)}&q=${encodeURIComponent('999654322')}&limit=50`, {
        method: 'GET',
        headers: authHeaders(adminToken),
    });
    const queueItem = Array.isArray(queueGet.body?.items) ? queueGet.body.items.find((it) => it.id === lead.id) : null;
    expect(
        queueGet.ok
        && queueItem
        && String(queueItem.human_takeover_status || '').toLowerCase() === 'closed'
        && String(queueItem.work_status || '').toLowerCase() === 'done',
        'continuidad wow queue con takeover visible sin romper assignment',
        queueGet.body
    );

    console.log('\nSmoke lead human handoff / takeover MVP: OK');
}

main().catch((err) => {
    console.error(String(err?.stack || err));
    process.exit(1);
});

