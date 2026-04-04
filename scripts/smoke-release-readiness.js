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

function clip(text, max = 220) {
    const v = typeof text === "string" ? text : JSON.stringify(text);
    if (!v) return "";
    return v.length > max ? `${v.slice(0, max)}...` : v;
}

async function httpCheck({ name, method, url, headers = {}, body, validator }) {
    const startedAt = Date.now();
    let status = 0;
    let raw = "";
    let parsed = null;
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
    } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
    }

    const verdict = validator({ status, parsed, raw, errorMessage });
    return {
        name,
        method,
        url,
        status,
        elapsedMs: Date.now() - startedAt,
        pass: verdict === true,
        issue: verdict === true ? "" : String(verdict || "Validación fallida"),
        sample: clip(parsed ?? raw ?? errorMessage),
    };
}

async function main() {
    const args = parseArgs(process.argv);
    const envLocal = loadEnvFile("apps/web/.env.local");
    const envAnti = loadEnvFile(".env.antigravity.local");
    const cfg = { ...envLocal, ...envAnti, ...process.env };

    const apiBaseUrl = String(args.apiBaseUrl || process.env.SMOKE_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
    const token = String(args.token || pick(cfg, "SMOKE_BEARER_TOKEN", "NEXT_PUBLIC_SMOKE_BEARER_TOKEN") || "").trim();
    const validLeadId = String(args.leadId || "00000000-0000-0000-0000-000000000001").trim();

    const checks = [];

    checks.push(await httpCheck({
        name: "login page disponible",
        method: "GET",
        url: `${apiBaseUrl}/login`,
        validator: ({ status }) => (status === 200 ? true : `Esperado 200, recibido ${status}`),
    }));

    checks.push(await httpCheck({
        name: "dashboard page disponible",
        method: "GET",
        url: `${apiBaseUrl}/dashboard`,
        validator: ({ status }) => (status === 200 ? true : `Esperado 200, recibido ${status}`),
    }));

    checks.push(await httpCheck({
        name: "desk page disponible",
        method: "GET",
        url: `${apiBaseUrl}/leads/desk`,
        validator: ({ status }) => (status === 200 ? true : `Esperado 200, recibido ${status}`),
    }));

    checks.push(await httpCheck({
        name: "manager view API rechaza sin token",
        method: "GET",
        url: `${apiBaseUrl}/api/aap/leads/manager-view?limit=5`,
        validator: ({ status, parsed }) => {
            if (status !== 401) return `Esperado 401 sin token, recibido ${status}`;
            const error = String(parsed?.error || "").toLowerCase();
            return error.includes("missing bearer token") ? true : "Payload 401 no contiene Missing Bearer token";
        },
    }));

    checks.push(await httpCheck({
        name: "work-queue assign API rechaza sin token",
        method: "POST",
        url: `${apiBaseUrl}/api/aap/leads/work-queue/assign`,
        headers: { "Content-Type": "application/json" },
        body: { lead_id: validLeadId, operation: "set_status", work_status: "in_progress" },
        validator: ({ status, parsed }) => {
            if (status !== 401) return `Esperado 401 sin token, recibido ${status}`;
            const error = String(parsed?.error || "").toLowerCase();
            return error.includes("missing bearer token") ? true : "Payload 401 no contiene Missing Bearer token";
        },
    }));

    if (token) {
        const authHeaders = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        };

        checks.push(await httpCheck({
            name: "manager view API responde con token",
            method: "GET",
            url: `${apiBaseUrl}/api/aap/leads/manager-view?limit=10`,
            headers: authHeaders,
            validator: ({ status, parsed }) => {
                if (status !== 200) return `Esperado 200 con token, recibido ${status}`;
                if (!parsed || typeof parsed !== "object") return "Respuesta no JSON";
                if (!Array.isArray(parsed.items)) return "items no es arreglo";
                if (typeof parsed?.kpis?.total !== "number") return "kpis.total inválido";
                return true;
            },
        }));

        checks.push(await httpCheck({
            name: "workspace page disponible con leadId",
            method: "GET",
            url: `${apiBaseUrl}/leads/workspace?leadId=${encodeURIComponent(validLeadId)}`,
            validator: ({ status }) => (status === 200 ? true : `Esperado 200, recibido ${status}`),
        }));
    }

    const summary = {
        pass: checks.every((c) => c.pass),
        total: checks.length,
        passed: checks.filter((c) => c.pass).length,
        failed: checks.filter((c) => !c.pass).length,
        usedTokenChecks: Boolean(token),
    };

    if (args.json === true || args.json === "true") {
        console.log(JSON.stringify({ summary, checks }, null, 2));
    } else {
        console.log("\n=== Smoke Release Readiness MVP ===");
        console.log(`apiBaseUrl: ${apiBaseUrl}`);
        console.log(`token checks: ${token ? "enabled" : "disabled"}`);
        for (const check of checks) {
            console.log(`- [${check.pass ? "PASS" : "FAIL"}] ${check.name} | status=${check.status} | ${check.elapsedMs}ms`);
            if (!check.pass) console.log(`    · ${check.issue}`);
        }
        console.log("\nResumen:", summary);
    }

    process.exit(summary.pass ? 0 : 1);
}

main().catch((err) => {
    console.error("Smoke failed:", err instanceof Error ? err.message : err);
    process.exit(1);
});

