#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(relativePath) {
    const filePath = path.resolve(process.cwd(), relativePath);
    if (!fs.existsSync(filePath)) return {};

    const env = {};
    const content = fs.readFileSync(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || !line.includes("=")) continue;
        const idx = line.indexOf("=");
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
    return env;
}

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) continue;

        const eq = arg.indexOf("=");
        if (eq > -1) {
            out[arg.slice(2, eq)] = arg.slice(eq + 1);
            continue;
        }

        const key = arg.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
            out[key] = true;
        } else {
            out[key] = next;
            i += 1;
        }
    }
    return out;
}

function pick(cfg, ...keys) {
    for (const key of keys) {
        const val = cfg[key];
        if (val !== undefined && val !== null && String(val).trim()) return String(val).trim();
    }
    return "";
}

function clip(text, max = 350) {
    const v = typeof text === "string" ? text : JSON.stringify(text);
    if (!v) return "";
    return v.length > max ? `${v.slice(0, max)}...` : v;
}

async function httpCheck({ name, method, url, headers = {}, body, validators = [] }) {
    const startedAt = Date.now();
    let status = 0;
    let ok = false;
    let parsed = null;
    let raw = "";
    let errorMessage = "";

    try {
        const res = await fetch(url, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            cache: "no-store",
        });

        status = res.status;
        raw = await res.text();
        try {
            parsed = raw ? JSON.parse(raw) : null;
        } catch {
            parsed = raw;
        }
        ok = res.ok;
    } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
    }

    const issues = [];
    for (const validate of validators) {
        const result = validate({ status, ok, parsed, raw, errorMessage });
        if (result !== true) issues.push(result);
    }

    return {
        name,
        method,
        url,
        status,
        elapsedMs: Date.now() - startedAt,
        pass: issues.length === 0,
        issues,
        hasPGRST202: /PGRST202|Function not found/i.test(raw) || /PGRST202|Function not found/i.test(errorMessage),
        sample: clip(parsed ?? raw ?? errorMessage),
    };
}

function isJsonCollection(payload) {
    return Array.isArray(payload) || (payload && typeof payload === "object");
}

