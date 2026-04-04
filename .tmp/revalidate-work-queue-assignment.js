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
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { status: res.status, ok: res.ok, body };
}

async function login(baseUrl, anonKey, email, password) {
    const res = await reqJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok || !res.body?.access_token) throw new Error(`login failed ${email}`);
    return String(res.body.access_token);
}

async function createOrGetUser(baseUrl, serviceKey, email, password) {
    const createRes = await reqJson(`${baseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { role: 'agent' } }),
    });
    if (createRes.ok && createRes.body?.id) return String(createRes.body.id);

    const listRes = await reqJson(`${baseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
        method: 'GET',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    const found = listRes.body?.users?.find((u) => String(u.email).toLowerCase() === email.toLowerCase());
    if (!found?.id) throw new Error('cannot resolve temp user');
    return String(found.id);
}

function authHeaders(token) {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

(async function main() {
    loadEnv(path.resolve('.env.antigravity.local'));
    loadEnv(path.resolve('.env'));

    const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
    const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');

    const adminEmail = String(process.env.DEMO_ADMIN_EMAIL || 'demo.admin@local.test');
    const adminPassword = String(process.env.DEMO_ADMIN_PASSWORD || 'DemoAdmin123!');
    const tempEmail = `demo.workq.reval.${Date.now()}@local.test`;
    const tempPassword = 'DemoAgent123!';

    const adminToken = await login(supabaseUrl, anonKey, adminEmail, adminPassword);

    const campaigns = await reqJson(`${supabaseUrl}/rest/v1/campaigns?select=id,tenant_id&order=created_at.desc&limit=1`, {
        method: 'GET',
        headers: { apikey: anonKey, Authorization: `Bearer ${adminToken}`, 'Accept-Profile': 'contact_center' },
    });
    const campaign = campaigns.body?.[0];

    const seed = Date.now();
    const intake = await reqJson(`${appBaseUrl}/api/leads/intake`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ items: [{ campaign_id: campaign.id, source_id: `RV-WQ-${seed}`, phone: '988776655', email: `rv.${seed}@mailinator.com` }] }),
    });
    const lead = intake.body?.items?.[0];

    const queueCheck = await reqJson(`${appBaseUrl}/api/aap/leads/wow-queue?campaign_id=${encodeURIComponent(campaign.id)}&q=988776655&limit=20`, {
        method: 'GET',
        headers: authHeaders(adminToken),
    });
    const queueItem = Array.isArray(queueCheck.body?.items) ? queueCheck.body.items.find((it) => it.id === lead.id) : null;

    const tempUserId = await createOrGetUser(supabaseUrl, serviceKey, tempEmail, tempPassword);
    const addMember = await reqJson(`${appBaseUrl}/api/tenant/members`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ email: tempEmail, role: 'agent' }),
    });

    const assign = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'assign', assignee_user_id: tempUserId }),
    });

    const release = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'release' }),
    });

    const markInProgress = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'set_status', work_status: 'in_progress' }),
    });

    const markDone = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'set_status', work_status: 'done' }),
    });

    const listAfter = await reqJson(`${appBaseUrl}/api/aap/leads/wow-queue?campaign_id=${encodeURIComponent(campaign.id)}&q=988776655&limit=20`, {
        method: 'GET',
        headers: authHeaders(adminToken),
    });
    const afterItem = Array.isArray(listAfter.body?.items) ? listAfter.body.items.find((it) => it.id === lead.id) : null;

    const invalidAssignee = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'assign', assignee_user_id: '00000000-0000-4000-8000-000000000999' }),
    });

    const agentToken = await login(supabaseUrl, anonKey, tempEmail, tempPassword);
    const forbiddenByRole = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(agentToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'assign', assignee_user_id: tempUserId }),
    });

    const randomLeadForbidden = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: '00000000-0000-4000-8000-000000000777', operation: 'assign', assignee_user_id: tempUserId }),
    });

    const remove = await reqJson(`${appBaseUrl}/api/tenant/members/${tempUserId}`, {
        method: 'DELETE',
        headers: authHeaders(adminToken),
    });

    const out = {
        env: { appBaseUrl, supabaseUrl, campaign_id: campaign.id, tenant_id: campaign.tenant_id, lead_id: lead.id, temp_user_id: tempUserId },
        checks: {
            intake,
            queueCheck: { status: queueCheck.status, ok: queueCheck.ok, item: queueItem },
            addMember,
            assign,
            release,
            markInProgress,
            markDone,
            listAfter: { status: listAfter.status, ok: listAfter.ok, item: afterItem },
            invalidAssignee,
            forbiddenByRole,
            randomLeadForbidden,
            cleanupRemove: remove,
        },
    };

    console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
    console.error(String(e?.stack || e));
    process.exit(1);
});

