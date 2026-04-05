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

function normalizeBool(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    const v = String(value).trim().toLowerCase();
    if (!v) return fallback;
    if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
    return fallback;
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

async function resolveTenantIdsFromSlug(envMap, args) {
    const needsBasic = !String(envMap.SMOKE_BASIC_TENANT_ID || '').trim();
    const needsPro = !String(envMap.SMOKE_PRO_TENANT_ID || '').trim();
    if (!needsBasic && !needsPro) return;

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
    if (needsBasic && !basicSlug) prerequisites.push('SMOKE_BASIC_TENANT_SLUG');
    if (needsPro && !proSlug) prerequisites.push('SMOKE_PRO_TENANT_SLUG');
    if (prerequisites.length > 0) return;

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
    } catch (error) {
        console.log(`[WARN] no se pudo resolver tenant IDs por slug: ${String(error?.message || error)}`);
    }
}

function normalizePack(rawValue) {
    const v = String(rawValue || 'AB').trim().toUpperCase();
    if (v === 'A' || v === 'PACK_A') return 'A';
    if (v === 'AB' || v === 'A+B' || v === 'ALL' || v === 'PACK_AB') return 'AB';
    throw new Error(`Pack inválido: ${rawValue}. Usa --pack A o --pack AB`);
}

function createSmokeCatalog() {
    return {
        A: [
            {
                id: 'release-readiness',
                label: 'release readiness base',
                script: 'scripts/smoke-release-readiness.js',
                critical: true,
                requiredEnv: ['APP_BASE_URL'],
            },
            {
                id: 'packaging-plans',
                label: 'packaging plans / gating',
                script: 'scripts/smoke-packaging-plans.js',
                critical: true,
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
                label: 'billing subscription scaffolding',
                script: 'scripts/smoke-billing-subscription-scaffolding.js',
                critical: true,
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
                label: 'lead automation triggers',
                script: 'scripts/smoke-lead-automation-triggers.js',
                critical: true,
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
                label: 'packaging limits guardrails',
                script: 'scripts/smoke-packaging-limits-guardrails.js',
                critical: false,
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
                label: 'campaign onboarding',
                script: 'scripts/smoke-campaign-onboarding.js',
                critical: false,
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
                label: 'campaign settings',
                script: 'scripts/smoke-campaign-settings.js',
                critical: false,
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

async function resolveRuntimeEnv(args) {
    const envLocal = loadEnvFile('apps/web/.env.local');
    const envAnti = loadEnvFile('.env.antigravity.local');
    const merged = {
        ...envLocal,
        ...envAnti,
        ...process.env,
    };

    const appBaseUrl = String(args.appBaseUrl || merged.APP_BASE_URL || '').trim();
    if (appBaseUrl) {
        merged.APP_BASE_URL = appBaseUrl.replace(/\/+$/, '');
        merged.SMOKE_API_BASE_URL = merged.APP_BASE_URL;
    }

    await resolveTenantIdsFromSlug(merged, args);

    return merged;
}

function missingEnvKeys(requiredEnv, envMap) {
    return requiredEnv.filter((key) => !String(envMap[key] || '').trim());
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
            const text = String(chunk);
            stdout += text;
            process.stdout.write(text);
        });
        child.stderr.on('data', (chunk) => {
            const text = String(chunk);
            stderr += text;
            process.stderr.write(text);
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

async function main() {
    const startedAt = Date.now();
    const args = parseArgs(process.argv);
    const allowCriticalSkip = normalizeBool(args.allowCriticalSkip, false);
    const skipPreflight = normalizeBool(args.skipPreflight, false);
    const pack = normalizePack(args.pack);
    const catalog = createSmokeCatalog();
    const selected = buildExecutionList(pack, catalog);
    const runtimeEnv = await resolveRuntimeEnv(args);

    console.log('=== Release Candidate Smoke Runner (mínimo) ===');
    console.log(`pack: ${pack}`);
    console.log(`allowCriticalSkip: ${allowCriticalSkip}`);
    console.log(`skipPreflight: ${skipPreflight}`);
    console.log(`APP_BASE_URL: ${runtimeEnv.APP_BASE_URL || '(not set)'}`);
    console.log(`SMOKE_BASIC_TENANT_ID: ${runtimeEnv.SMOKE_BASIC_TENANT_ID ? 'resolved' : 'missing'}`);
    console.log(`SMOKE_PRO_TENANT_ID: ${runtimeEnv.SMOKE_PRO_TENANT_ID ? 'resolved' : 'missing'}`);
    console.log(`total smokes en plan: ${selected.length}`);

    if (!skipPreflight) {
        console.log('\n=== Preflight RC (gate previo) ===');
        const preflightArgs = ['--pack', pack];
        if (args.preflightJsonOut) {
            preflightArgs.push('--jsonOut', String(args.preflightJsonOut));
        }
        const preflightRun = await runNodeScript('scripts/preflight-release-candidate.js', runtimeEnv, preflightArgs);
        if (preflightRun.exitCode !== 0) {
            console.log(`[FAIL] preflight RC bloqueó ejecución de smokes (exit=${preflightRun.exitCode})`);
            process.exit(1);
        }
        console.log('[PASS] preflight RC aprobado, continúa smoke runner');
    }

    const results = [];

    for (let index = 0; index < selected.length; index += 1) {
        const smoke = selected[index];
        const title = `${index + 1}/${selected.length} ${smoke.id}`;
        const missing = missingEnvKeys(smoke.requiredEnv || [], runtimeEnv);
        if (missing.length > 0) {
            const criticalPrecheckFail = smoke.critical && !allowCriticalSkip;
            const item = {
                ...smoke,
                status: criticalPrecheckFail ? 'FAIL' : 'SKIP',
                durationMs: 0,
                reason: `${criticalPrecheckFail ? 'Critical precheck failed' : 'Missing env'}: ${missing.join(', ')}`,
                exitCode: criticalPrecheckFail ? 2 : null,
            };
            results.push(item);
            console.log(`\n[${item.status}] ${title} (${smoke.label})`);
            console.log(`       reason: ${item.reason}`);
            continue;
        }

        console.log(`\n[RUN ] ${title} (${smoke.label})`);
        const run = await runNodeScript(smoke.script, runtimeEnv);
        const status = run.exitCode === 0 ? 'PASS' : 'FAIL';
        const item = {
            ...smoke,
            status,
            durationMs: run.durationMs,
            reason: status === 'FAIL' ? `Exit code ${run.exitCode}` : '',
            exitCode: run.exitCode,
        };
        results.push(item);
        console.log(`[${status}] ${smoke.id} | duration=${ms(run.durationMs)} | exitCode=${run.exitCode}`);
    }

    const summary = {
        pack,
        total: results.length,
        passed: results.filter((x) => x.status === 'PASS').length,
        failed: results.filter((x) => x.status === 'FAIL').length,
        skipped: results.filter((x) => x.status === 'SKIP').length,
        durationMs: Date.now() - startedAt,
    };

    const failedCritical = results.filter((x) => x.status === 'FAIL' && x.critical);
    const exitCode = failedCritical.length > 0 ? 1 : 0;

    console.log('\n=== Consolidado release candidate ===');
    for (const item of results) {
        const criticalTag = item.critical ? 'critical' : 'non-critical';
        const base = `- [${item.status}] ${item.id} (${criticalTag}) duration=${ms(item.durationMs)} script=${item.script}`;
        console.log(base);
        if (item.reason) console.log(`    reason: ${item.reason}`);
    }

    console.log('\nResumen:', summary);
    if (failedCritical.length > 0) {
        console.log('Critical failures:');
        for (const f of failedCritical) {
            console.log(`- ${f.id} -> ${f.script} (${f.reason || 'failed'})`);
        }
    }

    if (args.jsonOut) {
        const outPath = path.resolve(process.cwd(), String(args.jsonOut));
        const payload = {
            generatedAt: new Date().toISOString(),
            summary,
            failedCritical: failedCritical.map((x) => ({ id: x.id, script: x.script, reason: x.reason })),
            results: results.map((x) => ({
                id: x.id,
                label: x.label,
                script: x.script,
                critical: x.critical,
                status: x.status,
                durationMs: x.durationMs,
                exitCode: x.exitCode,
                reason: x.reason,
            })),
        };
        fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        console.log(`JSON report: ${outPath}`);
    }

    process.exit(exitCode);
}

main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
});
