import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

const env = {
    ...loadEnvFile(".env.antigravity.local"),
    ...loadEnvFile("apps/web/.env.local"),
    ...process.env,
};

const baseUrl = String(env.SMOKE_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const apiKey = String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "").trim();

if (!supabaseUrl || !serviceKey || !apiKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

const results = [];

function short(v) {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 260 ? s.slice(0, 260) + "..." : s;
}

async function reqJson(url, options = {}) {
    const res = await fetch(url, options);
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { ok: res.ok, status: res.status, body, headers: res.headers };
}

async function ensureUser(email, password, role) {
    const adminHeaders = {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
    };

    const createRes = await reqJson(`${supabaseUrl}/auth/v1/admin/users`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            app_metadata: { role, bootstrap: true },
            user_metadata: { source: "validate-manager-view" },
        }),
    });

    let userId = createRes.body?.id || null;

    if (!userId) {
        for (let page = 1; page <= 10 && !userId; page++) {
            const listRes = await reqJson(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=100`, {
                method: "GET",
                headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
            });
            const users = Array.isArray(listRes.body?.users) ? listRes.body.users : [];
            const found = users.find((u) => String(u?.email || "").toLowerCase() === email.toLowerCase());
            if (found?.id) userId = found.id;
            if (users.length < 100) break;
        }
    }

    if (!userId) {
        throw new Error(`Cannot ensure user ${email}: ${short(createRes.body)}`);
    }

    const linkRes = await reqJson(`${supabaseUrl}/rest/v1/rpc/bootstrap_link_user_to_default_tenant`, {
        method: "POST",
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Accept-Profile": "platform_core",
            "Content-Profile": "platform_core",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_user_id: userId, p_role: role, p_make_primary: true }),
    });

    if (!linkRes.ok) {
        throw new Error(`Cannot link user ${email} to default tenant: ${short(linkRes.body)}`);
    }

    return userId;
}

async function login(email, password) {
    const res = await reqJson(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
            apikey: apiKey,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
    });

    if (!res.ok || !res.body?.access_token) {
        throw new Error(`Login failed ${email}: ${short(res.body)}`);
    }
    return String(res.body.access_token);
}

async function callManager(token, query = "") {
    const endpoint = `${baseUrl}/api/aap/leads/manager-view${query ? `?${query}` : ""}`;
    const res = await reqJson(endpoint, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
    });
    return { endpoint, ...res };
}

function pushCheck(name, operation, surface, response, pass, interpretation) {
    results.push({
        check: name,
        operation,
        surface,
        httpStatus: response?.status ?? null,
        pass,
        snippet: short(response?.body),
        interpretation,
    });
}

(async () => {
    const managerEmail = "demo.manager@local.test";
    const managerPassword = "DemoManager123!";
    const agentEmail = "demo.agent@local.test";
    const agentPassword = "DemoAgent123!";

    await ensureUser(managerEmail, managerPassword, "tenant_admin");
    await ensureUser(agentEmail, agentPassword, "agent");

    const managerToken = await login(managerEmail, managerPassword);
    const agentToken = await login(agentEmail, agentPassword);

    const tenantCtx = await reqJson(`${baseUrl}/api/tenant/memberships`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${managerToken}`,
            "Content-Type": "application/json",
        },
    });
    const managerTenantId = String(tenantCtx.body?.active?.tenant_id || "");

    let managerCampaignId = "";
    if (managerTenantId) {
        const campaignRes = await reqJson(
            `${supabaseUrl}/rest/v1/campaigns?select=id,tenant_id&tenant_id=eq.${encodeURIComponent(managerTenantId)}&order=created_at.desc&limit=1`,
            {
                method: "GET",
                headers: {
                    apikey: serviceKey,
                    Authorization: `Bearer ${serviceKey}`,
                    "Accept-Profile": "contact_center",
                },
            }
        );

        const existingCampaign = Array.isArray(campaignRes.body) ? campaignRes.body[0] : null;
        if (existingCampaign?.id) {
            managerCampaignId = String(existingCampaign.id);
        } else {
            const stamp = Date.now();
            const createCampaign = await reqJson(`${baseUrl}/api/campaigns`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${managerToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    code: `MV-${stamp}`,
                    name: `Manager View Smoke ${stamp}`,
                }),
            });
            managerCampaignId = String(createCampaign.body?.item?.id || "");
        }
    }

    if (managerCampaignId) {
        await reqJson(`${baseUrl}/api/leads/intake`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${managerToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                items: [
                    {
                        campaign_id: managerCampaignId,
                        source_id: `smoke-manager-view-${Date.now()}`,
                        phone: `51${Math.floor(100000000 + Math.random() * 899999999)}`,
                        channel: "whatsapp",
                    },
                ],
            }),
        });
    }

    const smoke = spawnSync("node", ["scripts/smoke-manager-view.js"], {
        cwd: process.cwd(),
        env: { ...process.env, SMOKE_BEARER_TOKEN: managerToken, SMOKE_API_BASE_URL: baseUrl },
        encoding: "utf8",
    });

    const smokePass = smoke.status === 0;
    results.push({
        check: "Smoke script",
        operation: "Re-ejecutar smoke oficial con token manager",
        surface: "node scripts/smoke-manager-view.js",
        httpStatus: null,
        pass: smokePass,
        snippet: short((smoke.stdout || "") + (smoke.stderr || "")),
        interpretation: smokePass ? "Smoke oficial ejecutado correctamente" : "Smoke oficial falló",
    });

    const base = await callManager(managerToken, "limit=20");
    const requiredKpis = ["total", "queued", "assigned", "in_progress", "done", "with_owner", "unassigned", "takeover_taken", "sla_due_soon", "sla_overdue", "sla_escalated"];
    const missingKpis = requiredKpis.filter((k) => typeof base.body?.kpis?.[k] !== "number");
    pushCheck(
        "Caso A — Acceso manager",
        "GET manager-view con token manager",
        base.endpoint,
        base,
        base.status === 200 && missingKpis.length === 0,
        base.status === 200 ? `Acceso permitido y KPIs mínimos presentes (${missingKpis.length === 0 ? "OK" : "faltan: " + missingKpis.join(", ")})` : "No hubo acceso manager"
    );

    const campaignId = base.body?.items?.find?.((x) => x?.campaign_id)?.campaign_id || managerCampaignId || null;
    const byCampaign = campaignId ? await callManager(managerToken, `campaign_id=${encodeURIComponent(campaignId)}&limit=20`) : null;
    pushCheck(
        "Caso B1 — Filtro campaña",
        campaignId ? `GET con campaign_id=${campaignId}` : "No se pudo seleccionar campaign_id desde items",
        byCampaign?.endpoint || base.endpoint,
        byCampaign || { status: null, body: { warning: "No campaign_id sample" } },
        !!byCampaign && byCampaign.status === 200 && String(byCampaign.body?.filters?.campaign_id || "") === String(campaignId),
        byCampaign ? `Filtro aplicado; total base=${base.body?.kpis?.total}, total filtrado=${byCampaign.body?.kpis?.total}` : "Dataset sin campaign_id en la muestra"
    );

    const workStatus = base.body?.items?.find?.((x) => x?.work_status)?.work_status || "queued";
    const byStatus = await callManager(managerToken, `work_status=${encodeURIComponent(workStatus)}&limit=20`);
    pushCheck(
        "Caso B2 — Filtro work_status",
        `GET con work_status=${workStatus}`,
        byStatus.endpoint,
        byStatus,
        byStatus.status === 200 && byStatus.body?.filters?.work_status === workStatus,
        `Filtro aplicado; total base=${base.body?.kpis?.total}, total filtrado=${byStatus.body?.kpis?.total}`
    );

    const cPass = base.status === 200
        && typeof base.body?.kpis?.total === "number"
        && typeof base.body?.kpis?.takeover_taken === "number"
        && typeof base.body?.kpis?.sla_due_soon === "number"
        && typeof base.body?.alerts?.has_overdue === "boolean";
    pushCheck(
        "Caso C — KPIs y bloques",
        "Validar bloques total/distribución/ownership/takeover/SLA/alertas",
        base.endpoint,
        base,
        cPass,
        "Bloques operativos presentes en payload"
    );

    const first = Array.isArray(base.body?.items) ? base.body.items[0] : null;
    const dPass = base.status === 200
        && Array.isArray(base.body?.items)
        && base.body.items.every((it) => Object.prototype.hasOwnProperty.call(it, "priority")
            && Object.prototype.hasOwnProperty.call(it, "sla_status")
            && Object.prototype.hasOwnProperty.call(it, "work_assignee_label")
            && Object.prototype.hasOwnProperty.call(it, "human_takeover_status")
            && Object.prototype.hasOwnProperty.call(it, "next_best_action"));
    pushCheck(
        "Caso D — Listado priorizado",
        "Validar campos operativos en items (prioridad/SLA/owner/takeover/NBA)",
        base.endpoint,
        { status: base.status, body: first || {} },
        dPass,
        `Items devueltos=${Array.isArray(base.body?.items) ? base.body.items.length : 0}`
    );

    const forbidden = await callManager(agentToken, "limit=20");
    pushCheck(
        "Caso E1 — Guardrail rol no manager",
        "GET manager-view con token agent",
        forbidden.endpoint,
        forbidden,
        forbidden.status === 403,
        forbidden.status === 403 ? "Acceso denegado correctamente para agent" : "Guardrail de rol no aplicado"
    );

    const managerTenant = String(base.body?.meta?.tenant_id || "");
    const otherCampaign = managerTenant
        ? await reqJson(`${supabaseUrl}/rest/v1/campaigns?select=id,tenant_id&tenant_id=neq.${encodeURIComponent(managerTenant)}&order=created_at.desc&limit=1`, {
            method: "GET",
            headers: {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
                "Accept-Profile": "contact_center",
            },
        })
        : null;

    const otherCampaignId = Array.isArray(otherCampaign?.body) && otherCampaign.body[0]?.id ? String(otherCampaign.body[0].id) : null;

    if (otherCampaignId) {
        const tenantSafeRes = await callManager(managerToken, `campaign_id=${encodeURIComponent(otherCampaignId)}&limit=20`);
        pushCheck(
            "Caso E2 — Guardrail tenant-safe",
            `GET con campaign_id de otro tenant (${otherCampaignId})`,
            tenantSafeRes.endpoint,
            tenantSafeRes,
            tenantSafeRes.status === 200 && Number(tenantSafeRes.body?.kpis?.total || 0) === 0 && Array.isArray(tenantSafeRes.body?.items) && tenantSafeRes.body.items.length === 0,
            "No se expusieron datos cross-tenant"
        );
    } else {
        pushCheck(
            "Caso E2 — Guardrail tenant-safe",
            "Intentar validar fuga cross-tenant con campaign_id de otro tenant",
            `${baseUrl}/api/aap/leads/manager-view`,
            { status: otherCampaign?.status ?? null, body: { warning: "No se encontró campaña de otro tenant en ambiente" } },
            false,
            "No hay evidencia cross-tenant disponible en este ambiente para prueba empírica"
        );
    }

    const report = {
        environment: {
            baseUrl,
            supabaseUrl,
            managerEmail,
            agentEmail,
            managerTenant: managerTenant || managerTenantId || null,
            timestamp: new Date().toISOString(),
        },
        results,
        summary: {
            pass: results.filter((r) => r.pass).length,
            fail: results.filter((r) => !r.pass).length,
        },
    };

    console.log(JSON.stringify(report, null, 2));

    if (report.summary.fail > 0) process.exit(1);
})();
