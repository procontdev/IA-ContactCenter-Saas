#!/usr/bin/env node
/**
 * Smoke: lead SLA / escalation policy MVP
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

function authHeaders(token) {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
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
                source_id: `SMK-SLA-${seed}`,
                source: 'meta_ads',
                origin: 'landing_form',
                channel: 'other',
                phone: '999654323',
                metadata: { smoke: true, lane: 'lead-sla-escalation-policy' },
            }],
        }),
    });
    const lead = intake.body?.items?.[0];
    expect(intake.ok && lead?.id, 'intake crea lead para SLA/escalación', intake.body);
    expect(
        ['on_time', 'due_soon'].includes(String(lead.sla_status || '').toLowerCase()) && lead.sla_is_escalated === false,
        'lead nuevo recibe estado SLA base sin escalación activa',
        lead
    );

    const backdatedIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const forceOverdue = await reqJson(
        `${supabaseUrl}/rest/v1/leads?id=eq.${encodeURIComponent(lead.id)}&tenant_id=eq.${encodeURIComponent(campaign.tenant_id)}&select=id`,
        {
            method: 'PATCH',
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${adminToken}`,
                'Accept-Profile': 'contact_center',
                'Content-Profile': 'contact_center',
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
            },
            body: JSON.stringify({ sla_due_at: backdatedIso, work_status: 'queued' }),
        }
    );
    expect(forceOverdue.ok, 'se fuerza overdue para validar política de escalación', forceOverdue.body);

    const update = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'set_status', work_status: 'queued' }),
    });
    const updatedLead = update.body?.item;
    expect(
        update.ok
        && updatedLead?.sla_status === 'overdue'
        && updatedLead?.sla_is_escalated === true
        && ['warning', 'critical'].includes(String(updatedLead?.sla_escalation_level || '')),
        'escalación SLA se marca al vencer en cola operativa',
        update.body
    );
    expect(updatedLead?.priority === 'P1', 'prioridad se eleva a P1 por escalación SLA', update.body);

    const queueGet = await reqJson(`${appBaseUrl}/api/aap/leads/wow-queue?campaign_id=${encodeURIComponent(campaign.id)}&q=${encodeURIComponent('999654323')}&limit=50`, {
        method: 'GET',
        headers: authHeaders(adminToken),
    });
    const queueItem = Array.isArray(queueGet.body?.items) ? queueGet.body.items.find((it) => it.id === lead.id) : null;
    expect(
        queueGet.ok
        && queueItem
        && String(queueItem.sla_status || '').toLowerCase() === 'overdue'
        && queueItem.sla_is_escalated === true
        && String(queueItem.priority || '').toUpperCase() === 'P1',
        'visibilidad operativa SLA/escalación en wow queue',
        queueGet.body
    );

    const persisted = await reqJson(
        `${supabaseUrl}/rest/v1/leads?select=id,tenant_id,priority,sla_due_at,sla_status,sla_is_escalated,sla_escalation_level,sla_escalated_at,sla_last_evaluated_at&` +
        `id=eq.${encodeURIComponent(lead.id)}&tenant_id=eq.${encodeURIComponent(campaign.tenant_id)}&limit=1`,
        { method: 'GET', headers: { apikey: anonKey, Authorization: `Bearer ${adminToken}`, 'Accept-Profile': 'contact_center' } }
    );
    const row = Array.isArray(persisted.body) ? persisted.body[0] : null;
    expect(
        persisted.ok
        && row
        && row.id === lead.id
        && row.tenant_id === campaign.tenant_id
        && row.sla_status === 'overdue'
        && row.sla_is_escalated === true,
        'persistencia tenant-safe de señales SLA/escalación en DB',
        persisted.body
    );

    console.log('\nSmoke lead SLA / escalation policy MVP: OK');
}

main().catch((err) => {
    console.error(String(err?.stack || err));
    process.exit(1);
});