async function main() {
    const args = parseArgs(process.argv);

    const envLocal = loadEnvFile("apps/web/.env.local");
    const envAnti = loadEnvFile(".env.antigravity.local");
    const cfg = { ...envLocal, ...envAnti, ...process.env };

    const supabaseUrl = (args.supabaseUrl || pick(cfg, "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")).replace(/\/$/, "");
    const serviceRole = pick(cfg, "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY");
    const anon = pick(cfg, "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const apiKey = args.apiKey || serviceRole || anon;

    const tenantId = String(args.tenantId || "00000000-0000-0000-0000-000000000001");
    const fromPe = String(args.fromPe || "2026-03-30 00:00:00");
    const toPe = String(args.toPe || "2026-03-31 23:59:59");
    const apiBaseUrl = String(args.apiBaseUrl || process.env.SMOKE_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");

    if (!supabaseUrl) throw new Error("Missing Supabase URL. Use --supabaseUrl or set SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL.");
    if (!apiKey) throw new Error("Missing API key. Set SUPABASE_SERVICE_ROLE_KEY (preferred) or ANON key.");

    const rpcHeaders = {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept-Profile": "contact_center",
        "Content-Profile": "contact_center",
    };

    const viewHeaders = {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        "Accept-Profile": "contact_center",
    };

    const localHeaders = {
        "Content-Type": "application/json",
    };

    const checks = [];

    checks.push(
        await httpCheck({
            name: "rpc_calls_kpis tenant-aware",
            method: "POST",
            url: `${supabaseUrl}/rest/v1/rpc/rpc_calls_kpis`,
            headers: rpcHeaders,
            body: {
                p_tenant_id: tenantId,
                p_from_pe: fromPe,
                p_to_pe: toPe,
                p_campaign_id: null,
                p_mode: "human",
                p_bucket: null,
            },
            validators: [
                ({ ok }) => (ok ? true : "HTTP no exitoso"),
                ({ raw, errorMessage }) =>
                    /PGRST202|Function not found/i.test(raw) || /PGRST202|Function not found/i.test(errorMessage)
                        ? "Detectado PGRST202 / Function not found"
                        : true,
                ({ parsed }) => (isJsonCollection(parsed) ? true : "Respuesta no JSON válida"),
            ],
        })
    );

    checks.push(
        await httpCheck({
            name: "v_campaign_stats read",
            method: "GET",
            url: `${supabaseUrl}/rest/v1/v_campaign_stats?select=campaign_id,tenant_id,campaign_code&limit=1`,
            headers: viewHeaders,
            validators: [
                ({ ok }) => (ok ? true : "HTTP no exitoso"),
                ({ raw, errorMessage }) =>
                    /PGRST202|Function not found/i.test(raw) || /PGRST202|Function not found/i.test(errorMessage)
                        ? "Detectado PGRST202 / Function not found"
                        : true,
                ({ parsed }) => (Array.isArray(parsed) ? true : "La vista no devolvió arreglo JSON"),
            ],
        })
    );

    checks.push(
        await httpCheck({
            name: "agent-coach API",
            method: "POST",
            url: `${apiBaseUrl}/api/aap/dashboard/agent-coach/`,
            headers: localHeaders,
            body: {
                p_tenant_id: tenantId,
                p_from_pe: fromPe,
                p_to_pe: toPe,
                p_campaign_id: null,
                p_agent: null,
            },
            validators: [
                ({ ok }) => (ok ? true : "HTTP no exitoso"),
                ({ raw, errorMessage }) =>
                    /PGRST202|Function not found/i.test(raw) || /PGRST202|Function not found/i.test(errorMessage)
                        ? "Detectado PGRST202 / Function not found"
                        : true,
            ],
        })
    );

    checks.push(
        await httpCheck({
            name: "agent-anomalies API",
            method: "POST",
            url: `${apiBaseUrl}/api/aap/dashboard/agent-anomalies/`,
            headers: localHeaders,
            body: {
                p_tenant_id: tenantId,
                p_from_pe: fromPe,
                p_to_pe: toPe,
                p_campaign_id: null,
                p_min_calls: 1,
            },
            validators: [
                ({ ok }) => (ok ? true : "HTTP no exitoso"),
                ({ raw, errorMessage }) =>
                    /PGRST202|Function not found/i.test(raw) || /PGRST202|Function not found/i.test(errorMessage)
                        ? "Detectado PGRST202 / Function not found"
                        : true,
            ],
        })
    );

    checks.push(
        await httpCheck({
            name: "dashboard load",
            method: "GET",
            url: `${apiBaseUrl}/dashboard`,
            headers: {},
            validators: [
                ({ ok }) => (ok ? true : "HTTP no exitoso"),
            ],
        })
    );

    const summary = {
        pass: checks.every((c) => c.pass),
        total: checks.length,
        passed: checks.filter((c) => c.pass).length,
        failed: checks.filter((c) => !c.pass).length,
        hasAnyPGRST202: checks.some((c) => c.hasPGRST202),
    };

    if (args.json === true || args.json === "true") {
        console.log(JSON.stringify({ summary, checks }, null, 2));
    } else {
        console.log("\n=== Smoke Dashboard (tenant-aware) ===");
        for (const check of checks) {
            const icon = check.pass ? "PASS" : "FAIL";
            console.log(`- [${icon}] ${check.name} | status=${check.status} | ${check.elapsedMs}ms`);
            if (!check.pass) {
                for (const issue of check.issues) console.log(`    · ${issue}`);
            }
            if (check.hasPGRST202) {
                console.log("    · ALERTA: detectado PGRST202 / Function not found");
            }
        }
        console.log("\nResumen:", summary);
    }

    process.exit(summary.pass ? 0 : 1);
}

main().catch((err) => {
    console.error("Smoke failed:", err instanceof Error ? err.message : err);
    process.exit(1);
});
