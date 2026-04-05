#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;

        const eq = arg.indexOf('=');
        if (eq > -1) {
            out[arg.slice(2, eq)] = arg.slice(eq + 1);
            continue;
        }

        const key = arg.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            out[key] = true;
            continue;
        }

        out[key] = next;
        i += 1;
    }
    return out;
}

function normalizePack(rawValue) {
    const v = String(rawValue || 'AB').trim().toUpperCase();
    if (v === 'A' || v === 'PACK_A') return 'A';
    if (v === 'AB' || v === 'A+B' || v === 'ALL' || v === 'PACK_AB') return 'AB';
    throw new Error(`Pack inválido: ${rawValue}. Usa --pack A o --pack AB`);
}

function loadEnvFile(relativePath) {
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

function ms(value) {
    return `${Math.round(value)}ms`;
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

async function loginSupabase(baseUrl, anonKey, email, password) {
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

function extractMembershipRows(body) {
    const rows = [];
    if (Array.isArray(body)) rows.push(...body);
    if (body && typeof body === 'object') {
        if (Array.isArray(body.items)) rows.push(...body.items);
        if (Array.isArray(body.memberships)) rows.push(...body.memberships);
    }
    return rows.filter((x) => x && typeof x === 'object');
}

function pickMembershipId(row) {
    const direct = row.tenant_id || row.tenantId || row.id;
    if (String(direct || '').trim()) return String(direct).trim();
    const nested = row.tenant?.id || row.tenant?.tenant_id;
    return String(nested || '').trim();
}

function pickMembershipSlug(row) {
    const direct = row.tenant_slug || row.slug;
    if (String(direct || '').trim()) return String(direct).trim().toLowerCase();
    const nested = row.tenant?.slug || row.tenant?.tenant_slug;
    return String(nested || '').trim().toLowerCase();
}

function createSmokeCatalog() {
    return {
        A: [
            {
                id: 'release-readiness',
                requiredEnv: ['APP_BASE_URL'],
            },
            {
                id: 'packaging-plans',
                requiredEnv: [
                    'APP_BASE_URL',
                    'NEXT_PUBLIC_SUPABASE_URL',
                    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
                    'SMOKE_EMAIL',
                    'SMOKE_PASSWORD',
                    'SMOKE_BASIC_TENANT_ID',
                    'SMOKE_PRO_TENANT_ID',
                ],
            },
            {
                id: 'billing-subscription',
                requiredEnv: [
                    'APP_BASE_URL',
                    'NEXT_PUBLIC_SUPABASE_URL',
                    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
                    'SMOKE_EMAIL',
                    'SMOKE_PASSWORD',
                    'SMOKE_PRO_TENANT_ID',
                ],
            },
            {
                id: 'lead-automation-triggers',
                requiredEnv: [
                    'APP_BASE_URL',
                    'NEXT_PUBLIC_SUPABASE_URL',
                    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
                    'SMOKE_EMAIL',
                    'SMOKE_PASSWORD',
                ],
            },
        ],
        B: [
            {
                id: 'packaging-limits-guardrails',
                requiredEnv: [
                    'APP_BASE_URL',
                    'NEXT_PUBLIC_SUPABASE_URL',
                    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
                    'SMOKE_EMAIL',
                    'SMOKE_PASSWORD',
                    'SMOKE_BASIC_TENANT_ID',
                    'SMOKE_PRO_TENANT_ID',
                ],
            },
            {
                id: 'campaign-onboarding',
                requiredEnv: [
                    'APP_BASE_URL',
                    'NEXT_PUBLIC_SUPABASE_URL',
                    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
                    'SUPABASE_SERVICE_ROLE_KEY',
                    'DEMO_ADMIN_EMAIL',
                    'DEMO_ADMIN_PASSWORD',
                ],
            },
            {
                id: 'campaign-settings',
                requiredEnv: [
                    'APP_BASE_URL',
                    'NEXT_PUBLIC_SUPABASE_URL',
                    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
                    'SUPABASE_SERVICE_ROLE_KEY',
                    'DEMO_ADMIN_EMAIL',
                    'DEMO_ADMIN_PASSWORD',
                ],
            },
        ],
    };
}

function buildExecutionList(pack, catalog) {
    if (pack === 'A') return [...catalog.A];
    return [...catalog.A, ...catalog.B];
}

function missingEnvKeys(requiredEnv, envMap) {
    return requiredEnv.filter((key) => !String(envMap[key] || '').trim());
}

async function resolveTenantIdsFromSlug(envMap, args, checks) {
    const needsBasic = !String(envMap.SMOKE_BASIC_TENANT_ID || '').trim();
    const needsPro = !String(envMap.SMOKE_PRO_TENANT_ID || '').trim();
    if (!needsBasic && !needsPro) {
        checks.push({ id: 'tenants.resolve', status: 'PASS', detail: 'IDs de tenant ya presentes.' });
        return;
    }

    const basicSlug = String(args.basicTenantSlug || envMap.SMOKE_BASIC_TENANT_SLUG || 'eventprolabs-demo-b2b').trim().toLowerCase();
    const proSlug = String(args.proTenantSlug || envMap.SMOKE_PRO_TENANT_SLUG || 'eventprolabs-demo-ops').trim().toLowerCase();

    envMap.SMOKE_BASIC_TENANT_SLUG = basicSlug;
    envMap.SMOKE_PRO_TENANT_SLUG = proSlug;

    const appBaseUrl = String(envMap.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    const supabaseUrl = String(envMap.NEXT_PUBLIC_SUPABASE_URL || envMap.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const anonKey = String(envMap.NEXT_PUBLIC_SUPABASE_ANON_KEY || envMap.SUPABASE_ANON_KEY || '').trim();
    const email = String(envMap.SMOKE_EMAIL || envMap.AUTH_EMAIL || '').trim();
    const password = String(envMap.SMOKE_PASSWORD || envMap.AUTH_PASSWORD || '').trim();

    const prerequisites = [];
    if (!appBaseUrl) prerequisites.push('APP_BASE_URL');
    if (!supabaseUrl) prerequisites.push('NEXT_PUBLIC_SUPABASE_URL');
    if (!anonKey) prerequisites.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    if (!email) prerequisites.push('SMOKE_EMAIL');
    if (!password) prerequisites.push('SMOKE_PASSWORD');

    if (prerequisites.length > 0) {
        checks.push({
            id: 'tenants.resolve',
            status: 'FAIL',
            detail: `No se puede resolver tenants por slug; faltan variables: ${prerequisites.join(', ')}`,
        });
        return;
    }

    try {
        const token = await loginSupabase(supabaseUrl, anonKey, email, password);
        const membershipsRes = await reqJson(`${appBaseUrl}/api/tenant/memberships`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!membershipsRes.ok) {
            throw new Error(`tenant memberships failed (${membershipsRes.status}): ${JSON.stringify(membershipsRes.body)}`);
        }

        const memberships = extractMembershipRows(membershipsRes.body);
        if (needsBasic) {
            const hit = memberships.find((row) => pickMembershipSlug(row) === basicSlug);
            if (hit) envMap.SMOKE_BASIC_TENANT_ID = pickMembershipId(hit);
        }
        if (needsPro) {
            const hit = memberships.find((row) => pickMembershipSlug(row) === proSlug);
            if (hit) envMap.SMOKE_PRO_TENANT_ID = pickMembershipId(hit);
        }

        const unresolved = [];
        if (!String(envMap.SMOKE_BASIC_TENANT_ID || '').trim()) unresolved.push(`basic (${basicSlug})`);
        if (!String(envMap.SMOKE_PRO_TENANT_ID || '').trim()) unresolved.push(`pro (${proSlug})`);
        if (unresolved.length > 0) {
            checks.push({
                id: 'tenants.resolve',
                status: 'FAIL',
                detail: `No se pudieron resolver tenants demo: ${unresolved.join(', ')}`,
            });
            return;
        }

        checks.push({
            id: 'tenants.resolve',
            status: 'PASS',
            detail: 'Tenant IDs resueltos correctamente (por ID o slug).',
        });
    } catch (error) {
        checks.push({
            id: 'tenants.resolve',
            status: 'FAIL',
            detail: `Error resolviendo tenants por slug: ${String(error?.message || error)}`,
        });
    }
}

function collectEnvClassification(envMap, pack) {
    const required = [
        'APP_BASE_URL',
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'SMOKE_EMAIL',
        'SMOKE_PASSWORD',
        'SMOKE_BASIC_TENANT_ID',
        'SMOKE_PRO_TENANT_ID',
    ];
    if (pack === 'AB') {
        required.push('SUPABASE_SERVICE_ROLE_KEY', 'DEMO_ADMIN_EMAIL', 'DEMO_ADMIN_PASSWORD');
    }

    const recommended = ['SMOKE_BASIC_TENANT_SLUG', 'SMOKE_PRO_TENANT_SLUG', 'SMOKE_API_BASE_URL'];
    const optional = ['ALLOW_CRITICAL_SKIP'];

    return {
        required,
        recommended,
        optional,
        missingRequired: missingEnvKeys(required, envMap),
        missingRecommended: missingEnvKeys(recommended, envMap),
        missingOptional: missingEnvKeys(optional, envMap),
    };
}

async function checkReachability(envMap, checks) {
    const appBaseUrl = String(envMap.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!appBaseUrl) {
        checks.push({ id: 'reachability.app', status: 'FAIL', detail: 'APP_BASE_URL no está configurada.' });
    } else {
        const startedAt = Date.now();
        try {
            const res = await reqJson(appBaseUrl, { method: 'GET' });
            const elapsed = Date.now() - startedAt;
            if (res.status >= 200 && res.status < 500) {
                checks.push({ id: 'reachability.app', status: 'PASS', detail: `APP reachable (${res.status}, ${ms(elapsed)}).` });
            } else {
                checks.push({ id: 'reachability.app', status: 'FAIL', detail: `APP respondió ${res.status} (${ms(elapsed)}).` });
            }
        } catch (error) {
            checks.push({ id: 'reachability.app', status: 'FAIL', detail: `APP no reachable: ${String(error?.message || error)}` });
        }
    }

    const supabaseUrl = String(envMap.NEXT_PUBLIC_SUPABASE_URL || envMap.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const anonKey = String(envMap.NEXT_PUBLIC_SUPABASE_ANON_KEY || envMap.SUPABASE_ANON_KEY || '').trim();
    if (!supabaseUrl || !anonKey) {
        checks.push({
            id: 'reachability.supabase',
            status: 'FAIL',
            detail: 'Supabase URL o anon key no configurados.',
        });
        return;
    }

    const startedAt = Date.now();
    try {
        const res = await reqJson(`${supabaseUrl}/auth/v1/settings`, {
            method: 'GET',
            headers: { apikey: anonKey },
        });
        const elapsed = Date.now() - startedAt;
        if (res.status >= 200 && res.status < 500) {
            checks.push({ id: 'reachability.supabase', status: 'PASS', detail: `Supabase reachable (${res.status}, ${ms(elapsed)}).` });
        } else {
            checks.push({ id: 'reachability.supabase', status: 'FAIL', detail: `Supabase respondió ${res.status} (${ms(elapsed)}).` });
        }
    } catch (error) {
        checks.push({ id: 'reachability.supabase', status: 'FAIL', detail: `Supabase no reachable: ${String(error?.message || error)}` });
    }
}

async function checkBasicGating(envMap, checks) {
    const appBaseUrl = String(envMap.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    const supabaseUrl = String(envMap.NEXT_PUBLIC_SUPABASE_URL || envMap.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const anonKey = String(envMap.NEXT_PUBLIC_SUPABASE_ANON_KEY || envMap.SUPABASE_ANON_KEY || '').trim();
    const email = String(envMap.SMOKE_EMAIL || envMap.DEMO_ADMIN_EMAIL || '').trim();
    const password = String(envMap.SMOKE_PASSWORD || envMap.DEMO_ADMIN_PASSWORD || '').trim();

    if (!appBaseUrl || !supabaseUrl || !anonKey || !email || !password) {
        checks.push({
            id: 'gating.basic',
            status: 'WARN',
            detail: 'Gating básico omitido por falta de credenciales mínimas.',
        });
        return;
    }

    try {
        const token = await loginSupabase(supabaseUrl, anonKey, email, password);
        const managerView = await reqJson(`${appBaseUrl}/api/aap/leads/manager-view?limit=1`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        const acceptable = managerView.status === 200 || managerView.status === 402 || managerView.status === 403;
        if (acceptable) {
            checks.push({
                id: 'gating.basic',
                status: 'PASS',
                detail: `Gating básico compatible (manager-view status ${managerView.status}).`,
            });
        } else {
            checks.push({
                id: 'gating.basic',
                status: 'FAIL',
                detail: `Gating incompatible: manager-view status ${managerView.status}.`,
            });
        }
    } catch (error) {
        checks.push({
            id: 'gating.basic',
            status: 'FAIL',
            detail: `Gating básico falló: ${String(error?.message || error)}`,
        });
    }
}

function runNodeScript(scriptPath, envMap, scriptArgs = []) {
    return new Promise((resolve) => {
        const startedAt = Date.now();
        const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
            cwd: process.cwd(),
            env: envMap,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });

        child.on('error', (err) => {
            resolve({
                exitCode: 1,
                durationMs: Date.now() - startedAt,
                stdout,
                stderr: `${stderr}\n${String(err?.message || err)}`.trim(),
            });
        });

        child.on('close', (code) => {
            resolve({
                exitCode: Number.isInteger(code) ? code : 1,
                durationMs: Date.now() - startedAt,
                stdout,
                stderr,
            });
        });
    });
}

async function checkDatasetMinimal(envMap, checks, args) {
    if (String(args.skipDataset || '').trim().toLowerCase() === 'true') {
        checks.push({ id: 'dataset.demo', status: 'WARN', detail: 'Validación de dataset omitida por --skipDataset.' });
        return;
    }

    const run = await runNodeScript('scripts/validate-demo-seed-data.js', envMap);
    if (run.exitCode === 0) {
        checks.push({ id: 'dataset.demo', status: 'PASS', detail: `Dataset demo válido (${ms(run.durationMs)}).` });
        return;
    }

    let parsed = null;
    try {
        const raw = String(run.stdout || run.stderr || '').trim();
        if (raw.startsWith('{')) parsed = JSON.parse(raw);
    } catch {
        parsed = null;
    }
    const detail = parsed?.error
        ? `Dataset inválido: ${parsed.error}`
        : `Dataset inválido (exit ${run.exitCode}). Ejecuta seed:demo + validate:seed-demo.`;
    checks.push({ id: 'dataset.demo', status: 'FAIL', detail });
}

function computeDrift(pack, envMap, checks) {
    const catalog = createSmokeCatalog();
    const execution = buildExecutionList(pack, catalog);
    const missingBySmoke = execution
        .map((smoke) => ({ smokeId: smoke.id, missing: missingEnvKeys(smoke.requiredEnv || [], envMap) }))
        .filter((x) => x.missing.length > 0);

    if (missingBySmoke.length === 0) {
        checks.push({ id: 'drift.pack', status: 'PASS', detail: `Sin drift crítico de prerequisitos para pack ${pack}.` });
        return;
    }

    const detail = missingBySmoke
        .map((x) => `${x.smokeId}: ${x.missing.join(', ')}`)
        .join(' | ');
    checks.push({ id: 'drift.pack', status: 'FAIL', detail: `Drift de prerequisitos detectado -> ${detail}` });
}

function printCheck(check) {
    const tag = `[${check.status}]`.padEnd(7, ' ');
    console.log(`${tag} ${check.id} :: ${check.detail}`);
}

function finalizeReport(pack, startedAt, envClassification, checks) {
    const failures = checks.filter((c) => c.status === 'FAIL');
    const warnings = checks.filter((c) => c.status === 'WARN');
    const status = failures.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'PASS';

    const actionable = [];
    if (envClassification.missingRequired.length > 0) {
        actionable.push(`Configurar variables obligatorias: ${envClassification.missingRequired.join(', ')}`);
    }
    if (envClassification.missingRecommended.length > 0) {
        actionable.push(`Configurar variables recomendadas: ${envClassification.missingRecommended.join(', ')}`);
    }
    for (const fail of failures) actionable.push(fail.detail);

    return {
        generatedAt: new Date().toISOString(),
        status,
        pack,
        durationMs: Date.now() - startedAt,
        summary: {
            totalChecks: checks.length,
            passed: checks.filter((c) => c.status === 'PASS').length,
            warnings: warnings.length,
            failed: failures.length,
        },
        env: envClassification,
        checks,
        warnings: warnings.map((w) => w.detail),
        failures: failures.map((f) => f.detail),
        actionable,
    };
}

async function main() {
    const startedAt = Date.now();
    const args = parseArgs(process.argv);
    const pack = normalizePack(args.pack);
    const checks = [];

    const env = {
        ...loadEnvFile('apps/web/.env.local'),
        ...loadEnvFile('.env.antigravity.local'),
        ...loadEnvFile('.env'),
        ...process.env,
    };

    if (!String(env.NEXT_PUBLIC_SUPABASE_URL || '').trim() && String(env.SUPABASE_URL || '').trim()) {
        env.NEXT_PUBLIC_SUPABASE_URL = String(env.SUPABASE_URL || '').trim();
    }
    if (!String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim() && String(env.SUPABASE_ANON_KEY || '').trim()) {
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY = String(env.SUPABASE_ANON_KEY || '').trim();
    }
    if (String(env.APP_BASE_URL || '').trim()) {
        env.APP_BASE_URL = String(env.APP_BASE_URL).trim().replace(/\/+$/, '');
        env.SMOKE_API_BASE_URL = env.APP_BASE_URL;
    }

    console.log('=== RC Preflight (rápido) ===');
    console.log(`pack: ${pack}`);
    console.log(`APP_BASE_URL: ${env.APP_BASE_URL || '(not set)'}`);

    await checkReachability(env, checks);
    await resolveTenantIdsFromSlug(env, args, checks);

    const envClassification = collectEnvClassification(env, pack);
    if (envClassification.missingRequired.length > 0) {
        checks.push({
            id: 'env.required',
            status: 'FAIL',
            detail: `Faltan variables obligatorias: ${envClassification.missingRequired.join(', ')}`,
        });
    } else {
        checks.push({ id: 'env.required', status: 'PASS', detail: 'Variables obligatorias presentes.' });
    }

    if (envClassification.missingRecommended.length > 0) {
        checks.push({
            id: 'env.recommended',
            status: 'WARN',
            detail: `Variables recomendadas faltantes: ${envClassification.missingRecommended.join(', ')}`,
        });
    } else {
        checks.push({ id: 'env.recommended', status: 'PASS', detail: 'Variables recomendadas presentes.' });
    }

    await checkDatasetMinimal(env, checks, args);
    await checkBasicGating(env, checks);
    computeDrift(pack, env, checks);

    console.log('\n=== Detalle checks ===');
    for (const check of checks) printCheck(check);

    const report = finalizeReport(pack, startedAt, envClassification, checks);

    console.log('\n=== Resumen preflight ===');
    console.log(JSON.stringify({
        status: report.status,
        summary: report.summary,
        actionable: report.actionable,
    }, null, 2));

    if (args.jsonOut) {
        const outPath = path.resolve(process.cwd(), String(args.jsonOut));
        fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        console.log(`JSON report: ${outPath}`);
    }

    process.exit(report.status === 'FAIL' ? 1 : 0);
}

main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
    process.exit(1);
});

