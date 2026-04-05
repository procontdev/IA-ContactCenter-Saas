#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const CAMPAIGN_CODE_PREFIX = 'DEMOSEED_';

function loadEnv(relativePath) {
    const filePath = path.resolve(process.cwd(), relativePath);
    if (!fs.existsSync(filePath)) return {};
    const env = {};
    const content = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || !line.includes('=')) continue;
        const idx = line.indexOf('=');
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
    return env;
}

function toArray(v) {
    return Array.isArray(v) ? v : [];
}

async function reqJson(url, options = {}) {
    const res = await fetch(url, { ...options, cache: 'no-store' });
    const txt = await res.text();
    let body = null;
    try {
        body = txt ? JSON.parse(txt) : null;
    } catch {
        body = txt;
    }
    return { ok: res.ok, status: res.status, body };
}

function hAuth(anonKey) {
    return { apikey: anonKey, 'Content-Type': 'application/json' };
}

function hCC(token, anonKey) {
    return {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        'Accept-Profile': 'contact_center',
        'Content-Profile': 'contact_center',
        'Content-Type': 'application/json',
    };
}

function hPlatform(token, anonKey) {
    return {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        'Accept-Profile': 'platform_core',
        'Content-Profile': 'platform_core',
        'Content-Type': 'application/json',
    };
}

async function login(baseUrl, anonKey, email, password) {
    const res = await reqJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: hAuth(anonKey),
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok || !res.body?.access_token) {
        throw new Error(`Login failed (${email}): ${JSON.stringify(res.body)}`);
    }
    return String(res.body.access_token);
}

async function main() {
    const env = {
        ...loadEnv('.env.antigravity.local'),
        ...loadEnv('.env'),
        ...loadEnv('apps/web/.env.local'),
        ...process.env,
    };

    const baseUrl = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const anonKey = String(env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
    const appBaseUrl = String(env.APP_BASE_URL || env.SMOKE_API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
    const adminEmail = String(env.DEMO_ADMIN_EMAIL || 'demo.admin@local.test').trim();
    const adminPassword = String(env.DEMO_ADMIN_PASSWORD || 'DemoAdmin123!').trim();

    if (!baseUrl || !anonKey) throw new Error('Missing baseUrl/anonKey');

    const token = await login(baseUrl, anonKey, adminEmail, adminPassword);

    const memberships = await reqJson(`${baseUrl}/rest/v1/rpc/list_my_tenants`, {
        method: 'POST',
        headers: hPlatform(token, anonKey),
        body: JSON.stringify({}),
    });
    if (!memberships.ok) {
        throw new Error(`list_my_tenants failed (${memberships.status}): ${JSON.stringify(memberships.body)}`);
    }

    const checks = [];
    const tenants = toArray(memberships.body);

    for (const t of tenants) {
        const tenantId = String(t.tenant_id || '').trim();
        const slug = String(t.slug || '').trim();
        if (!tenantId) continue;

        const setActive = await reqJson(`${baseUrl}/rest/v1/rpc/set_active_tenant`, {
            method: 'POST',
            headers: hPlatform(token, anonKey),
            body: JSON.stringify({ p_tenant_id: tenantId }),
        });
        if (!setActive.ok) continue;

        const campaignsRes = await reqJson(
            `${baseUrl}/rest/v1/campaigns?select=id,code,name,tenant_id&tenant_id=eq.${encodeURIComponent(tenantId)}&order=created_at.desc&limit=2000`,
            { method: 'GET', headers: hCC(token, anonKey) }
        );
        if (!campaignsRes.ok) continue;

        const demoCampaigns = toArray(campaignsRes.body).filter((c) => String(c.code || '').startsWith(CAMPAIGN_CODE_PREFIX));
        if (!demoCampaigns.length) continue;

        const campaignIds = demoCampaigns.map((c) => c.id).filter(Boolean);
        const leadsRes = await reqJson(
            `${baseUrl}/rest/v1/leads?select=id,tenant_id,campaign_id,source_id,work_status,human_takeover_status,sla_status,sla_is_escalated&campaign_id=in.(${campaignIds.join(',')})&tenant_id=eq.${encodeURIComponent(tenantId)}&limit=20000`,
            { method: 'GET', headers: hCC(token, anonKey) }
        );
        if (!leadsRes.ok) continue;
        const leads = toArray(leadsRes.body);

        const managerView = await reqJson(`${appBaseUrl}/api/aap/leads/manager-view?limit=20`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });

        const hasEscalated = leads.some((l) => l.sla_is_escalated === true);
        const hasTakeover = leads.some((l) => String(l.human_takeover_status || '').toLowerCase() === 'taken');
        const hasClosed = leads.some((l) => String(l.human_takeover_status || '').toLowerCase() === 'closed' || String(l.work_status || '').toLowerCase() === 'done');

        checks.push({
            tenant_slug: slug,
            tenant_id: tenantId,
            campaigns: demoCampaigns.length,
            leads: leads.length,
            has_escalated: hasEscalated,
            has_takeover: hasTakeover,
            has_closed: hasClosed,
            manager_view_ok: managerView.ok,
            manager_view_status: managerView.status,
        });
    }

    const pass = checks.length > 0
        && checks.every((c) => {
            const managerViewAcceptable = c.manager_view_status === 200 || c.manager_view_status === 402 || c.manager_view_status === 403;
            return c.campaigns >= 1
                && c.leads >= 6
                && c.has_escalated
                && c.has_takeover
                && c.has_closed
                && managerViewAcceptable;
        });

    console.log(JSON.stringify({ ok: pass, checks }, null, 2));
    if (!pass) process.exit(1);
}

main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
    process.exit(1);
});

