import { NextResponse } from "next/server";
import { canPerform } from "@/lib/permissions/access-control";
import { hasPlanFeature, resolveTenantPlanFromRequest } from "@/lib/packaging/tenant-plan";
import { resolveTenantFromRequest } from "@/lib/tenant/tenant-request";
import { extractBearerToken } from "@/lib/tenant/tenant-rpc-server";
import type { UserRole } from "@/lib/tenant/tenant-types";

type WorkStatus = "queued" | "assigned" | "in_progress" | "done";

type CampaignRow = {
    campaign_id: string | null;
    campaign: string | null;
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

function canReadCommercialInsights(role: UserRole | null): boolean {
    if (!role) return false;
    return role === "superadmin" || role === "tenant_admin" || role === "supervisor";
}

function parseTotalFromContentRange(cr: string | null): number {
    if (!cr) return 0;
    const m = cr.match(/\/(\d+)\s*$/);
    return m ? Number(m[1]) : 0;
}

function pct(num: number, den: number) {
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
    return Number(((num / den) * 100).toFixed(1));
}

function safeLabel(input: string | null | undefined) {
    const value = String(input || "").trim();
    return value || null;
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
        if (!hasPlanFeature(plan, "executive_dashboard")) {
            return json(403, {
                error: "Feature not available in current plan",
                code: "FEATURE_NOT_INCLUDED",
                feature: "executive_dashboard",
                plan_code: plan.plan_code,
            });
        }

        if (!canReadCommercialInsights(role)) {
            return json(403, { error: "Forbidden: commercial insights requires supervisor, tenant_admin or superadmin" });
        }

        const url = new URL(req.url);
        const campaignId = (url.searchParams.get("campaign_id") || "").trim();
        const workStatus = (url.searchParams.get("work_status") || "").trim().toLowerCase() as WorkStatus | "";

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

        const buildLeadCountParams = (opts?: {
            campaignId?: string | null;
            workStatus?: WorkStatus | null;
            attended?: boolean;
            inProgress?: boolean;
            doneOrTakeoverClosed?: boolean;
            takeoverTaken?: boolean;
            escalated?: boolean;
            overdue?: boolean;
            withOwner?: boolean;
            unassigned?: boolean;
        }) => {
            const sp = new URLSearchParams();
            if (!tenant.isSuperAdmin) sp.set("tenant_id", `eq.${tenant.tenantId}`);

            const selectedCampaign = opts?.campaignId ?? campaignId;
            if (selectedCampaign && UUID_RE.test(selectedCampaign)) sp.set("campaign_id", `eq.${selectedCampaign}`);

            const selectedWorkStatus = opts?.workStatus ?? (workStatus || null);
            if (selectedWorkStatus && ["queued", "assigned", "in_progress", "done"].includes(selectedWorkStatus)) {
                sp.set("work_status", `eq.${selectedWorkStatus}`);
            }

            if (opts?.attended) {
                sp.set("work_status", "in.(assigned,in_progress,done)");
            }
            if (opts?.inProgress) {
                sp.set("work_status", "eq.in_progress");
            }
            if (opts?.doneOrTakeoverClosed) {
                sp.set("or", "(work_status.eq.done,human_takeover_status.eq.closed)");
            }
            if (opts?.takeoverTaken) {
                sp.set("human_takeover_status", "eq.taken");
            }
            if (opts?.escalated) {
                sp.set("sla_is_escalated", "eq.true");
            }
            if (opts?.overdue) {
                sp.set("sla_status", "eq.overdue");
            }
            if (opts?.withOwner) {
                sp.set("work_assignee_user_id", "not.is.null");
            }
            if (opts?.unassigned) {
                sp.set("work_assignee_user_id", "is.null");
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

        const total = await countBy(leadsBase, buildLeadCountParams());
        const queued = await countBy(leadsBase, buildLeadCountParams({ workStatus: "queued" }));
        const assigned = await countBy(leadsBase, buildLeadCountParams({ workStatus: "assigned" }));
        const inProgress = await countBy(leadsBase, buildLeadCountParams({ inProgress: true }));
        const attended = await countBy(leadsBase, buildLeadCountParams({ attended: true }));
        const closed = await countBy(leadsBase, buildLeadCountParams({ doneOrTakeoverClosed: true }));
        const takeoverTaken = await countBy(leadsBase, buildLeadCountParams({ takeoverTaken: true }));
        const escalated = await countBy(leadsBase, buildLeadCountParams({ escalated: true }));
        const overdue = await countBy(leadsBase, buildLeadCountParams({ overdue: true }));
        const withOwner = await countBy(leadsBase, buildLeadCountParams({ withOwner: true }));
        const unassigned = await countBy(leadsBase, buildLeadCountParams({ unassigned: true }));

        const campaignParams = new URLSearchParams();
        campaignParams.set("select", "campaign_id,campaign");
        campaignParams.set("limit", "10000");
        if (!tenant.isSuperAdmin) campaignParams.set("tenant_id", `eq.${tenant.tenantId}`);
        if (campaignId && UUID_RE.test(campaignId)) campaignParams.set("campaign_id", `eq.${campaignId}`);

        const campaignRes = await fetch(`${queueBase}?${campaignParams.toString()}`, { headers, cache: "no-store" });
        const campaignRows = campaignRes.ok
            ? (((await campaignRes.json().catch(() => [])) as CampaignRow[]) || [])
            : [];

        const campaignMap = new Map<string, { id: string; name: string | null }>();
        for (const row of campaignRows) {
            const id = String(row?.campaign_id || "").trim();
            if (!UUID_RE.test(id)) continue;
            if (!campaignMap.has(id)) {
                campaignMap.set(id, {
                    id,
                    name: safeLabel(row?.campaign),
                });
            }
        }

        const campaignBreakdown: Array<{
            campaign_id: string;
            campaign_name: string | null;
            leads_total: number;
            attended: number;
            in_progress: number;
            closed: number;
            takeover_taken: number;
            escalated: number;
            overdue: number;
            conversion_rate_pct: number;
            attended_rate_pct: number;
            bottleneck_rate_pct: number;
        }> = [];

        for (const campaign of campaignMap.values()) {
            const leadsTotal = await countBy(leadsBase, buildLeadCountParams({ campaignId: campaign.id }));
            const campaignAttended = await countBy(leadsBase, buildLeadCountParams({ campaignId: campaign.id, attended: true }));
            const campaignInProgress = await countBy(leadsBase, buildLeadCountParams({ campaignId: campaign.id, inProgress: true }));
            const campaignClosed = await countBy(leadsBase, buildLeadCountParams({ campaignId: campaign.id, doneOrTakeoverClosed: true }));
            const campaignTakeover = await countBy(leadsBase, buildLeadCountParams({ campaignId: campaign.id, takeoverTaken: true }));
            const campaignEscalated = await countBy(leadsBase, buildLeadCountParams({ campaignId: campaign.id, escalated: true }));
            const campaignOverdue = await countBy(leadsBase, buildLeadCountParams({ campaignId: campaign.id, overdue: true }));

            campaignBreakdown.push({
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                leads_total: leadsTotal,
                attended: campaignAttended,
                in_progress: campaignInProgress,
                closed: campaignClosed,
                takeover_taken: campaignTakeover,
                escalated: campaignEscalated,
                overdue: campaignOverdue,
                conversion_rate_pct: pct(campaignClosed, leadsTotal),
                attended_rate_pct: pct(campaignAttended, leadsTotal),
                bottleneck_rate_pct: pct(campaignInProgress + campaignOverdue, leadsTotal),
            });
        }

        campaignBreakdown.sort((a, b) => {
            if (b.conversion_rate_pct !== a.conversion_rate_pct) return b.conversion_rate_pct - a.conversion_rate_pct;
            return b.leads_total - a.leads_total;
        });

        const kpis = {
            total,
            funnel: {
                queued,
                assigned,
                in_progress: inProgress,
                closed,
            },
            attended,
            with_owner: withOwner,
            unassigned,
            takeover_taken: takeoverTaken,
            escalated,
            overdue,
            rates: {
                attended_pct: pct(attended, total),
                conversion_pct: pct(closed, total),
                takeover_pct: pct(takeoverTaken, total),
                escalated_pct: pct(escalated, total),
                bottleneck_pct: pct(inProgress + overdue, total),
            },
        };

        const bottlenecks = [
            {
                key: "in_progress",
                label: "En progreso alto",
                value: inProgress,
                rate_pct: pct(inProgress, total),
            },
            {
                key: "overdue",
                label: "SLA vencido",
                value: overdue,
                rate_pct: pct(overdue, total),
            },
            {
                key: "unassigned",
                label: "Sin owner",
                value: unassigned,
                rate_pct: pct(unassigned, total),
            },
        ].sort((a, b) => b.rate_pct - a.rate_pct);

        return json(200, {
            filters: {
                campaign_id: campaignId || null,
                work_status: ["queued", "assigned", "in_progress", "done"].includes(workStatus) ? workStatus : null,
            },
            kpis,
            bottlenecks,
            campaign_breakdown: campaignBreakdown,
            meta: {
                role,
                tenant_id: tenant.tenantId,
            },
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Unexpected error";
        return json(500, { error: message, details: String(e) });
    }
}
