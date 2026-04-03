import { NextResponse } from "next/server";
import { canPerform } from "@/lib/permissions/access-control";
import { hasPlanFeature, resolveTenantPlanFromRequest } from "@/lib/packaging/tenant-plan";
import { resolveTenantFromRequest } from "@/lib/tenant/tenant-request";
import { extractBearerToken } from "@/lib/tenant/tenant-rpc-server";
import type { UserRole } from "@/lib/tenant/tenant-types";

type WorkStatus = "queued" | "assigned" | "in_progress" | "done";

type QueueRow = {
    id: string;
    campaign: string | null;
    campaign_id: string | null;
    phone: string | null;
    created_at: string | null;
    priority: "P1" | "P2" | "P3" | null;
    work_status: WorkStatus | null;
    work_assignee_user_id: string | null;
    work_assignee_label: string | null;
    human_takeover_status: "none" | "taken" | "released" | "closed" | null;
    human_takeover_by_label: string | null;
    sla_due_at: string | null;
    sla_status: "no_sla" | "on_time" | "due_soon" | "overdue" | null;
    sla_is_escalated: boolean | null;
    sla_escalation_level: "none" | "warning" | "critical" | null;
    lead_temperature: "caliente" | "tibio" | "frio" | null;
    lead_score: number | null;
    next_best_action: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status: number, body: unknown) {
    return NextResponse.json(body, { status });
}

function env(name: string, required = true) {
    const v = (process.env[name] || "").trim();
    if (required && !v) throw new Error(`Missing env var: ${name}`);
    return v;
}

function normalizeRole(input: unknown): UserRole | null {
    const val = String(input || "").toLowerCase();
    if (val === "superadmin" || val === "tenant_admin" || val === "supervisor" || val === "agent") return val;
    return null;
}

function canReadManagerView(role: UserRole | null): boolean {
    if (!role) return false;
    return role === "superadmin" || role === "tenant_admin" || role === "supervisor";
}

function parseTotalFromContentRange(cr: string | null): number {
    if (!cr) return 0;
    const m = cr.match(/\/(\d+)\s*$/);
    return m ? Number(m[1]) : 0;
}

function priorityWeight(priority: string | null | undefined) {
    const p = String(priority || "").toUpperCase();
    if (p === "P1") return 0;
    if (p === "P2") return 1;
    if (p === "P3") return 2;
    return 9;
}

function takeoverWeight(status: string | null | undefined) {
    const s = String(status || "none").toLowerCase();
    if (s === "taken") return 0;
    if (s === "released") return 1;
    if (s === "closed") return 2;
    return 3;
}

function slaWeight(status: string | null | undefined) {
    const s = String(status || "").toLowerCase();
    if (s === "overdue") return 0;
    if (s === "due_soon") return 1;
    if (s === "on_time") return 2;
    return 3;
}

