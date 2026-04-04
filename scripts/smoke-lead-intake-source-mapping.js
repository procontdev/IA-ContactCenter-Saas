#!/usr/bin/env node
/**
 * Smoke: lead intake / source mapping MVP
 *
 * Cobertura:
 * 1) POST /api/leads/intake con tenant_admin
 * 2) Persistencia de tenant/campaign/channel/source mapping
 * 3) Guardrail de rol (agent no puede crear)
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
        headers: {
            apikey: anonKey,
            'Content-Type': 'application/json',
        },
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
            user_metadata: { source: 'smoke-lead-intake' },
            app_metadata: { role: 'agent' },
        }),
    });

    if (createRes.ok && createRes.body?.id) return String(createRes.body.id);

    const listRes = await reqJson(`${baseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
        method: 'GET',
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
        },
    });
    const found = listRes.body?.users?.find((u) => String(u.email).toLowerCase() === email.toLowerCase());
    if (found?.id) return String(found.id);

    throw new Error(`Cannot create/get temp user: ${JSON.stringify(createRes.body)}`);
}

function authHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
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

    const tempEmail = String(process.env.SMOKE_LEAD_INTAKE_AGENT_EMAIL || `demo.lead.intake.${Date.now()}@local.test`);
    const tempPassword = String(process.env.SMOKE_LEAD_INTAKE_AGENT_PASSWORD || 'DemoAgent123!');

    expect(Boolean(supabaseUrl && anonKey), 'Supabase URL/anon key disponibles', { supabaseUrl });
    expect(Boolean(serviceKey), 'SUPABASE_SERVICE_ROLE_KEY disponible para smoke completo');

    const adminToken = await login(supabaseUrl, anonKey, adminEmail, adminPassword);

    const campaignsRes = await reqJson(
        `${supabaseUrl}/rest/v1/campaigns?select=id,code,tenant_id&order=created_at.desc&limit=1`,
        {
            method: 'GET',
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${adminToken}`,
                'Accept-Profile': 'contact_center',
            },
        }
    );
    expect(campaignsRes.ok && Array.isArray(campaignsRes.body) && campaignsRes.body.length > 0, 'existe al menos una campaña del tenant', campaignsRes.body);

    const campaign = campaignsRes.body[0];
    const sourceId = `SMK-INTAKE-${Date.now()}`;
    const intakeBody = {
        items: [
            {
                campaign_id: campaign.id,
                source_id: sourceId,
                source: 'whatsapp_ads',
                origin: 'meta_form',
                phone: '987654321',
                metadata: { smoke: true, lane: 'lead-intake-source-mapping' },
            },
        ],
    };

    const intakeRes = await reqJson(`${appBaseUrl}/api/leads/intake`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify(intakeBody),
    });

    const item = intakeRes.body?.items?.[0];
    expect(
        intakeRes.ok
        && item?.id
        && item?.tenant_id === campaign.tenant_id
        && item?.campaign_id === campaign.id
        && item?.channel === 'whatsapp'
        && item?.source_id === sourceId,
        'ingreso de lead normaliza tenant/campaign/channel/source',
        intakeRes.body
    );

    const persisted = await reqJson(
        `${supabaseUrl}/rest/v1/leads?select=id,tenant_id,campaign_id,source_id,channel,raw&` +
        `id=eq.${encodeURIComponent(item.id)}&limit=1`,
        {
            method: 'GET',
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${adminToken}`,
                'Accept-Profile': 'contact_center',
            },
        }
    );

    const row = Array.isArray(persisted.body) ? persisted.body[0] : null;
    expect(
        persisted.ok
        && row
        && row.tenant_id === campaign.tenant_id
        && row.campaign_id === campaign.id
        && row.channel === 'whatsapp'
        && row.raw?.intake?.source === 'whatsapp_ads',
        'persistencia incluye raw.intake y mapeo esperado',
        persisted.body
    );

    const tempUserId = await createOrGetUser(supabaseUrl, serviceKey, tempEmail, tempPassword);
    const addMember = await reqJson(`${appBaseUrl}/api/tenant/members`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ email: tempEmail, role: 'agent' }),
    });
    expect(addMember.ok && addMember.body?.item?.user_id, 'preparar usuario agent para guardrail', addMember.body);

    const agentToken = await login(supabaseUrl, anonKey, tempEmail, tempPassword);
    const forbidden = await reqJson(`${appBaseUrl}/api/leads/intake`, {
        method: 'POST',
        headers: authHeaders(agentToken),
        body: JSON.stringify(intakeBody),
    });
    expect(
        forbidden.status === 403 && String(forbidden.body?.error || '').toLowerCase().includes('forbidden'),
        'guardrail de rol bloquea lead intake para agent',
        forbidden.body
    );

    const remove = await reqJson(`${appBaseUrl}/api/tenant/members/${tempUserId}`, {
        method: 'DELETE',
        headers: authHeaders(adminToken),
    });
    expect(remove.ok && remove.body?.item?.removed === true, 'limpieza de usuario temporal', remove.body);

    console.log('\nSmoke lead intake / source mapping MVP: OK');
}

main().catch((err) => {
    console.error(String(err?.stack || err));
    process.exit(1);
});

