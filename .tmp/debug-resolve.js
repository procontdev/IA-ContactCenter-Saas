const fs = require('fs');

function loadEnv(path) {
    const map = {};
    if (!fs.existsSync(path)) return map;
    for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#') || !t.includes('=')) continue;
        const i = t.indexOf('=');
        map[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
    }
    return map;
}

async function run() {
    const env = { ...loadEnv('.env.antigravity.local'), ...loadEnv('apps/web/.env.local') };
    const base = String(env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const anon = String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
    const email = 'demo.admin@local.test';
    const password = 'DemoAdmin123!';

    const loginRes = await fetch(`${base}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anon, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const login = await loginRes.json().catch(() => ({}));
    const token = login?.access_token;

    const checks = [];

    async function check(name, url, headers, method = 'GET', body) {
        try {
            const res = await fetch(url, { method, headers, body, cache: 'no-store' });
            const txt = await res.text();
            checks.push({ name, status: res.status, ok: res.ok, body: txt.slice(0, 500) });
        } catch (e) {
            checks.push({ name, error: e?.message || String(e) });
        }
    }

    if (token) {
        await check('auth_user', `${base}/auth/v1/user`, { apikey: anon, Authorization: `Bearer ${token}` });
        await check(
            'rpc_resolve_my_tenant_context',
            `${base}/rest/v1/rpc/resolve_my_tenant_context`,
            {
                apikey: anon,
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'Accept-Profile': 'platform_core',
                'Content-Profile': 'platform_core',
            },
            'POST',
            '{}'
        );
        await check(
            'tenant_users_direct',
            `${base}/rest/v1/tenant_users?select=tenant_id,role,is_primary&is_primary=is.true&limit=5`,
            { apikey: anon, Authorization: `Bearer ${token}`, 'Accept-Profile': 'platform_core' }
        );
        await check(
            'app_api_memberships',
            'http://localhost:3000/api/tenant/memberships/',
            { Authorization: `Bearer ${token}`, Accept: 'application/json' }
        );
    }

    console.log(JSON.stringify({ loginStatus: loginRes.status, token: Boolean(token), checks }, null, 2));
}

run().catch((e) => {
    console.error(String(e?.message || e));
    process.exit(1);
});