export async function GET(req: Request) {
    try {
        const token = extractBearerToken(req);
        if (!token) return json(401, { error: "Missing Bearer token" });

        let tenant;
        try {
            tenant = await resolveTenantFromRequest(req, { fallbackEnabled: false });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            return json(403, { error: "No active tenant context", details: message });
        }

        const role = normalizeRole(tenant.role);
        if (!tenant?.tenantId || !role) return json(403, { error: "No active tenant context" });
        if (!canPerform(role, "leads", "read")) return json(403, { error: "Forbidden: leads read required" });

        const plan = await resolveTenantPlanFromRequest(req);
        if (!hasPlanFeature(plan, "manager_view")) {
            return json(403, {
                error: "Feature not available in current plan",
                code: "FEATURE_NOT_INCLUDED",
                feature: "manager_view",
                plan_code: plan.plan_code,
            });
        }

        if (!canReadManagerView(role)) {
            return json(403, { error: "Forbidden: manager view requires supervisor, tenant_admin or superadmin" });
        }

        const url = new URL(req.url);
        const campaignId = (url.searchParams.get("campaign_id") || "").trim();
        const workStatus = (url.searchParams.get("work_status") || "").trim().toLowerCase();
        const qRaw = (url.searchParams.get("q") || "").trim();
        const limitRaw = Number(url.searchParams.get("limit") || 30);
        const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(5, limitRaw)) : 30;

        const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
        const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
        if (!key) throw new Error("Missing env var: NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)");

        const headers = new Headers();
        headers.set("Accept-Profile", "contact_center");
        headers.set("apikey", key);
        headers.set("Authorization", `Bearer ${token}`);
        headers.set("Prefer", "count=exact");

        const queueBase = `${SUPABASE_URL}/rest/v1/v_leads_wow_queue`;
        const leadsBase = `${SUPABASE_URL}/rest/v1/leads`;

        const probeQueueView = await fetch(
            `${queueBase}?select=id,work_status,work_assignee_user_id&limit=1&offset=0`,
            { headers, cache: "no-store" }
        );
        const probeQueueViewError = probeQueueView.ok ? "" : await probeQueueView.text().catch(() => "");
        const useLegacyLeadsAsQueue = !probeQueueView.ok &&
            probeQueueViewError.includes("v_leads_wow_queue") &&
            probeQueueViewError.includes("does not exist");
        const queueDataBase = useLegacyLeadsAsQueue ? leadsBase : queueBase;

        const buildQueueParams = (opts?: { workStatus?: WorkStatus | null; includeWorkStatus?: boolean }) => {
            const sp = new URLSearchParams();
            if (!tenant.isSuperAdmin) sp.set("tenant_id", `eq.${tenant.tenantId}`);
            if (campaignId && UUID_RE.test(campaignId)) sp.set("campaign_id", `eq.${campaignId}`);

            const includeStatus = opts?.includeWorkStatus !== false;
            const requestedWorkStatus = opts?.workStatus || (workStatus as WorkStatus);
            if (includeStatus && ["queued", "assigned", "in_progress", "done"].includes(requestedWorkStatus)) {
                sp.set("work_status", `eq.${requestedWorkStatus}`);
            }

            if (qRaw) {
                const like = `*${qRaw.replace(/%/g, "")}*`;
                sp.set("or", `(phone.ilike.${like},phone_norm.ilike.${like},form_id.ilike.${like})`);
            }
            return sp;
        };

        const buildLeadsParams = (opts?: { escalated?: boolean; dueSoon?: boolean; overdue?: boolean }) => {
            const sp = new URLSearchParams();
            if (!tenant.isSuperAdmin) sp.set("tenant_id", `eq.${tenant.tenantId}`);
            if (campaignId && UUID_RE.test(campaignId)) sp.set("campaign_id", `eq.${campaignId}`);
            if (["queued", "assigned", "in_progress", "done"].includes(workStatus)) {
                sp.set("work_status", `eq.${workStatus}`);
            }

            if (opts?.escalated) sp.set("sla_is_escalated", "eq.true");
            if (opts?.overdue) {
                sp.set("sla_status", "eq.overdue");
            }

            if (opts?.dueSoon) {
                const nowIso = new Date().toISOString();
                const soonIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();
                sp.set("and", `(sla_due_at.gte.${nowIso},sla_due_at.lte.${soonIso})`);
            }

            sp.set("select", "id");
            sp.set("limit", "1");
            sp.set("offset", "0");
            return sp;
        };

        const countBy = async (base: string, params: URLSearchParams) => {
            const endpoint = `${base}?${params.toString()}`;
            const res = await fetch(endpoint, { headers, cache: "no-store" });
            if (!res.ok) {
                const details = await res.text().catch(() => "");
                throw new Error(`PostgREST count failed: ${res.status} ${details}`);
            }
            return parseTotalFromContentRange(res.headers.get("content-range"));
        };

        const queueCountParams = buildQueueParams();
        queueCountParams.set("select", "id");
        queueCountParams.set("limit", "1");
        queueCountParams.set("offset", "0");
        const total = await countBy(queueDataBase, queueCountParams);

        const queued = await countBy(
            queueDataBase,
            (() => {
                const p = buildQueueParams({ includeWorkStatus: false, workStatus: "queued" });
                p.set("select", "id");
                p.set("limit", "1");
                p.set("offset", "0");
                return p;
            })()
        );

        const assigned = await countBy(
            queueDataBase,
            (() => {
                const p = buildQueueParams({ includeWorkStatus: false, workStatus: "assigned" });
                p.set("select", "id");
                p.set("limit", "1");
                p.set("offset", "0");
                return p;
            })()
        );

        const inProgress = await countBy(
            queueDataBase,
            (() => {
                const p = buildQueueParams({ includeWorkStatus: false, workStatus: "in_progress" });
                p.set("select", "id");
                p.set("limit", "1");
                p.set("offset", "0");
                return p;
            })()
        );

        const done = await countBy(
            queueDataBase,
            (() => {
                const p = buildQueueParams({ includeWorkStatus: false, workStatus: "done" });
                p.set("select", "id");
                p.set("limit", "1");
                p.set("offset", "0");
                return p;
            })()
        );

        const withOwner = await countBy(
            queueDataBase,
            (() => {
                const p = buildQueueParams();
                p.set("work_assignee_user_id", "not.is.null");
                p.set("select", "id");
                p.set("limit", "1");
                p.set("offset", "0");
                return p;
            })()
        );

        const takeoverTaken = await countBy(
            queueDataBase,
            (() => {
                const p = buildQueueParams();
                p.set("human_takeover_status", "eq.taken");
                p.set("select", "id");
                p.set("limit", "1");
                p.set("offset", "0");
                return p;
            })()
        );

        const takeoverReleased = await countBy(
            queueDataBase,
            (() => {
                const p = buildQueueParams();
                p.set("human_takeover_status", "eq.released");
                p.set("select", "id");
                p.set("limit", "1");
                p.set("offset", "0");
                return p;
            })()
        );

        const takeoverClosed = await countBy(
            queueDataBase,
            (() => {
                const p = buildQueueParams();
                p.set("human_takeover_status", "eq.closed");
                p.set("select", "id");
                p.set("limit", "1");
                p.set("offset", "0");
                return p;
            })()
        );

        const slaOverdue = await countBy(leadsBase, buildLeadsParams({ overdue: true }));
        const slaDueSoon = await countBy(leadsBase, buildLeadsParams({ dueSoon: true }));
        const slaEscalated = await countBy(leadsBase, buildLeadsParams({ escalated: true }));

        const listParams = buildQueueParams();
        listParams.set(
            "select",
            "id,campaign,campaign_id,phone,created_at,priority,work_status,work_assignee_user_id,work_assignee_label,human_takeover_status,human_takeover_by_label,sla_due_at,sla_status,sla_is_escalated,sla_escalation_level,lead_temperature,lead_score,next_best_action"
        );
        listParams.set("order", "priority.asc,sla_due_at.asc,created_at.desc");
        listParams.set("limit", String(limit));
        listParams.set("offset", "0");

        if (useLegacyLeadsAsQueue) {
            listParams.set(
                "select",
                "id,campaign_id,phone,created_at,priority,work_status,work_assignee_user_id,work_assignee_label,human_takeover_status,human_takeover_by_label,sla_due_at,sla_status,sla_is_escalated,sla_escalation_level,lead_temperature,lead_score,next_best_action"
            );
        }

        const listEndpoint = `${queueDataBase}?${listParams.toString()}`;
        const listRes = await fetch(listEndpoint, { headers, cache: "no-store" });
        if (!listRes.ok) {
            const details = await listRes.text().catch(() => "");
            throw new Error(`PostgREST manager list failed: ${listRes.status} ${details}`);
        }

        const itemsRaw = (await listRes.json().catch(() => [])) as QueueRow[];
        const items = (Array.isArray(itemsRaw) ? itemsRaw : []).map((row) => {
            if (!useLegacyLeadsAsQueue) return row;
            return {
                ...row,
                campaign: null,
            };
        }).sort((a, b) => {
            const prio = priorityWeight(a.priority) - priorityWeight(b.priority);
            if (prio !== 0) return prio;

            const sla = slaWeight(a.sla_status) - slaWeight(b.sla_status);
            if (sla !== 0) return sla;

            const takeover = takeoverWeight(a.human_takeover_status) - takeoverWeight(b.human_takeover_status);
            if (takeover !== 0) return takeover;

            return String(a.created_at || "").localeCompare(String(b.created_at || ""));
        });

        const unassigned = Math.max(0, total - withOwner);
        const takeoverNone = Math.max(0, total - takeoverTaken - takeoverReleased - takeoverClosed);

        return json(200, {
            filters: {
                campaign_id: campaignId || null,
                work_status: ["queued", "assigned", "in_progress", "done"].includes(workStatus) ? workStatus : null,
                q: qRaw || null,
            },
            kpis: {
                total,
                queued,
                assigned,
                in_progress: inProgress,
                done,
                with_owner: withOwner,
                unassigned,
                takeover_taken: takeoverTaken,
                takeover_released: takeoverReleased,
                takeover_closed: takeoverClosed,
                takeover_none: takeoverNone,
                sla_due_soon: slaDueSoon,
                sla_overdue: slaOverdue,
                sla_escalated: slaEscalated,
            },
            alerts: {
                has_overdue: slaOverdue > 0,
                has_escalated: slaEscalated > 0,
                has_unassigned_load: unassigned > 0,
            },
            items,
            meta: {
                role,
                tenant_id: tenant.tenantId,
                list_limit: limit,
            },
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Unexpected error";
        return json(500, { error: message, details: String(e) });
    }
}

