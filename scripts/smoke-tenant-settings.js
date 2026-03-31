#!/usr/bin/env node
/**
 * Smoke MVP tenant-settings tenant-aware.
 * Requiere:
 * - Next app levantada (por defecto http://localhost:3001)
 * - Supabase URL / keys en .env.antigravity.local (o .env)
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
            user_metadata: { source: 'smoke-tenant-settings' },
            app_metadata: { role: 'agent' },
        }),
    });

    if (createRes.ok && createRes.body?.id) return createRes.body.id;

    const listRes = await reqJson(`${baseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
        method: 'GET',
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
        },
    });

    const found = listRes.body?.users?.find((u) => String(u.email).toLowerCase() === email.toLowerCase());
    if (found?.id) return found.id;

    throw new Error(`Cannot create/get temp user: ${JSON.stringify(createRes.body)}`);
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

    const tempEmail = String(process.env.SMOKE_TENANT_SETTINGS_AGENT_EMAIL || `demo.settings.agent.${Date.now()}@local.test`);
    const tempPassword = String(process.env.SMOKE_TENANT_SETTINGS_AGENT_PASSWORD || 'DemoAgent123!');

    expect(Boolean(supabaseUrl && anonKey), 'Supabase URL/anon key disponibles', { supabaseUrl });
    expect(Boolean(serviceKey), 'SUPABASE_SERVICE_ROLE_KEY disponible para smoke completo');

    const adminToken = await login(supabaseUrl, anonKey, adminEmail, adminPassword);
    const authHeaders = (token) => ({
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    });

    const get1 = await reqJson(`${appBaseUrl}/api/tenant/settings`, {
        method: 'GET',
        headers: authHeaders(adminToken),
    });
    expect(get1.ok && get1.body?.item?.tenant_id, 'leer settings del tenant activo (admin)', get1.body);

    const stamp = Date.now();
    const nextName = `EventProLabs ${stamp}`;
    const nextTimezone = 'America/Lima';
    const nextLocale = 'es-PE';
    const nextBrand = {
        brand_name: 'EventPro Labs',
        primary_color: '#0EA5E9',
        logo_url: `https://cdn.local/eventprolabs-${stamp}.svg`,
    };
    const nextMetadata = {
        website: 'https://eventprolabs.example.com',
        support_email: 'support@eventprolabs.example.com',
    };

    const patch = await reqJson(`${appBaseUrl}/api/tenant/settings`, {
        method: 'PATCH',
        headers: authHeaders(adminToken),
        body: JSON.stringify({
            name: nextName,
            timezone: nextTimezone,
            locale: nextLocale,
            branding: nextBrand,
            metadata: nextMetadata,
        }),
    });

    expect(
        patch.ok
        && patch.body?.item?.name === nextName
        && patch.body?.item?.timezone === nextTimezone
        && patch.body?.item?.locale === nextLocale,
        'actualizar settings del tenant activo (admin)',
        patch.body
    );

    const get2 = await reqJson(`${appBaseUrl}/api/tenant/settings`, {
        method: 'GET',
        headers: authHeaders(adminToken),
    });
    expect(
        get2.ok
        && get2.body?.item?.name === nextName
        && get2.body?.item?.branding?.primary_color === nextBrand.primary_color,
        'persistencia de tenant settings tras actualización',
        get2.body
    );

    const tempUserId = await createOrGetUser(supabaseUrl, serviceKey, tempEmail, tempPassword);
    const addMember = await reqJson(`${appBaseUrl}/api/tenant/members`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ email: tempEmail, role: 'agent' }),
    });
    expect(addMember.ok && addMember.body?.item?.user_id, 'preparar usuario no-admin dentro del tenant activo', addMember.body);

    const agentToken = await login(supabaseUrl, anonKey, tempEmail, tempPassword);
    const forbidden = await reqJson(`${appBaseUrl}/api/tenant/settings`, {
        method: 'GET',
        headers: authHeaders(agentToken),
    });
    const forbiddenOk = (forbidden.status === 403 || forbidden.status === 400)
        && String(forbidden.body?.error || '').toLowerCase().includes('tenant_admin required');
    expect(forbiddenOk, 'bloqueo correcto para no-admin en lectura tenant settings', forbidden.body);

    const remove = await reqJson(`${appBaseUrl}/api/tenant/members/${tempUserId}`, {
        method: 'DELETE',
        headers: authHeaders(adminToken),
    });
    expect(remove.ok && remove.body?.item?.removed === true, 'limpieza de usuario temporal en tenant', remove.body);

    console.log('\nSmoke tenant settings MVP: OK');
}

main().catch((err) => {
    console.error(String(err?.stack || err));
    process.exit(1);
});

