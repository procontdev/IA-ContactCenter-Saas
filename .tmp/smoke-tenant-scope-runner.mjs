import fs from 'node:fs';

function readEnv(file) {
    const map = {};
    if (!fs.existsSync(file)) return map;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i < 0) continue;
        map[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
    }
    return map;
}

async function run() {
    const env = readEnv('.env.antigravity.local');
    const supa = String(env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const anon = String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');

    const loginRes = await fetch(`${supa}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anon, 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'demo.admin@local.test', password: 'DemoAdmin123!' }),
        signal: AbortSignal.timeout(15000),
    });

    const loginBody = await loginRes.json().catch(() => ({}));
    if (!loginRes.ok || !loginBody.access_token) {
        console.log(JSON.stringify({ stage: 'auth', status: loginRes.status, body: loginBody }, null, 2));
        process.exit(2);
    }

    const token = loginBody.access_token;
    const base = 'http://localhost:3001';

    const checks = [
        { name: 'GET wow-queue', method: 'GET', path: '/api/aap/leads/wow-queue?limit=1' },
        { name: 'GET wow-stats', method: 'GET', path: '/api/aap/leads/wow-stats' },
        { name: 'GET wow-campaigns', method: 'GET', path: '/api/aap/leads/wow-campaigns' },
        { name: 'GET campaigns/list', method: 'GET', path: '/campaigns/list' },
        {
            name: 'POST agent-coach spoof',
            method: 'POST',
            path: '/api/aap/dashboard/agent-coach',
            expectedStatus: 403,
            body: {
                p_tenant_id: '00000000-0000-0000-0000-000000000002',
                p_from_pe: '2026-03-30 00:00:00',
                p_to_pe: '2026-03-31 23:59:59',
                p_campaign_id: null,
                p_agent: null,
            },
        },
        {
            name: 'POST agent-anomalies spoof',
            method: 'POST',
            path: '/api/aap/dashboard/agent-anomalies',
            expectedStatus: 403,
            body: {
                p_tenant_id: '00000000-0000-0000-0000-000000000002',
                p_from_pe: '2026-03-30 00:00:00',
                p_to_pe: '2026-03-31 23:59:59',
                p_campaign_id: null,
                p_min_calls: 1,
            },
        },
        {
            name: 'POST wa/outbound',
            method: 'POST',
            path: '/api/aap/wa/outbound',
            body: {
                call_id: 'smoke-tenant-scope',
                agent_id: 'smoke',
                instance: 'demo',
                to: '51999999999',
                text: 'smoke',
                raw: { source: 'smoke-tenant-scope' },
            },
        },
    ];

    const isCheckPassed = (check, status) => {
        if (typeof check.expectedStatus === 'number') {
            return status === check.expectedStatus;
        }
        return status >= 200 && status < 300;
    };

    const results = [];
    for (const c of checks) {
        try {
            const res = await fetch(`${base}${c.path}`, {
                method: c.method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'content-type': 'application/json',
                },
                body: c.body ? JSON.stringify(c.body) : undefined,
                signal: AbortSignal.timeout(15000),
            });
            const text = await res.text();
            results.push({
                endpoint: c.path,
                method: c.method,
                status: res.status,
                pass: isCheckPassed(c, res.status),
                sample: text.slice(0, 280),
            });
        } catch (err) {
            results.push({
                endpoint: c.path,
                method: c.method,
                status: 0,
                pass: false,
                sample: String(err).slice(0, 280),
            });
        }
    }

    console.log(JSON.stringify({ base, results }, null, 2));
}

run();
