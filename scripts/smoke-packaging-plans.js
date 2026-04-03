#!/usr/bin/env node
/**
 * Smoke: Packaging / plans / feature gating MVP
 * Valida:
 * - consulta plan activo
 * - gating basic vs pro en manager/executive endpoints
 */

const fs = require('node:fs');
const path = require('node:path');

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

function must(name, value) {
    const v = String(value || '').trim();
    if (!v) throw new Error(`Missing required env: ${name}`);
    return v;
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

function authHeaders(token, json = false) {
    return {
        Authorization: `Bearer ${token}`,
        ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
}

async function login(baseUrl, anonKey, email, password) {
    const res = await reqJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok || !res.body?.access_token) {
        throw new Error(`login failed (${res.status}): ${JSON.stringify(res.body)}`);
    }
    return String(res.body.access_token);
}

async function switchTenant(appBaseUrl, token, tenantId) {
    const res = await reqJson(`${appBaseUrl}/api/tenant/switch`, {
        method: 'POST',
        headers: authHeaders(token, true),
        body: JSON.stringify({ tenant_id: tenantId }),
    });
    if (!res.ok) throw new Error(`switch tenant failed (${res.status}): ${JSON.stringify(res.body)}`);
}

async function setPlan(appBaseUrl, token, planCode) {
    const res = await reqJson(`${appBaseUrl}/api/tenant/plan/`, {
        method: 'PATCH',
        headers: authHeaders(token, true),
        body: JSON.stringify({ plan_code: planCode }),
    });
    if (!res.ok) throw new Error(`set plan ${planCode} failed (${res.status}): ${JSON.stringify(res.body)}`);
    return res.body?.item;
}

async function getPlan(appBaseUrl, token) {
    const res = await reqJson(`${appBaseUrl}/api/tenant/plan/`, {
        method: 'GET',
        headers: authHeaders(token),
    });
    if (!res.ok) throw new Error(`get plan failed (${res.status}): ${JSON.stringify(res.body)}`);
    return res.body?.item;
}

async function callFeature(appBaseUrl, token, endpoint) {
    return reqJson(`${appBaseUrl}${endpoint}`, {
        method: 'GET',
        headers: authHeaders(token),
    });
}

async function main() {
    const env = {
        ...loadEnv('.env.antigravity.local'),
        ...process.env,
    };

    const supabaseUrl = must('NEXT_PUBLIC_SUPABASE_URL', env.NEXT_PUBLIC_SUPABASE_URL);
    const anonKey = must('NEXT_PUBLIC_SUPABASE_ANON_KEY', env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const appBaseUrl = must('APP_BASE_URL', env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const email = must('SMOKE_EMAIL', env.SMOKE_EMAIL || env.AUTH_EMAIL);
    const password = must('SMOKE_PASSWORD', env.SMOKE_PASSWORD || env.AUTH_PASSWORD);
    const basicTenantId = must('SMOKE_BASIC_TENANT_ID', env.SMOKE_BASIC_TENANT_ID);
    const proTenantId = must('SMOKE_PRO_TENANT_ID', env.SMOKE_PRO_TENANT_ID);

    const token = await login(supabaseUrl.replace(/\/+$/, ''), anonKey, email, password);

    const summary = {};

    await switchTenant(appBaseUrl, token, basicTenantId);
    const basicPlan = await setPlan(appBaseUrl, token, 'basic');
    const basicPlanCheck = await getPlan(appBaseUrl, token);
    const basicManager = await callFeature(appBaseUrl, token, '/api/aap/leads/manager-view?limit=5');
    const basicExec = await callFeature(appBaseUrl, token, '/api/aap/leads/commercial-insights');

    await switchTenant(appBaseUrl, token, proTenantId);
    const proPlan = await setPlan(appBaseUrl, token, 'pro');
    const proPlanCheck = await getPlan(appBaseUrl, token);
    const proManager = await callFeature(appBaseUrl, token, '/api/aap/leads/manager-view?limit=5');
    const proExec = await callFeature(appBaseUrl, token, '/api/aap/leads/commercial-insights');

    summary.basic = {
        requested_plan: basicPlan?.plan_code,
        current_plan: basicPlanCheck?.plan_code,
        manager_status: basicManager.status,
        executive_status: basicExec.status,
    };

    summary.pro = {
        requested_plan: proPlan?.plan_code,
        current_plan: proPlanCheck?.plan_code,
        manager_status: proManager.status,
        executive_status: proExec.status,
    };

    const ok =
        summary.basic.current_plan === 'basic' &&
        summary.pro.current_plan === 'pro' &&
        summary.basic.manager_status === 403 &&
        summary.basic.executive_status === 403 &&
        summary.pro.manager_status === 200 &&
        summary.pro.executive_status === 200;

    console.log(JSON.stringify({ ok, summary }, null, 2));
    if (!ok) process.exit(1);
}

main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
});

