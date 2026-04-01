// app/api/aap/leads/wow-queue/route.ts
import { NextResponse } from "next/server";
import { resolveTenantFromRequest } from "../../../../../lib/tenant/tenant-request";

function env(name: string, required = true) {
    const v = (process.env[name] || "").trim();
    if (required && !v) throw new Error(`Missing env var: ${name}`);
    return v;
}

function json(status: number, body: unknown) {
    return NextResponse.json(body, { status });
}

function parseIntSafe(v: string | null, fallback: number) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function parseTotalFromContentRange(cr: string | null): number | null {
    // "0-49/4097"
    if (!cr) return null;
    const m = cr.match(/\/(\d+)\s*$/);
    return m ? Number(m[1]) : null;
}

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normFilterValue(s: string) {
    const v = (s || "").trim();
    if (!v) return "";
    const low = v.toLowerCase();
    // soporta "Todos/Todas/All"
    if (["todos", "todas", "all", "any"].includes(low)) return "";
    return v;
}

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const tenant = await resolveTenantFromRequest(req);

        const limit = Math.min(200, Math.max(1, parseIntSafe(url.searchParams.get("limit"), 50)));
        const offset = Math.max(0, parseIntSafe(url.searchParams.get("offset"), 0));

        // ✅ soportamos alias del front: temp -> temperature
        const campaignIdRaw = normFilterValue(url.searchParams.get("campaign_id") || "");
        const temperatureRaw = normFilterValue(
            url.searchParams.get("temperature") || url.searchParams.get("temp") || ""
        ).toLowerCase();
        const priorityRaw = normFilterValue(url.searchParams.get("priority") || "").toUpperCase();
        const workStatusRaw = normFilterValue(url.searchParams.get("work_status") || "").toLowerCase();
        const qRaw = normFilterValue(url.searchParams.get("q") || "");

        const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
        const key =
            (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
        if (!key) throw new Error("Missing env var: NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)");

        const PROFILE = "contact_center";
        const base = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/v_leads_wow_queue`;

        const params = new URLSearchParams();

        if (campaignIdRaw && UUID_RE.test(campaignIdRaw)) {
            params.set("campaign_id", `eq.${campaignIdRaw}`);
        }
        if (!tenant.isSuperAdmin) {
            params.set("tenant_id", `eq.${tenant.tenantId}`);
        }
        if (["caliente", "tibio", "frio"].includes(temperatureRaw)) {
            params.set("lead_temperature", `eq.${temperatureRaw}`);
        }
        if (["P1", "P2", "P3"].includes(priorityRaw)) {
            params.set("priority", `eq.${priorityRaw}`);
        }
        if (["queued", "assigned", "in_progress", "done"].includes(workStatusRaw)) {
            params.set("work_status", `eq.${workStatusRaw}`);
        }

        if (qRaw) {
            const like = `*${qRaw.replace(/%/g, "")}*`;
            // PostgREST or=(a,b,c)
            params.set(
                "or",
                `(${[
                    `phone.ilike.${encodeURIComponent(like)}`,
                    `phone_norm.ilike.${encodeURIComponent(like)}`,
                    `form_id.ilike.${encodeURIComponent(like)}`,
                ].join(",")})`
            );
        }

        params.set("order", "priority.asc,lead_score.desc,sla_due_at.asc,created_at.desc");
        const selectWithWorkQueue =
            "id,campaign_id,campaign,form_id,created_at,phone,phone_norm,lead_score,lead_temperature,priority,sla_due_at,next_best_action,quality_flags,spam_flags,lead_score_reasons,work_queue,work_status,work_assignee_user_id,work_assignee_label,work_assigned_at";
        const selectLegacy =
            "id,campaign_id,campaign,form_id,created_at,phone,phone_norm,lead_score,lead_temperature,priority,sla_due_at,next_best_action,quality_flags,spam_flags,lead_score_reasons";
        params.set("select", selectWithWorkQueue);
        params.set("limit", String(limit));
        params.set("offset", String(offset));

        let endpoint = `${base}?${params.toString()}`;

        const headers = new Headers();
        headers.set("Accept-Profile", PROFILE);
        headers.set("apikey", key);
        headers.set("Authorization", `Bearer ${key}`);
        headers.set("Prefer", "count=exact");

        let res = await fetch(endpoint, { headers, cache: "no-store" });

        if (!res.ok) {
            const details = await res.text().catch(() => "");
            const missingWorkQueueColumns =
                details.includes("work_queue") && details.includes("does not exist");

            if (missingWorkQueueColumns) {
                params.set("select", selectLegacy);
                endpoint = `${base}?${params.toString()}`;
                res = await fetch(endpoint, { headers, cache: "no-store" });
            } else {
                return json(res.status, { error: "PostgREST error", endpoint, details });
            }
        }

        if (!res.ok) {
            const txt = await res.text().catch(() => "");
            return json(res.status, { error: "PostgREST error", endpoint, details: txt });
        }

        const items = await res.json();
        const total = parseTotalFromContentRange(res.headers.get("content-range"));

        return json(200, { items, total, limit, offset, debug: { endpoint } });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Unexpected error";
        return json(500, { error: message, details: String(e) });
    }
}
