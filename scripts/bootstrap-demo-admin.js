const fs = require('fs');
const path = require('path');

function getEnv(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const env = {};
    const content = fs.readFileSync(filePath, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eq = trimmed.indexOf('=');
        if (eq === -1) return;
        const key = trimmed.substring(0, eq).trim();
        const value = trimmed.substring(eq + 1).trim().replace(/^"(.*)"$/, '$1');
        env[key] = value;
    });
    return env;
}

function reqJson(url, options = {}) {
    return fetch(url, options).then(async (res) => {
        let body = null;
        try {
            body = await res.json();
        } catch {
            body = null;
        }
        return { ok: res.ok, status: res.status, body };
    });
}

async function listAuthUsers(baseUrl, serviceKey) {
    const headers = {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
    };
    const all = [];
    for (let page = 1; page <= 10; page += 1) {
        const url = `${baseUrl}/auth/v1/admin/users?page=${page}&per_page=100`;
        const res = await reqJson(url, { method: 'GET', headers });
        if (!res.ok) throw new Error(`auth admin list failed (${res.status}): ${JSON.stringify(res.body)}`);
        const users = Array.isArray(res.body?.users) ? res.body.users : [];
        all.push(...users);
        if (users.length < 100) break;
    }
    return all;
}

async function createOrGetUser(baseUrl, serviceKey, email, password) {
    const headers = {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
    };

    const createRes = await reqJson(`${baseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            app_metadata: { role: 'tenant_admin', bootstrap: true },
            user_metadata: { source: 'bootstrap-demo-admin' },
        }),
    });

    if (createRes.ok && createRes.body?.id) {
        return { userId: createRes.body.id, created: true };
    }

    const users = await listAuthUsers(baseUrl, serviceKey);
    const existing = users.find((u) => String(u.email || '').toLowerCase() === email.toLowerCase());
    if (existing?.id) {
        return { userId: existing.id, created: false };
    }

    throw new Error(`Cannot create/get auth user. status=${createRes.status} body=${JSON.stringify(createRes.body)}`);
}

async function linkUserToDefaultTenant(baseUrl, serviceKey, userId, role = 'tenant_admin') {
    const headers = {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Accept-Profile': 'platform_core',
        'Content-Profile': 'platform_core',
        'Content-Type': 'application/json',
    };

    const payload = {
        p_user_id: userId,
        p_role: role,
        p_make_primary: true,
    };

    const res = await reqJson(`${baseUrl}/rest/v1/rpc/bootstrap_link_user_to_default_tenant`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        throw new Error(`RPC link failed (${res.status}): ${JSON.stringify(res.body)}`);
    }
    return res.body;
}

async function main() {
    const envRoot = getEnv(path.join(__dirname, '../.env.antigravity.local'));
    const envWeb = getEnv(path.join(__dirname, '../apps/web/.env.local'));
    const env = { ...envRoot, ...envWeb, ...process.env };

    const baseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '');

    const email = String(env.DEMO_ADMIN_EMAIL || 'demo.admin@local.test');
    const password = String(env.DEMO_ADMIN_PASSWORD || 'DemoAdmin123!');
    const role = String(env.DEMO_ADMIN_ROLE || 'tenant_admin');

    if (!baseUrl || !serviceKey) {
        throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    }

    const user = await createOrGetUser(baseUrl, serviceKey, email, password);
    const link = await linkUserToDefaultTenant(baseUrl, serviceKey, user.userId, role);

    console.log(
        JSON.stringify(
            {
                ok: true,
                baseUrl,
                email,
                created: user.created,
                userId: user.userId,
                role,
                tenantLink: link,
            },
            null,
            2
        )
    );
}

main().catch((err) => {
    console.error(
        JSON.stringify(
            {
                ok: false,
                error: err?.message || String(err),
            },
            null,
            2
        )
    );
    process.exit(1);
});

