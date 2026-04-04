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
    return reqJson(`${appBaseUrl}/api/tenant/switch`, {
        method: 'POST',
        headers: authHeaders(token, true),
        body: JSON.stringify({ tenant_id: tenantId }),
    });
}

async function setPlan(appBaseUrl, token, planCode) {
    return reqJson(`${appBaseUrl}/api/tenant/plan/`, {
        method: 'PATCH',
        headers: authHeaders(token, true),
        body: JSON.stringify({ plan_code: planCode }),
    });
}

async function getPlan(appBaseUrl, token) {
    return reqJson(`${appBaseUrl}/api/tenant/plan/`, {
        method: 'GET',
        headers: authHeaders(token),
    });
}

async function getMembers(appBaseUrl, token) {
    return reqJson(`${appBaseUrl}/api/tenant/members`, {
        method: 'GET',
        headers: authHeaders(token),
    });
}

async function addMember(appBaseUrl, token, email) {
    return reqJson(`${appBaseUrl}/api/tenant/members`, {
        method: 'POST',
        headers: authHeaders(token, true),
        body: JSON.stringify({ email, role: 'agent' }),
    });
}

async function createCampaign(appBaseUrl, token, code) {
    return reqJson(`${appBaseUrl}/api/campaigns`, {
        method: 'POST',
        headers: authHeaders(token, true),
        body: JSON.stringify({
            code,
            name: code,
            is_active: true,
            ops_settings: {
                primary_channel: 'whatsapp',
                enabled_channels: ['whatsapp'],
                handoff: { enabled: true, trigger: 'intent_or_no_response', sla_minutes: 15 },
                flags: { outbound_enabled: true, auto_assign: false, human_override: true },
            },
        }),
    });
}

async function callFeature(appBaseUrl, token, endpoint) {
    return reqJson(`${appBaseUrl}${endpoint}`, {
        method: 'GET',
        headers: authHeaders(token),
    });
}

function sample(body) {
    if (!body || typeof body !== 'object') return body;
    const out = {};
    for (const k of ['error', 'code', 'feature', 'plan_code', 'max_allowed', 'current_count']) {
        if (k in body) out[k] = body[k];
    }
    return out;
}

async function main() {
    const env = { ...loadEnv('.env.antigravity.local'), ...process.env };
    const supabaseUrl = must('NEXT_PUBLIC_SUPABASE_URL', env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
    const anonKey = must('NEXT_PUBLIC_SUPABASE_ANON_KEY', env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const appBaseUrl = must('APP_BASE_URL', env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const email = must('SMOKE_EMAIL', env.SMOKE_EMAIL);
    const password = must('SMOKE_PASSWORD', env.SMOKE_PASSWORD);
    const basicTenantId = must('SMOKE_BASIC_TENANT_ID', env.SMOKE_BASIC_TENANT_ID);
    const proTenantId = must('SMOKE_PRO_TENANT_ID', env.SMOKE_PRO_TENANT_ID);

    const token = await login(supabaseUrl, anonKey, email, password);
    const now = Date.now();

    const checks = [];

    // BASIC
    checks.push({ op: 'switch basic', ...(await switchTenant(appBaseUrl, token, basicTenantId)) });
    checks.push({ op: 'patch plan basic', ...(await setPlan(appBaseUrl, token, 'basic')) });
    const basicPlan = await getPlan(appBaseUrl, token);
    checks.push({ op: 'get plan basic', ...basicPlan });
    checks.push({ op: 'feature manager basic', ...(await callFeature(appBaseUrl, token, '/api/aap/leads/manager-view?limit=5')) });
    checks.push({ op: 'feature executive basic', ...(await callFeature(appBaseUrl, token, '/api/aap/leads/commercial-insights')) });

    checks.push({ op: 'limit members basic', ...(await addMember(appBaseUrl, token, `pkg-basic-${now}@local.test`)) });
    checks.push({ op: 'limit campaigns basic', ...(await createCampaign(appBaseUrl, token, `PKG_BASIC_${now}`)) });

    // PRO
    checks.push({ op: 'switch pro', ...(await switchTenant(appBaseUrl, token, proTenantId)) });
    checks.push({ op: 'patch plan pro', ...(await setPlan(appBaseUrl, token, 'pro')) });
    const proPlan = await getPlan(appBaseUrl, token);
    checks.push({ op: 'get plan pro', ...proPlan });
    checks.push({ op: 'feature manager pro', ...(await callFeature(appBaseUrl, token, '/api/aap/leads/manager-view?limit=5')) });
    checks.push({ op: 'feature executive pro', ...(await callFeature(appBaseUrl, token, '/api/aap/leads/commercial-insights')) });

    checks.push({ op: 'members list pro', ...(await getMembers(appBaseUrl, token)) });

    const compact = checks.map((c) => ({
        op: c.op,
        status: c.status,
        ok: c.ok,
        sample: sample(c.body),
    }));

    const summary = {
        basic_plan: basicPlan.body?.item?.plan_code,
        pro_plan: proPlan.body?.item?.plan_code,
        manager_basic_status: compact.find((x) => x.op === 'feature manager basic')?.status,
        executive_basic_status: compact.find((x) => x.op === 'feature executive basic')?.status,
        manager_pro_status: compact.find((x) => x.op === 'feature manager pro')?.status,
        executive_pro_status: compact.find((x) => x.op === 'feature executive pro')?.status,
    };

    console.log(JSON.stringify({ summary, checks: compact }, null, 2));
}

main().catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
});

