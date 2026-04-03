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

function fail(msg, code = 1) {
    console.error(`❌ ${msg}`);
    process.exit(code);
}

async function main() {
    const args = parseArgs(process.argv);
    const envLocal = loadEnvFile("apps/web/.env.local");
    const envAnti = loadEnvFile(".env.antigravity.local");
    const cfg = { ...envLocal, ...envAnti, ...process.env };

    const apiBaseUrl = String(args.apiBaseUrl || process.env.SMOKE_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
    const tokenArg = String(args.token || "").trim();
    const token = tokenArg || pick(cfg, "SMOKE_BEARER_TOKEN", "NEXT_PUBLIC_SMOKE_BEARER_TOKEN");
    const expectedStatus = Number(args.expectStatus || 200);
    const campaignId = String(args.campaignId || "").trim();

    if (!Number.isFinite(expectedStatus) || expectedStatus < 100 || expectedStatus > 599) {
        fail("expectStatus debe ser un HTTP status válido (100-599)");
    }

    if (!token && expectedStatus !== 401) {
        fail("Falta token para smoke. Define SMOKE_BEARER_TOKEN o usa --token. Para validar 401 usa --expectStatus 401 sin token.");
    }

    const params = new URLSearchParams();
    if (campaignId) params.set("campaign_id", campaignId);
    params.set("limit", "20");

    const url = `${apiBaseUrl}/api/aap/leads/manager-view?${params.toString()}`;
    const headers = {
        "Content-Type": "application/json",
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(url, {
        method: "GET",
        headers,
        cache: "no-store",
    });

    const raw = await res.text();
    let body = null;
    try {
        body = raw ? JSON.parse(raw) : null;
    } catch {
        body = raw;
    }

    if (res.status !== expectedStatus) {
        fail(`Status inesperado. Esperado=${expectedStatus}, recibido=${res.status}. Payload=${typeof body === "string" ? body : JSON.stringify(body)}`);
    }

    if (expectedStatus !== 200) {
        console.log(`✅ smoke-manager-view status check OK (${expectedStatus})`);
        console.log(JSON.stringify({ ok: true, endpoint: url, expectedStatus, receivedStatus: res.status }, null, 2));
        return;
    }

    const requiredKpis = [
        "total",
        "queued",
        "assigned",
        "in_progress",
        "done",
        "with_owner",
        "unassigned",
        "takeover_taken",
        "sla_due_soon",
        "sla_overdue",
        "sla_escalated",
    ];

    const kpis = body?.kpis || {};
    const missing = requiredKpis.filter((key) => typeof kpis[key] !== "number");
    if (missing.length) {
        fail(`Faltan KPIs esperados: ${missing.join(", ")}`);
    }

    if (!Array.isArray(body?.items)) {
        fail("items no es un arreglo");
    }

    const summary = {
        ok: true,
        endpoint: url,
        total: kpis.total,
        queued: kpis.queued,
        in_progress: kpis.in_progress,
        unassigned: kpis.unassigned,
        sla_overdue: kpis.sla_overdue,
        sla_escalated: kpis.sla_escalated,
        sample_items: body.items.length,
    };

    console.log("✅ smoke-manager-view OK");
    console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));

