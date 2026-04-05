#!/usr/bin/env node
/**
 * Smoke campaign onboarding / provisioning MVP.
 *
 * Cobertura:
 * 1) Crear campaña por /api/campaigns (tenant_admin)
 * 2) Verificar defaults provisionados y persistencia
 * 3) Verificar lectura por /api/campaigns/:id/settings
 * 4) Verificar guardrail de rol (agent no puede crear)
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
            user_metadata: { source: 'smoke-campaign-onboarding' },
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

    const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
    const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost:3001').trim().replace(/\/$/, '');

    const adminEmail = String(process.env.DEMO_ADMIN_EMAIL || 'demo.admin@local.test').trim();
    const adminPassword = String(process.env.DEMO_ADMIN_PASSWORD || 'DemoAdmin123!').trim();

    const tempEmail = String(process.env.SMOKE_CAMPAIGN_ONBOARDING_AGENT_EMAIL || `demo.campaign.onboard.${Date.now()}@local.test`).trim();
    const tempPassword = String(process.env.SMOKE_CAMPAIGN_ONBOARDING_AGENT_PASSWORD || 'DemoAgent123!').trim();

    expect(Boolean(supabaseUrl && anonKey), 'Supabase URL/anon key disponibles', { supabaseUrl });
    expect(Boolean(serviceKey), 'SUPABASE_SERVICE_ROLE_KEY disponible para smoke completo');

    const adminToken = await login(supabaseUrl, anonKey, adminEmail, adminPassword);

    const createBody = {
        code: `SMK-ONB-${Date.now()}`,
        name: 'Smoke Campaign Onboarding',
        is_active: true,
    };

    const createRes = await reqJson(`${appBaseUrl}/api/campaigns`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify(createBody),
    });

    const item = createRes.body?.item;
    expect(
        createRes.ok
        && item?.id
        && item?.ops_settings?.primary_channel === 'whatsapp'
        && Array.isArray(item?.ops_settings?.enabled_channels)
        && item?.ops_settings?.enabled_channels?.includes('whatsapp')
        && item?.ops_settings?.handoff?.enabled === false
        && item?.inbound_default_mode === 'human',
        'crear campaña con defaults provisionados',
        createRes.body
    );

    const campaignId = String(item.id);

    const getSettings = await reqJson(`${appBaseUrl}/api/campaigns/${campaignId}/settings`, {
        method: 'GET',
        headers: authHeaders(adminToken),
    });
    expect(
        getSettings.ok
        && getSettings.body?.item?.campaign_id === campaignId
        && getSettings.body?.item?.ops_settings?.primary_channel === 'whatsapp'
        && getSettings.body?.item?.inbound_default_mode === 'human',
        'lectura de settings devuelve valores provisionados',
        getSettings.body
    );

    const dbRead = await reqJson(
        `${supabaseUrl}/rest/v1/campaigns?select=id,tenant_id,ops_settings,inbound_default_mode,llm_fallback_to_human&` +
        `id=eq.${encodeURIComponent(campaignId)}&limit=1`,
        {
            method: 'GET',
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${adminToken}`,
                'Accept-Profile': 'contact_center',
            },
        }
    );
    expect(
        dbRead.ok
        && Array.isArray(dbRead.body)
        && dbRead.body[0]?.ops_settings?.primary_channel === 'whatsapp',
        'persistencia de defaults en campaigns.ops_settings',
        dbRead.body
    );

    const tempUserId = await createOrGetUser(supabaseUrl, serviceKey, tempEmail, tempPassword);
    const addMember = await reqJson(`${appBaseUrl}/api/tenant/members`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ email: tempEmail, role: 'agent' }),
    });
    expect(addMember.ok && addMember.body?.item?.user_id, 'preparar usuario agent para guardrail', addMember.body);

    const agentToken = await login(supabaseUrl, anonKey, tempEmail, tempPassword);
    const forbidden = await reqJson(`${appBaseUrl}/api/campaigns`, {
        method: 'POST',
        headers: authHeaders(agentToken),
        body: JSON.stringify({
            code: `SMK-ONB-FORB-${Date.now()}`,
            name: 'Smoke Forbidden Campaign',
        }),
    });
    expect(
        forbidden.status === 403 && String(forbidden.body?.error || '').toLowerCase().includes('forbidden'),
        'guardrail de rol bloquea create campaign para agent',
        forbidden.body
    );

    const remove = await reqJson(`${appBaseUrl}/api/tenant/members/${tempUserId}`, {
        method: 'DELETE',
        headers: authHeaders(adminToken),
    });
    expect(remove.ok && remove.body?.item?.removed === true, 'limpieza de usuario temporal', remove.body);

    console.log('\nSmoke campaign onboarding MVP: OK');
}

main().catch((err) => {
    console.error(String(err?.stack || err));
    process.exit(1);
});

