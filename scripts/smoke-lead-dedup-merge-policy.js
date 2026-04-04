#!/usr/bin/env node
/**
 * Smoke: lead dedup / merge policy MVP
 *
 * Cobertura:
 * 1) Ingreso lead nuevo
 * 2) Reingreso duplicado (match por phone/email)
 * 3) Verificación de merge (sin duplicado operativo)
 * 4) Guardrail de rol (agent no puede crear)
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
            user_metadata: { source: 'smoke-lead-dedup' },
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

    const tempEmail = String(process.env.SMOKE_LEAD_DEDUP_AGENT_EMAIL || `demo.lead.dedup.${Date.now()}@local.test`);
    const tempPassword = String(process.env.SMOKE_LEAD_DEDUP_AGENT_PASSWORD || 'DemoAgent123!');

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

    const seed = Date.now();
    const phone = '999123456';
    const email = `lead.dedup.${seed}@mailinator.com`;

    const first = await reqJson(`${appBaseUrl}/api/leads/intake`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({
            items: [
                {
                    campaign_id: campaign.id,
                    source_id: `SMK-DEDUP-${seed}-A`,
                    source: 'meta_ads',
                    origin: 'landing_form',
                    channel: 'web',
                    phone,
                    email,
                    metadata: { smoke: true, lane: 'lead-dedup-first' },
                },
            ],
        }),
    });
    const leadA = first.body?.items?.[0];
    expect(
        first.ok
        && first.body?.meta?.inserted === 1
        && first.body?.meta?.merged === 0
        && leadA?.id
        && leadA?.tenant_id === campaign.tenant_id,
        'primer intake crea lead nuevo tenant-safe',
        first.body
    );

    const second = await reqJson(`${appBaseUrl}/api/leads/intake`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({
            items: [
                {
                    campaign_id: campaign.id,
                    source: 'meta_ads_retry',
                    origin: 'landing_form_retry',
                    channel: 'web',
                    phone: '988777666',
                    email,
                    metadata: { smoke: true, lane: 'lead-dedup-second' },
                },
            ],
        }),
    });
    const leadB = second.body?.items?.[0];
    expect(
        second.ok
        && second.body?.meta?.merged === 1
        && second.body?.meta?.inserted === 0
        && leadB?.id === leadA?.id,
        'segundo intake duplicado hace merge sobre lead existente',
        second.body
    );

    const persistedRes = await reqJson(
        `${supabaseUrl}/rest/v1/leads?select=id,tenant_id,campaign_id,phone_norm,email_norm,raw&` +
        `id=eq.${encodeURIComponent(leadA.id)}&limit=1`,
        {
            method: 'GET',
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${adminToken}`,
                'Accept-Profile': 'contact_center',
            },
        }
    );

    const rows = Array.isArray(persistedRes.body) ? persistedRes.body : [];
    const mergedRow = rows.find((r) => r.id === leadA.id);
    const dedupLastMatchBy = mergedRow?.raw?.intake?.metadata?.dedup?.matched_by;
    expect(
        persistedRes.ok
        && rows.length === 1
        && mergedRow
        && mergedRow.tenant_id === campaign.tenant_id
        && mergedRow.campaign_id === campaign.id
        && mergedRow.email_norm === email.toLowerCase()
        && Array.isArray(mergedRow.raw?.intake_history)
        && mergedRow.raw.intake_history.length >= 2
        && dedupLastMatchBy === 'email_norm',
        'persistencia confirma no duplicación, tenant/campaign correctos, email_norm y lookup por email',
        persistedRes.body
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
        body: JSON.stringify({
            items: [
                {
                    campaign_id: campaign.id,
                    source_id: `SMK-DEDUP-${seed}-FORBIDDEN`,
                    phone: '988111222',
                },
            ],
        }),
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

    console.log('\nSmoke lead dedup / merge policy MVP: OK');
}

main().catch((err) => {
    console.error(String(err?.stack || err));
    process.exit(1);
});

