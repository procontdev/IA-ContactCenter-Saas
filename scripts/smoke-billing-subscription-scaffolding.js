#!/usr/bin/env node
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
    return reqJson(`${appBaseUrl}/api/tenant/plan/`, {
        method: 'PATCH',
        headers: authHeaders(token, true),
        body: JSON.stringify({ plan_code: planCode }),
    });
}

async function setSubscription(appBaseUrl, token, status) {
    return reqJson(`${appBaseUrl}/api/tenant/subscription`, {
        method: 'PATCH',
        headers: authHeaders(token, true),
        body: JSON.stringify({ status }),
    });
}

async function getPlan(appBaseUrl, token) {
    return reqJson(`${appBaseUrl}/api/tenant/plan/`, {
        method: 'GET',
        headers: authHeaders(token),
    });
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

    const supabaseUrl = must('NEXT_PUBLIC_SUPABASE_URL', env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
    const anonKey = must('NEXT_PUBLIC_SUPABASE_ANON_KEY', env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const appBaseUrl = must('APP_BASE_URL', env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const email = must('SMOKE_EMAIL', env.SMOKE_EMAIL || env.AUTH_EMAIL);
    const password = must('SMOKE_PASSWORD', env.SMOKE_PASSWORD || env.AUTH_PASSWORD);
    const tenantId = must('SMOKE_PRO_TENANT_ID', env.SMOKE_PRO_TENANT_ID);

    const token = await login(supabaseUrl, anonKey, email, password);
    await switchTenant(appBaseUrl, token, tenantId);
    await setPlan(appBaseUrl, token, 'pro');

    const checks = [];

    checks.push({ op: 'trial set', ...(await setSubscription(appBaseUrl, token, 'trial')) });
    checks.push({ op: 'trial get plan', ...(await getPlan(appBaseUrl, token)) });
    checks.push({ op: 'trial manager', ...(await callFeature(appBaseUrl, token, '/api/aap/leads/manager-view?limit=5')) });

    checks.push({ op: 'active set', ...(await setSubscription(appBaseUrl, token, 'active')) });
    checks.push({ op: 'active get plan', ...(await getPlan(appBaseUrl, token)) });
    checks.push({ op: 'active executive', ...(await callFeature(appBaseUrl, token, '/api/aap/leads/commercial-insights')) });

    checks.push({ op: 'past_due set', ...(await setSubscription(appBaseUrl, token, 'past_due')) });
    checks.push({ op: 'past_due get plan', ...(await getPlan(appBaseUrl, token)) });
    checks.push({ op: 'past_due executive', ...(await callFeature(appBaseUrl, token, '/api/aap/leads/commercial-insights')) });

    checks.push({ op: 'suspended set', ...(await setSubscription(appBaseUrl, token, 'suspended')) });
    checks.push({ op: 'suspended get plan', ...(await getPlan(appBaseUrl, token)) });
    checks.push({ op: 'suspended manager', ...(await callFeature(appBaseUrl, token, '/api/aap/leads/manager-view?limit=5')) });

    checks.push({ op: 'restore active', ...(await setSubscription(appBaseUrl, token, 'active')) });

    const summary = {
        trial_status: checks.find((x) => x.op === 'trial get plan')?.body?.item?.subscription?.status,
        active_status: checks.find((x) => x.op === 'active get plan')?.body?.item?.subscription?.status,
        past_due_status: checks.find((x) => x.op === 'past_due get plan')?.body?.item?.subscription?.status,
        suspended_status: checks.find((x) => x.op === 'suspended get plan')?.body?.item?.subscription?.status,
        manager_trial_http: checks.find((x) => x.op === 'trial manager')?.status,
        executive_active_http: checks.find((x) => x.op === 'active executive')?.status,
        executive_past_due_http: checks.find((x) => x.op === 'past_due executive')?.status,
        manager_suspended_http: checks.find((x) => x.op === 'suspended manager')?.status,
    };

    const ok =
        summary.trial_status === 'trial' &&
        summary.active_status === 'active' &&
        summary.past_due_status === 'past_due' &&
        summary.suspended_status === 'suspended' &&
        summary.manager_trial_http === 200 &&
        summary.executive_active_http === 200 &&
        summary.executive_past_due_http === 402 &&
        summary.manager_suspended_http === 402;

    console.log(JSON.stringify({ ok, summary, checks }, null, 2));
    if (!ok) process.exit(1);
}

main().catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
});

