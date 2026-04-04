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
    try {
        body = txt ? JSON.parse(txt) : null;
    } catch {
        body = txt;
    }
    return { status: res.status, ok: res.ok, body };
}

async function login(baseUrl, anonKey, email, password) {
    const r = await reqJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!r.ok || !r.body?.access_token) throw new Error(`Login failed for ${email}`);
    return String(r.body.access_token);
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
            user_metadata: { source: 'validate-tenant-settings-detailed' },
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
    throw new Error('Cannot create/get temp user');
}

function short(v) {
    try {
        return JSON.stringify(v).slice(0, 260);
    } catch {
        return String(v).slice(0, 260);
    }
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
    const agentEmail = String(process.env.SMOKE_TENANT_SETTINGS_AGENT_EMAIL || `demo.settings.agent.${Date.now()}@local.test`);
    const agentPassword = String(process.env.SMOKE_TENANT_SETTINGS_AGENT_PASSWORD || 'DemoAgent123!');

    const adminToken = await login(supabaseUrl, anonKey, adminEmail, adminPassword);
    const authHeaders = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

    const getA = await reqJson(`${appBaseUrl}/api/tenant/settings`, { method: 'GET', headers: authHeaders(adminToken) });
    const slugBefore = getA.body?.item?.slug;

    const stamp = Date.now();
    const newName = `EventProLabs ${stamp}`;
    const payload = {
        name: newName,
        timezone: 'America/Lima',
        locale: 'es-PE',
        branding: {
            brand_name: 'EventPro Labs',
            primary_color: '#0EA5E9',
            logo_url: `https://cdn.local/eventprolabs-${stamp}.svg`,
        },
        metadata: {
            website: 'https://eventprolabs.example.com',
            support_email: 'support@eventprolabs.example.com',
        },
    };

    const patchB = await reqJson(`${appBaseUrl}/api/tenant/settings`, {
        method: 'PATCH',
        headers: authHeaders(adminToken),
        body: JSON.stringify(payload),
    });

    const getB = await reqJson(`${appBaseUrl}/api/tenant/settings`, { method: 'GET', headers: authHeaders(adminToken) });
    const slugAfter = getB.body?.item?.slug;

    const tempUserId = await createOrGetUser(supabaseUrl, serviceKey, agentEmail, agentPassword);
    const addMember = await reqJson(`${appBaseUrl}/api/tenant/members`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ email: agentEmail, role: 'agent' }),
    });
    const agentToken = await login(supabaseUrl, anonKey, agentEmail, agentPassword);
    const patchForbidden = await reqJson(`${appBaseUrl}/api/tenant/settings`, {
        method: 'PATCH',
        headers: authHeaders(agentToken),
        body: JSON.stringify({ name: `NoAdmin-${stamp}` }),
    });
    const getForbidden = await reqJson(`${appBaseUrl}/api/tenant/settings`, {
        method: 'GET',
        headers: authHeaders(agentToken),
    });

    const cleanup = await reqJson(`${appBaseUrl}/api/tenant/members/${tempUserId}`, {
        method: 'DELETE',
        headers: authHeaders(adminToken),
    });

    const out = {
        A_read_admin: {
            endpoint: 'GET /api/tenant/settings',
            status: getA.status,
            pass: getA.ok && Boolean(getA.body?.item?.name) && Boolean(getA.body?.item?.slug),
            snippet: short(getA.body),
        },
        B_update_admin: {
            endpoint: 'PATCH /api/tenant/settings',
            status: patchB.status,
            pass: patchB.ok && patchB.body?.item?.name === newName,
            snippet: short(patchB.body),
        },
        B_persist_admin: {
            endpoint: 'GET /api/tenant/settings (post-patch)',
            status: getB.status,
            pass: getB.ok && getB.body?.item?.name === newName && getB.body?.item?.timezone === 'America/Lima' && getB.body?.item?.locale === 'es-PE',
            slug_unchanged: slugBefore === slugAfter,
            snippet: short(getB.body),
        },
        C_guardrail_patch_non_admin: {
            endpoint: 'PATCH /api/tenant/settings (agent)',
            status: patchForbidden.status,
            pass: !patchForbidden.ok,
            snippet: short(patchForbidden.body),
        },
        C_guardrail_get_non_admin: {
            endpoint: 'GET /api/tenant/settings (agent)',
            status: getForbidden.status,
            pass: !getForbidden.ok,
            snippet: short(getForbidden.body),
        },
        setup_add_non_admin_member: {
            endpoint: 'POST /api/tenant/members',
            status: addMember.status,
            pass: addMember.ok,
            snippet: short(addMember.body),
        },
        cleanup_non_admin_member: {
            endpoint: 'DELETE /api/tenant/members/:id',
            status: cleanup.status,
            pass: cleanup.ok,
            snippet: short(cleanup.body),
        },
    };

    console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
    console.error(String(e?.stack || e));
    process.exit(1);
});

