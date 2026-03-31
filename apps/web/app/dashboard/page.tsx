"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DonutResultChart, CallsTrendChart } from "./DashboardCharts";
import { sbFetch } from "@/lib/supabaseRest";
import { useTenant } from "@/lib/tenant/use-tenant"; // ✅ Corrected path

// -------------------- Types --------------------
type CampaignOption = {
    campaign_id: string;
    campaign_name: string | null;
};

type CallsKpisRow = {
    total_calls: number;
    connected_calls: number;
    not_connected_calls: number;
    connect_rate_pct: number;
    avg_duration_sec: number | null;
};

type DonutRow = {
    result_bucket: string;
    calls: number;
};

type SeriesRow = {
    bucket_ts: string;
    total_calls: number;
    connected_calls: number;
    no_answer_calls: number;
};

type TopCampaignRow = {
    campaign_id: string;
    campaign_name: string | null;
    total_calls: number;
    connected_calls: number;
    connect_rate_pct: number;
};

type TableRow = {
    call_id: string;
    created_at_pe: string; // "YYYY-MM-DD HH:mm:ss" (sin tz)
    campaign_id: string | null;
    campaign_name: string | null;
    mode: string | null; // 'llm' | 'human'
    status_norm: string | null;
    result_bucket: string | null;
    duration_sec: number | null;
    lead_id: string | null;
    twilio_call_sid: string | null;
};

// ---- C5 (cola stale)
type StaleCountRow = { stale_queued: number };
type StaleRow = {
    call_id: string;
    created_at_pe: string;
    age_minutes: number;
    campaign_id: string | null;
    campaign_name: string | null;
    mode: string | null;
    status_norm: string | null;
    twilio_call_sid: string | null;
    lead_id: string | null;
};

// ---- IA Insights
type InsightsResult = {
    executive_summary: string;
    key_metrics: Array<{ label: string; value: string; note: string }>;
    anomalies: Array<{
        severity: "low" | "medium" | "high";
        title: string;
        what_happened: string;
        likely_causes: string[];
        recommended_actions: string[];
    }>;
    next_actions_48h: string[];
    talking_points_for_demo: string[];
};

// ---- Human agent performance
type AgentKpisRow = {
    agent: string | null;
    total_calls: number;
    connected_calls: number;
    connect_rate_pct: string | number;
    avg_duration_sec: string | number | null;
    avg_time_to_start_sec: string | number | null;
};

type SlaBucketRow = {
    bucket: string;
    calls: number;
};

// ---- AI Coach
type AgentCoachPayload = {
    p_from_pe: string;
    p_to_pe: string;
    p_campaign_id: string | null;
    p_agent: string | null;
};

type AgentCoachResult = {
    ok: boolean;
    meta?: {
        sla_target_seconds: number;
        sla_target_pct: number;
        sla_bucket_within_target: string;
    };
    input?: AgentCoachPayload;
    computed?: {
        chosen_agent: string;
        connect_rate_pct: number;
        avg_time_to_start_sec: number;
        avg_duration_sec: number;
        sla_total: number;
        sla_within_target_calls: number;
        sla_within_target_pct: number;
        sla_meets_target: boolean;
        flags: string[];
    };
    coach?: {
        coach_title: string;
        what_is_happening: string;
        hypotheses: string[];
        actions_48h: string[];
        script_sugerido: string[];
        sla_comment: string;
    };
    error?: string;
};

type AgentAnomaliesPayload = {
    p_from_pe: string;
    p_to_pe: string;
    p_campaign_id: string | null;
    p_min_calls?: number | null;
};

type AgentAnomaliesResult = {
    ok: boolean;
    input?: AgentAnomaliesPayload;
    prev_range?: { prev_from_pe: string; prev_to_pe: string };
    stats?: { mean_connect_rate: number; stdev_connect_rate: number };
    per_agent?: Array<{
        agent: string;
        total_calls: number;
        connected_calls: number;
        connect_rate_pct: number;
        avg_time_to_start_sec: number;
        avg_duration_sec: number;
        prev_calls: number;
        prev_connect_rate_pct: number | null;
        delta_connect_rate_pp: number | null;
    }>;
    anomalies?: Array<{
        agent: string;
        severity: "low" | "medium" | "high";
        title: string;
        what_happened: string;
        recommended_actions: string[];
        metrics: {
            total_calls: number;
            connect_rate_pct: number;
            avg_time_to_start_sec: number;
            avg_duration_sec: number;
            prev_calls: number;
            prev_connect_rate_pct: number | null;
            delta_connect_rate_pp: number | null;
            z_rate: number | null;
        };
    }>;
    error?: string;
};

// -------------------- Helpers --------------------
function pad2(n: number) {
    return String(n).padStart(2, "0");
}

function toDateInputValue(d: Date) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(dateStr: string, days: number) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
    dt.setDate(dt.getDate() + days);
    return toDateInputValue(dt);
}

/**
 * Rango PE: [from 00:00, to_exclusive 00:00 del día siguiente]
 */
function buildRange(fromDate: string, toDate: string) {
    const p_from_pe = `${fromDate} 00:00:00`;
    const p_to_pe = `${addDays(toDate, 1)} 00:00:00`; // exclusivo
    return { p_from_pe, p_to_pe };
}

function parsePeTsToDate(peTs: string) {
    const s = String(peTs || "").trim().replace("T", " ");
    const [datePart, timePart] = s.split(" ");
    const [y, m, d] = datePart.split("-").map(Number);
    const [hh, mm, ss] = (timePart ?? "00:00:00").split(":").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, ss ?? 0);
}

function formatDateToPeTs(dt: Date) {
    const yyyy = dt.getFullYear();
    const mm = pad2(dt.getMonth() + 1);
    const dd = pad2(dt.getDate());
    const HH = pad2(dt.getHours());
    const MI = pad2(dt.getMinutes());
    const SS = pad2(dt.getSeconds());
    return `${yyyy}-${mm}-${dd} ${HH}:${MI}:${SS}`;
}

function calcPrevRange(p_from_pe: string, p_to_pe: string) {
    const from = parsePeTsToDate(p_from_pe);
    const to = parsePeTsToDate(p_to_pe);
    const durationMs = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime());
    const prevFrom = new Date(from.getTime() - durationMs);
    return {
        prev_from_pe: formatDateToPeTs(prevFrom),
        prev_to_pe: formatDateToPeTs(prevTo),
    };
}

function num(x: any, d = 0) {
    const n = Number(x);
    return Number.isFinite(n) ? n : d;
}

function fmtNum(v?: number | string | null) {
    if (v == null) return "-";
    const n = Number(v);
    if (Number.isNaN(n)) return "-";
    return Intl.NumberFormat("es-PE").format(n);
}

function fmtPct(v?: number | string | null) {
    if (v == null) return "-";
    const n = Number(v);
    if (Number.isNaN(n)) return "-";
    return `${n.toFixed(1)}%`;
}

function fmtSec(v?: number | string | null) {
    if (v == null) return "-";
    const n = Number(v);
    if (Number.isNaN(n)) return "-";
    const sec = Math.max(0, Math.floor(n));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function peDisplay(ts?: string | null) {
    if (!ts) return "-";
    const s = String(ts).replace("T", " ").trim();
    return s.length >= 19 ? s.slice(0, 19) : s;
}

function prettyBucket(b?: string | null) {
    const x = String(b ?? "").toLowerCase();
    switch (x) {
        case "connected":
            return "Conectada";
        case "queued":
            return "En cola";
        case "initiated":
            return "Iniciada";
        case "no_answer":
            return "No contesta";
        case "busy":
            return "Ocupado";
        case "failed":
            return "Fallida";
        case "canceled":
            return "Cancelada";
        case "orphaned":
            return "Orphaned";
        case "other":
            return "Otros";
        default:
            return b ?? "-";
    }
}

function bucketBadgeClass(bucket?: string | null) {
    const b = String(bucket ?? "").toLowerCase();
    if (b === "connected") return "bg-emerald-100 text-emerald-800 border-emerald-200";
    if (b === "no_answer") return "bg-amber-100 text-amber-800 border-amber-200";
    if (b === "busy") return "bg-orange-100 text-orange-800 border-orange-200";
    if (b === "failed") return "bg-red-100 text-red-800 border-red-200";
    if (b === "canceled") return "bg-gray-100 text-gray-800 border-gray-200";
    if (b === "orphaned") return "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200";
    if (b === "queued") return "bg-blue-100 text-blue-800 border-blue-200";
    if (b === "initiated") return "bg-sky-100 text-sky-800 border-sky-200";
    return "bg-slate-100 text-slate-800 border-slate-200";
}

function toDateOnlyFromTs(ts: string) {
    return ts.slice(0, 10);
}

function hourStartFromBucketTs(ts: string) {
    const s = ts.replace("T", " ");
    return `${s.slice(0, 13)}:00:00`;
}

function addHoursToPeTs(peTs: string, hours: number) {
    const [datePart, timePart] = peTs.split(" ");
    const [y, m, d] = datePart.split("-").map(Number);
    const [hh] = timePart.split(":").map(Number);
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, 0, 0);
    dt.setHours(dt.getHours() + hours);
    return formatDateToPeTs(dt).slice(0, 13) + ":00:00";
}

function pctChange(curr: number, prev: number) {
    if (prev === 0) return null;
    return ((curr - prev) / prev) * 100;
}

function deltaLineCount(curr?: number | null, prev?: number | null) {
    if (curr == null || prev == null) return null;
    const diff = curr - prev;
    const p = pctChange(curr, prev);
    return { diff, pct: p };
}

function deltaLineRate(curr?: number | null, prev?: number | null) {
    if (curr == null || prev == null) return null;
    const diff = curr - prev; // pp
    return { diff };
}

function deltaLineSec(curr?: number | null, prev?: number | null) {
    if (curr == null || prev == null) return null;
    const diff = curr - prev; // seconds
    return { diff };
}

function deltaBadge(diff: number, label: string) {
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
    const abs = Math.abs(diff);

    const cls =
        diff > 0
            ? "bg-emerald-100 text-emerald-800 border-emerald-200"
            : diff < 0
                ? "bg-red-100 text-red-800 border-red-200"
                : "bg-slate-100 text-slate-700 border-slate-200";

    return (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>
            {sign}
            {label.includes("pp") ? abs.toFixed(1) : fmtNum(abs)} {label}
        </span>
    );
}

function normalizeModeLabel(m?: string | null) {
    const x = (m ?? "").toLowerCase();
    if (x === "llm") return "IA (LLM)";
    if (x === "human") return "Humano";
    return "Todos";
}

function severityBadge(sev: "low" | "medium" | "high") {
    const cls =
        sev === "high"
            ? "bg-red-100 text-red-800 border-red-200"
            : sev === "medium"
                ? "bg-amber-100 text-amber-800 border-amber-200"
                : "bg-slate-100 text-slate-800 border-slate-200";
    const label = sev === "high" ? "Alta" : sev === "medium" ? "Media" : "Baja";
    return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${cls}`}>{label}</span>;
}

function coachFlagBadge(flag: string) {
    const f = flag.toLowerCase();
    const cls =
        f.includes("breach") || f.includes("low")
            ? "bg-red-100 text-red-800 border-red-200"
            : f.includes("slow")
                ? "bg-amber-100 text-amber-800 border-amber-200"
                : "bg-slate-100 text-slate-800 border-slate-200";
    return (
        <span key={flag} className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${cls}`}>
            {flag}
        </span>
    );
}

async function sbRpc<T>(fn: string, payload: any, opts?: { profile?: "public" | "contact_center" }): Promise<T> {
    const profile = opts?.profile ?? "contact_center"; // ✅ Default to contact_center
    return sbFetch<T>(`/rest/v1/rpc/${fn}`, {
        method: "POST",
        body: payload,
        headers: { "Content-Profile": profile, "Accept-Profile": profile },
    });
}

async function fetchCampaignOptions(tenantId: string | null): Promise<CampaignOption[]> {
    if (!tenantId) return [];
    return sbFetch<CampaignOption[]>("/rest/v1/v_campaign_stats", {
        query: {
            tenant_id: `eq.${tenantId}`, // ✅ Tenant aware
            select: "campaign_id,campaign_name",
            order: "campaign_name.asc",
            limit: 500,
        },
    });
}

// -------------------- Page --------------------
export default function AapDashboardPage() {
    const { context, loading: tenantLoading } = useTenant(); // ✅ Fixed
    const tenantId = context?.tenantId ?? null; // ✅ Tenant ID extracted

    const STALE_MINUTES = 10;
    const [compareEnabled, setCompareEnabled] = useState(false);

    const [hourFromPe, setHourFromPe] = useState<string | null>(null);
    const [hourToPe, setHourToPe] = useState<string | null>(null);

    // Defaults: últimos 7 días (PE)
    const today = useMemo(() => new Date(), []);
    const [fromDate, setFromDate] = useState(() => {
        const d = new Date(today);
        d.setDate(d.getDate() - 6);
        return toDateInputValue(d);
    });
    const [toDate, setToDate] = useState(() => toDateInputValue(today));

    const [campaignId, setCampaignId] = useState<string>("");
    const [mode, setMode] = useState<string>(""); // '' | 'llm' | 'human'
    const [bucket, setBucket] = useState<string>(""); // '' | buckets
    const [grain, setGrain] = useState<"day" | "hour">("day");

    const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
    const [loadingCampaigns, setLoadingCampaigns] = useState(true);

    // Base dashboard states
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [kpis, setKpis] = useState<CallsKpisRow | null>(null);
    const [kpisLLM, setKpisLLM] = useState<CallsKpisRow | null>(null);
    const [kpisHuman, setKpisHuman] = useState<CallsKpisRow | null>(null);

    const [kpisPrev, setKpisPrev] = useState<CallsKpisRow | null>(null);
    const [kpisLLMPrev, setKpisLLMPrev] = useState<CallsKpisRow | null>(null);
    const [kpisHumanPrev, setKpisHumanPrev] = useState<CallsKpisRow | null>(null);

    const [donut, setDonut] = useState<DonutRow[]>([]);
    const [series, setSeries] = useState<SeriesRow[]>([]);
    const [topCampaigns, setTopCampaigns] = useState<TopCampaignRow[]>([]);

    const [table, setTable] = useState<TableRow[]>([]);
    const [page, setPage] = useState(0);
    const pageSize = 50;

    // C5
    const [staleQueued, setStaleQueued] = useState<number>(0);
    const [staleRows, setStaleRows] = useState<StaleRow[]>([]);

    // IA Insights
    const [insights, setInsights] = useState<InsightsResult | null>(null);
    const [insightsLoading, setInsightsLoading] = useState(false);
    const [insightsError, setInsightsError] = useState<string | null>(null);

    const [notifyLoading, setNotifyLoading] = useState(false);
    const [notifyError, setNotifyError] = useState<string | null>(null);
    const [notifyOk, setNotifyOk] = useState<string | null>(null);

    // Agent panels
    const [agent, setAgent] = useState<string>("");
    const [agents, setAgents] = useState<string[]>([]);
    const [agentKpis, setAgentKpis] = useState<AgentKpisRow[]>([]);
    const [slaBuckets, setSlaBuckets] = useState<SlaBucketRow[]>([]);
    const [agentPanelError, setAgentPanelError] = useState<string | null>(null);

    // AI Coach
    const [coachLoading, setCoachLoading] = useState(false);
    const [coachError, setCoachError] = useState<string | null>(null);
    const [coach, setCoach] = useState<AgentCoachResult | null>(null);

    // Agent anomalies
    const [agentAnomsLoading, setAgentAnomsLoading] = useState(false);
    const [agentAnomsError, setAgentAnomsError] = useState<string | null>(null);
    const [agentAnoms, setAgentAnoms] = useState<AgentAnomaliesResult | null>(null);

    // Avoid race conditions on base reload
    const baseReqIdRef = useRef(0);
    const agentReqIdRef = useRef(0);

    // Range memo
    const range = useMemo(() => {
        if (hourFromPe && hourToPe) return { p_from_pe: hourFromPe, p_to_pe: hourToPe };
        return buildRange(fromDate, toDate);
    }, [fromDate, toDate, hourFromPe, hourToPe]);

    const prevRange = useMemo(() => calcPrevRange(range.p_from_pe, range.p_to_pe), [range.p_from_pe, range.p_to_pe]);

    // Load campaign dropdown
    useEffect(() => {
        if (tenantLoading || !tenantId) return; // ✅ Wait for tenant
        let alive = true;
        (async () => {
            setLoadingCampaigns(true);
            try {
                const data = await fetchCampaignOptions(tenantId);
                if (!alive) return;
                setCampaigns(data ?? []);
            } finally {
                if (!alive) return;
                setLoadingCampaigns(false);
            }
        })();
        return () => {
            alive = false;
        };
    }, [tenantLoading, tenantId]);

    // If hard filters change, reset page
    useEffect(() => {
        setPage(0);
    }, [fromDate, toDate, campaignId, mode, compareEnabled]);

    // -------------------- Actions --------------------
    async function runAgentCoach(selectedAgent: string | null) {
        setCoachLoading(true);
        setCoachError(null);

        try {
            const payload: AgentCoachPayload & { p_tenant_id: string | null } = {
                p_tenant_id: tenantId,
                p_from_pe: range.p_from_pe,
                p_to_pe: range.p_to_pe,
                p_campaign_id: campaignId ? campaignId : null,
                p_agent: selectedAgent ? String(selectedAgent).trim() : null,
            };

            const res = await fetch("/api/aap/dashboard/agent-coach", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const json = (await res.json().catch(() => ({}))) as AgentCoachResult;
            if (!res.ok) throw new Error((json as any)?.error || (json as any)?.message || "Error generando AI Coach");
            setCoach(json);
        } catch (e: any) {
            setCoachError(String(e?.message ?? e));
            setCoach(null);
        } finally {
            setCoachLoading(false);
        }
    }

    useEffect(() => {
        if (mode === "llm" && agent) setAgent("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]);



    async function runAgentAnomalies() {
        setAgentAnomsLoading(true);
        setAgentAnomsError(null);

        try {
            const payload: AgentAnomaliesPayload & { p_tenant_id: string | null } = {
                p_tenant_id: tenantId,
                p_from_pe: range.p_from_pe,
                p_to_pe: range.p_to_pe,
                p_campaign_id: campaignId ? campaignId : null,
                p_min_calls: 15,
            };

            const res = await fetch("/api/aap/dashboard/agent-anomalies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const json = (await res.json().catch(() => ({}))) as AgentAnomaliesResult;
            if (!res.ok) throw new Error((json as any)?.error || (json as any)?.message || "Error detectando anomalías");
            setAgentAnoms(json);
        } catch (e: any) {
            setAgentAnomsError(String(e?.message ?? e));
            setAgentAnoms(null);
        } finally {
            setAgentAnomsLoading(false);
        }
    }

    async function sendMultichannel(
        snapshot: any,
        recipients?: {
            chat_id?: string | null;
            email_to?: string[] | string | null;
        }
    ) {
        const emailToArr = (() => {
            const raw = recipients?.email_to;
            if (!raw) return [];
            if (Array.isArray(raw)) return raw.filter(Boolean);
            return String(raw)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        })();

        const payload: any = { snapshot };
        const chatId = recipients?.chat_id ? String(recipients.chat_id).trim() : "";
        if (chatId || emailToArr.length) {
            payload.recipients = {
                chat_id: chatId || null,
                email_to: emailToArr,
            };
        }

        const res = await fetch("/api/aap/dashboard/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || json?.message || "Notify failed");
        return json;
    }

    async function runInsightsIA() {
        setInsightsLoading(true);
        setInsightsError(null);

        try {
            const donutMap: Record<string, number> = {};
            (donut ?? []).forEach((r) => {
                const key = String(r.result_bucket ?? "").toLowerCase();
                donutMap[key] = (donutMap[key] ?? 0) + Number(r.calls ?? 0);
            });

            const snapshot = {
                filters: {
                    from_pe: range.p_from_pe,
                    to_pe: range.p_to_pe,
                    campaign_id: campaignId ? campaignId : null,
                    mode: mode ? mode : null,
                    grain,
                },
                kpis: {
                    total_calls: Number(kpis?.total_calls ?? 0),
                    connected_calls: Number(kpis?.connected_calls ?? 0),
                    queued_calls: Number(donutMap["queued"] ?? 0),
                    no_answer_calls: Number(donutMap["no_answer"] ?? 0),
                    busy_calls: Number(donutMap["busy"] ?? 0),
                    failed_calls: Number(donutMap["failed"] ?? 0),
                    canceled_calls: Number(donutMap["canceled"] ?? 0),
                    connect_rate:
                        Number(kpis?.total_calls ?? 0) > 0
                            ? Number(kpis?.connected_calls ?? 0) / Number(kpis?.total_calls ?? 1)
                            : 0,
                },
                donut,
                timeseries: series,
                top_campaigns: topCampaigns,
                queue_stale: {
                    stale_queued: staleQueued,
                    stale_minutes: STALE_MINUTES,
                },
            };

            const res = await fetch("/api/aap/dashboard/insights", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ snapshot }),
            });

            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error || json?.message || "Error generando insights IA");
            setInsights(json?.insights ?? null);
        } catch (e: any) {
            setInsightsError(String(e?.message ?? e));
            setInsights(null);
        } finally {
            setInsightsLoading(false);
        }
    }

    async function runNotifyMultichannel(recipients?: { chat_id?: string | null; email_to?: string[] | string | null }) {
        setNotifyLoading(true);
        setNotifyError(null);
        setNotifyOk(null);

        try {
            let finalRecipients = recipients;

            if (!finalRecipients) {
                const emailCsv = window.prompt(
                    "Email(s) destino (separados por coma). Dejar vacío para usar defaults:",
                    "rlopez@procontsys.com"
                );
                const chatId = window.prompt(
                    "Telegram chat_id destino. Dejar vacío para usar defaults:",
                    "1376481410"
                );

                const hasAny = Boolean(emailCsv?.trim()) || Boolean(chatId?.trim());
                if (hasAny) {
                    finalRecipients = {
                        chat_id: chatId?.trim() ? chatId.trim() : null,
                        email_to: emailCsv?.trim() ? emailCsv.trim() : null,
                    };
                } else {
                    finalRecipients = undefined;
                }
            }

            const snapshot = {
                title: "Outbound Dashboard - Resumen",
                filters: {
                    from_pe: range.p_from_pe,
                    to_pe: range.p_to_pe,
                    campaign_id: campaignId ? campaignId : null,
                    mode: mode ? mode : null,
                    grain,
                },
                campaign_name: campaignId
                    ? campaigns.find((c) => c.campaign_id === campaignId)?.campaign_name ?? null
                    : null,
                kpis: {
                    total_calls: Number(kpis?.total_calls ?? 0),
                    connected_calls: Number(kpis?.connected_calls ?? 0),
                    connect_rate:
                        Number(kpis?.total_calls ?? 0) > 0
                            ? Number(kpis?.connected_calls ?? 0) / Number(kpis?.total_calls ?? 1)
                            : 0,
                },
                donut,
                timeseries: series,
                top_campaigns: topCampaigns,
                queue_stale: { stale_queued: staleQueued, stale_minutes: STALE_MINUTES },
            };

            await sendMultichannel(snapshot, finalRecipients);

            const recipientsLabel =
                finalRecipients && (finalRecipients.chat_id || finalRecipients.email_to)
                    ? "✅ Notificación enviada (recipients personalizados)"
                    : "✅ Notificación enviada (defaults)";

            setNotifyOk(recipientsLabel);
        } catch (e: any) {
            setNotifyError(e?.message ?? String(e));
        } finally {
            setNotifyLoading(false);
        }
    }

    // -------------------- Base dashboard load --------------------
    useEffect(() => {
        let alive = true;
        const myId = ++baseReqIdRef.current;

        (async () => {
            setLoading(true);
            setError(null);

            try {
                const common = {
                    p_tenant_id: tenantId,
                    p_from_pe: range.p_from_pe,
                    p_to_pe: range.p_to_pe,
                    p_campaign_id: campaignId ? campaignId : null,
                    p_mode: mode ? mode : null,
                };

                const prevCommon = {
                    p_tenant_id: tenantId,
                    p_from_pe: prevRange.prev_from_pe,
                    p_to_pe: prevRange.prev_to_pe,
                    p_campaign_id: campaignId ? campaignId : null,
                    p_mode: mode ? mode : null,
                };

                // --- CURRENT period (siempre)
                const pKpiAll = sbRpc<CallsKpisRow[]>("rpc_calls_kpis", {
                    ...common,
                    p_bucket: bucket ? bucket : null,
                });
                const pKpiLLM = sbRpc<CallsKpisRow[]>("rpc_calls_kpis", {
                    ...common,
                    p_mode: "llm",
                    p_bucket: bucket ? bucket : null,
                });
                const pKpiHuman = sbRpc<CallsKpisRow[]>("rpc_calls_kpis", {
                    ...common,
                    p_mode: "human",
                    p_bucket: bucket ? bucket : null,
                });

                const pDonut = sbRpc<DonutRow[]>("rpc_calls_donut", { ...common });
                const pSeries = sbRpc<SeriesRow[]>("rpc_calls_timeseries", { ...common, p_grain: grain });
                const pTopCampaigns = sbRpc<TopCampaignRow[]>("rpc_calls_top_campaigns", {
                    p_tenant_id: tenantId,
                    p_from_pe: range.p_from_pe,
                    p_to_pe: range.p_to_pe,
                    p_campaign_id: campaignId ? campaignId : null,
                    p_mode: mode ? mode : null,
                    p_limit: 10,
                });
                const pTable = sbRpc<TableRow[]>("rpc_calls_table", {
                    ...common,
                    p_bucket: bucket ? bucket : null,
                    p_limit: pageSize,
                    p_offset: page * pageSize,
                });

                const pStale1 = sbRpc<StaleCountRow[]>("rpc_calls_queue_stale", {
                    ...common,
                    p_stale_minutes: STALE_MINUTES,
                });
                const pStaleT = sbRpc<StaleRow[]>("rpc_calls_queue_stale_table", {
                    ...common,
                    p_stale_minutes: STALE_MINUTES,
                    p_limit: 10,
                });

                // --- PREV period (solo si compareEnabled)
                let pKpiAllPrev: Promise<CallsKpisRow[] | null> | null = null;
                let pKpiLLMPrev: Promise<CallsKpisRow[] | null> | null = null;
                let pKpiHumanPrev: Promise<CallsKpisRow[] | null> | null = null;

                if (compareEnabled) {
                    pKpiAllPrev = sbRpc<CallsKpisRow[]>("rpc_calls_kpis", {
                        ...prevCommon,
                        p_bucket: bucket ? bucket : null,
                    }).then((x) => x ?? []);
                    pKpiLLMPrev = sbRpc<CallsKpisRow[]>("rpc_calls_kpis", {
                        ...prevCommon,
                        p_mode: "llm",
                        p_bucket: bucket ? bucket : null,
                    }).then((x) => x ?? []);
                    pKpiHumanPrev = sbRpc<CallsKpisRow[]>("rpc_calls_kpis", {
                        ...prevCommon,
                        p_mode: "human",
                        p_bucket: bucket ? bucket : null,
                    }).then((x) => x ?? []);
                }

                // Ejecuta todo lo actual en paralelo
                const [k1, kL, kH, d1, s1, tc, t1, stale1, staleT] = await Promise.all([
                    pKpiAll,
                    pKpiLLM,
                    pKpiHuman,
                    pDonut,
                    pSeries,
                    pTopCampaigns,
                    pTable,
                    pStale1,
                    pStaleT,
                ]);

                // Ejecuta prev (si aplica) en paralelo
                let k1p: CallsKpisRow[] = [];
                let kLp: CallsKpisRow[] = [];
                let kHp: CallsKpisRow[] = [];

                if (compareEnabled) {
                    const [a, b, c] = await Promise.all([pKpiAllPrev!, pKpiLLMPrev!, pKpiHumanPrev!]);
                    k1p = (a ?? []) as any;
                    kLp = (b ?? []) as any;
                    kHp = (c ?? []) as any;
                }

                if (!alive || myId !== baseReqIdRef.current) return;

                // Current
                setKpis((k1 ?? [])[0] ?? null);
                setKpisLLM((kL ?? [])[0] ?? null);
                setKpisHuman((kH ?? [])[0] ?? null);

                // Prev (solo si compareEnabled; si no, limpia)
                if (compareEnabled) {
                    setKpisPrev((k1p ?? [])[0] ?? null);
                    setKpisLLMPrev((kLp ?? [])[0] ?? null);
                    setKpisHumanPrev((kHp ?? [])[0] ?? null);
                } else {
                    setKpisPrev(null);
                    setKpisLLMPrev(null);
                    setKpisHumanPrev(null);
                }

                setDonut(d1 ?? []);
                setSeries(s1 ?? []);
                setTopCampaigns(tc ?? []);
                setTable(t1 ?? []);

                setStaleQueued((stale1 ?? [])[0]?.stale_queued ?? 0);
                setStaleRows(staleT ?? []);

                // Invalidate AI outputs when base filters change
                setInsights(null);
                setInsightsError(null);
                setCoach(null);
                setCoachError(null);
                setAgentAnoms(null);
                setAgentAnomsError(null);
                setNotifyError(null);
                setNotifyOk(null);
            } catch (e: any) {
                if (!alive || myId !== baseReqIdRef.current) return;
                setError(e?.message ?? String(e));
            } finally {
                if (!alive || myId !== baseReqIdRef.current) return;
                setLoading(false);
            }
        })();

        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        range.p_from_pe,
        range.p_to_pe,
        prevRange.prev_from_pe,
        prevRange.prev_to_pe,
        campaignId,
        mode,
        bucket,
        grain,
        page,
        pageSize,
        compareEnabled,
        tenantId,
        tenantLoading,
    ]);


    // -------------------- Agent panels load (best-effort) --------------------
    useEffect(() => {
        let alive = true;
        const myId = ++agentReqIdRef.current;

        (async () => {
            setAgentPanelError(null);

            // Nota: agentKpis (tabla) SIEMPRE es "todos" (p_agent: null)
            // SLA sí se filtra por agent seleccionado.
            const base = {
                p_tenant_id: tenantId,
                p_from_pe: range.p_from_pe,
                p_to_pe: range.p_to_pe,
                p_campaign_id: campaignId ? campaignId : null,
                p_mode: "human",
            };

            const slaBase = {
                p_tenant_id: tenantId,
                p_from_pe: range.p_from_pe,
                p_to_pe: range.p_to_pe,
                p_campaign_id: campaignId ? campaignId : null,
            };

            try {
                const settled = await Promise.allSettled([
                    // Esta RPC puede devolver columnas `agent/calls` o `agente/cnt` según tu SQL actual
                    sbRpc<any[]>("rpc_calls_agent_list", base),

                    sbRpc<AgentKpisRow[]>("rpc_calls_agent_kpis", { ...base, p_agent: null }),

                    sbRpc<SlaBucketRow[]>(
                        "rpc_calls_sla_buckets",
                        { ...slaBase, p_agent: agent ? agent : null }
                    ),
                ]);

                if (!alive || myId !== agentReqIdRef.current) return;

                // Agent list
                if (settled[0].status === "fulfilled") {
                    const rows = settled[0].value ?? [];

                    const list = rows
                        .map((x: any) =>
                            String(
                                (x?.agent ??
                                    x?.agente ?? // <- tu caso
                                    x?.human_taken_by ??
                                    x?.human_taken_by_original ??
                                    x?.assigned_to ??
                                    x?.advisor ??
                                    x?.user_id ??
                                    "") ?? ""
                            ).trim()
                        )
                        .filter(Boolean);

                    setAgents(Array.from(new Set(list)));
                } else {
                    setAgents([]);
                }

                // Agent KPIs (tabla)
                if (settled[1].status === "fulfilled") {
                    setAgentKpis(settled[1].value ?? []);
                } else {
                    setAgentKpis([]);
                }

                // SLA buckets
                if (settled[2].status === "fulfilled") {
                    setSlaBuckets(settled[2].value ?? []);
                } else {
                    setSlaBuckets([]);
                }

                // Error banner solo si todo falla
                const allFailed = settled.every((x) => x.status === "rejected");
                if (allFailed) {
                    setAgentPanelError("RPCs de agente/SLA no disponibles (o no expuestos en PostgREST).");
                }
            } catch {
                if (!alive || myId !== agentReqIdRef.current) return;
                setAgentPanelError("No se pudo cargar el panel de agentes/SLA.");
                setAgents([]);
                setAgentKpis([]);
                setSlaBuckets([]);
            }
        })();

        return () => {
            alive = false;
        };
    }, [
        range.p_from_pe,
        range.p_to_pe,
        campaignId,
        agent,
        mode,
        tenantId,
        tenantLoading
    ]);

    // -------------------- Derived --------------------
    const donutTotal = useMemo(() => donut.reduce((a, b) => a + Number(b.calls ?? 0), 0), [donut]);

    const appliedRangeText = useMemo(() => {
        if (hourFromPe && hourToPe) return `${hourFromPe} → ${hourToPe} (excl.)`;
        return `${range.p_from_pe} → ${range.p_to_pe} (excl.)`;
    }, [hourFromPe, hourToPe, range.p_from_pe, range.p_to_pe]);

    const deltaTotal = useMemo(
        () => deltaLineCount(kpis?.total_calls ?? null, kpisPrev?.total_calls ?? null),
        [kpis, kpisPrev]
    );
    const deltaConn = useMemo(
        () => deltaLineCount(kpis?.connected_calls ?? null, kpisPrev?.connected_calls ?? null),
        [kpis, kpisPrev]
    );
    const deltaRate = useMemo(
        () => deltaLineRate(kpis?.connect_rate_pct ?? null, kpisPrev?.connect_rate_pct ?? null),
        [kpis, kpisPrev]
    );
    const deltaDur = useMemo(
        () => deltaLineSec(kpis?.avg_duration_sec ?? null, kpisPrev?.avg_duration_sec ?? null),
        [kpis, kpisPrev]
    );

    const deltaLLM = useMemo(
        () => deltaLineCount(kpisLLM?.total_calls ?? null, kpisLLMPrev?.total_calls ?? null),
        [kpisLLM, kpisLLMPrev]
    );
    const deltaHuman = useMemo(
        () => deltaLineCount(kpisHuman?.total_calls ?? null, kpisHumanPrev?.total_calls ?? null),
        [kpisHuman, kpisHumanPrev]
    );

    const insightsHeader = useMemo(() => {
        const campName = campaignId
            ? campaigns.find((c) => c.campaign_id === campaignId)?.campaign_name ?? "Campaña"
            : "Todas las campañas";
        return `${campName} · ${normalizeModeLabel(mode)} · ${grain === "hour" ? "Hora" : "Día"}`;
    }, [campaignId, campaigns, mode, grain]);

    const slaTotal = useMemo(() => (slaBuckets ?? []).reduce((a, b) => a + Number(b.calls ?? 0), 0), [slaBuckets]);

    const coachHeader = useMemo(() => {
        const a = coach?.computed?.chosen_agent || (agent ? agent : "");
        const pct = coach?.computed?.sla_within_target_pct;
        const ok = coach?.computed?.sla_meets_target;
        const tgt = coach?.meta?.sla_target_pct;
        const sec = coach?.meta?.sla_target_seconds;

        if (!coach || !a) return null;
        const slaTxt = pct == null ? "" : `${pct.toFixed(1)}%`;
        const tgtTxt = tgt != null && sec != null ? ` (meta ${tgt}% <= ${sec}s)` : "";
        return {
            agent: a,
            sla: slaTxt ? `${slaTxt}${tgtTxt}` : null,
            ok: ok ?? null,
        };
    }, [coach, agent]);

    // -------------------- UI --------------------
    if (tenantLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 p-8 text-slate-500">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600"></div>
                    <p className="text-lg font-medium animate-pulse">Cargando contexto de cliente...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold">Dashboard Outbound</h1>
                    <p className="text-sm text-muted-foreground">
                        Llamadas salientes (Humano + IA). Conectada = <span className="font-mono">completed</span> o{" "}
                        <span className="font-mono">in-progress</span>.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Link
                        href="/campaigns"
                        className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-muted"
                    >
                        Ver campañas
                    </Link>
                </div>
            </div>

            {/* Filters */}
            <div className="rounded-xl border p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                    <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Desde</div>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => {
                                setHourFromPe(null);
                                setHourToPe(null);
                                setFromDate(e.target.value);
                            }}
                            className="w-full rounded-md border px-3 py-2 text-sm"
                        />
                    </div>

                    <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Hasta</div>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => {
                                setHourFromPe(null);
                                setHourToPe(null);
                                setToDate(e.target.value);
                            }}
                            className="w-full rounded-md border px-3 py-2 text-sm"
                        />
                    </div>

                    <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Campaña</div>
                        <select
                            value={campaignId}
                            onChange={(e) => {
                                setHourFromPe(null);
                                setHourToPe(null);
                                setCampaignId(e.target.value);
                            }}
                            className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                            disabled={loadingCampaigns}
                        >
                            <option value="">Todas</option>
                            {campaigns.map((c) => (
                                <option key={c.campaign_id} value={c.campaign_id}>
                                    {c.campaign_name ?? "(sin nombre)"}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Modo</div>
                        <select
                            value={mode}
                            onChange={(e) => {
                                setHourFromPe(null);
                                setHourToPe(null);
                                setMode(e.target.value);
                            }}
                            className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                        >
                            <option value="">Todos</option>
                            <option value="llm">IA (LLM)</option>
                            <option value="human">Humano</option>
                        </select>
                    </div>

                    <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Resultado</div>
                        <select
                            value={bucket}
                            onChange={(e) => {
                                setHourFromPe(null);
                                setHourToPe(null);
                                setBucket(e.target.value);
                            }}
                            className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                        >
                            <option value="">Todos</option>
                            <option value="connected">Conectada</option>
                            <option value="queued">En cola</option>
                            <option value="initiated">Iniciada</option>
                            <option value="no_answer">No contesta</option>
                            <option value="busy">Ocupado</option>
                            <option value="failed">Fallida</option>
                            <option value="canceled">Cancelada</option>
                            <option value="orphaned">Orphaned</option>
                            <option value="other">Otros</option>
                        </select>
                    </div>

                    {/* Agent filter */}
                    {mode !== "llm" && (
                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Agente (humano)</div>
                            <select
                                value={agent}
                                onChange={(e) => setAgent(e.target.value)}
                                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                                disabled={agents.length === 0}
                            >
                                <option value="">Todos</option>
                                {agents.map((a) => (
                                    <option key={a} value={a}>
                                        {a}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}


                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-xs text-muted-foreground">
                        Rango aplicado (PE): <span className="font-mono">{appliedRangeText}</span>
                        <label className="ml-3 inline-flex items-center gap-2 text-muted-foreground">
                            <input
                                type="checkbox"
                                checked={compareEnabled}
                                onChange={(e) => setCompareEnabled(e.target.checked)}
                            />
                            Comparar vs período anterior
                        </label>

                    </div>

                    <div className="flex items-center gap-2">
                        <div className="text-xs text-muted-foreground">Agrupar</div>
                        <select
                            value={grain}
                            onChange={(e) => {
                                setHourFromPe(null);
                                setHourToPe(null);
                                setGrain((e.target.value as any) || "day");
                            }}
                            className="rounded-md border px-3 py-2 text-sm bg-background"
                        >
                            <option value="day">Día</option>
                            <option value="hour">Hora</option>
                        </select>
                    </div>
                </div>

                {hourFromPe && hourToPe && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">
                            Hora seleccionada (PE): {hourFromPe} → {hourToPe}
                        </span>
                        <button
                            className="rounded-md border px-2 py-1 hover:bg-muted"
                            onClick={() => {
                                setHourFromPe(null);
                                setHourToPe(null);
                            }}
                        >
                            Limpiar
                        </button>
                    </div>
                )}
            </div>

            {loading && <div className="rounded-xl border p-4 text-sm text-muted-foreground">Cargando métricas…</div>}

            {error && (
                <div className="rounded-xl border p-4 text-sm text-red-600">
                    Error: {error}
                </div>
            )}

            {!loading && !error && (
                <>
                    {/* KPI Cards + deltas */}
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                        <div className="rounded-xl border p-4">
                            <div className="text-xs text-muted-foreground">Total llamadas</div>
                            <div className="text-2xl font-semibold">{fmtNum(kpis?.total_calls)}</div>
                            <div className="mt-1 text-xs flex items-center gap-2">
                                {deltaTotal && deltaBadge(deltaTotal.diff, "llamadas")}
                                {deltaTotal?.pct != null && (
                                    <span className="text-muted-foreground">
                                        ({deltaTotal.pct > 0 ? "+" : ""}
                                        {deltaTotal.pct.toFixed(1)}%)
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="rounded-xl border p-4">
                            <div className="text-xs text-muted-foreground">Conectadas</div>
                            <div className="text-2xl font-semibold">{fmtNum(kpis?.connected_calls)}</div>
                            <div className="text-xs text-muted-foreground">Rate: {fmtPct(kpis?.connect_rate_pct)}</div>
                            <div className="mt-1 text-xs flex items-center gap-2">
                                {deltaConn && deltaBadge(deltaConn.diff, "conectadas")}
                                {deltaRate && deltaBadge(deltaRate.diff, "pp")}
                            </div>
                        </div>

                        <div className="rounded-xl border p-4">
                            <div className="text-xs text-muted-foreground">No conectadas</div>
                            <div className="text-2xl font-semibold">{fmtNum(kpis?.not_connected_calls)}</div>
                        </div>

                        <div className="rounded-xl border p-4">
                            <div className="text-xs text-muted-foreground">Duración prom.</div>
                            <div className="text-2xl font-semibold">{fmtSec(kpis?.avg_duration_sec ?? null)}</div>
                            <div className="mt-1 text-xs">
                                {deltaDur && (
                                    <span className="inline-flex items-center gap-2">
                                        {deltaBadge(deltaDur.diff, "s")}
                                        <span className="text-muted-foreground">(vs período anterior)</span>
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="rounded-xl border p-4">
                            <div className="text-xs text-muted-foreground">IA vs Humano</div>
                            <div className="text-sm mt-1 space-y-1">
                                <div className="flex justify-between gap-3 items-center">
                                    <span className="text-muted-foreground">IA</span>
                                    <span className="font-medium">{fmtNum(kpisLLM?.total_calls)}</span>
                                </div>
                                <div className="flex justify-end">
                                    {deltaLLM && (
                                        <div className="text-xs flex items-center gap-2">
                                            {deltaBadge(deltaLLM.diff, "IA")}
                                            {deltaLLM.pct != null && (
                                                <span className="text-muted-foreground">
                                                    ({deltaLLM.pct > 0 ? "+" : ""}
                                                    {deltaLLM.pct.toFixed(1)}%)
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="flex justify-between gap-3 items-center">
                                    <span className="text-muted-foreground">Humano</span>
                                    <span className="font-medium">{fmtNum(kpisHuman?.total_calls)}</span>
                                </div>
                                <div className="flex justify-end">
                                    {deltaHuman && (
                                        <div className="text-xs flex items-center gap-2">
                                            {deltaBadge(deltaHuman.diff, "Humano")}
                                            {deltaHuman.pct != null && (
                                                <span className="text-muted-foreground">
                                                    ({deltaHuman.pct > 0 ? "+" : ""}
                                                    {deltaHuman.pct.toFixed(1)}%)
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ===================== IA: Resumen Ejecutivo + Anomalías ===================== */}
                    <div className="rounded-xl border p-4">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div>
                                <div className="font-medium">Resumen Ejecutivo (IA) + Detector de anomalías</div>
                                <div className="text-xs text-muted-foreground">
                                    {insightsHeader} · <span className="font-mono">{appliedRangeText}</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
                                    onClick={runInsightsIA}
                                    disabled={insightsLoading}
                                >
                                    {insightsLoading ? "Generando..." : "Generar resumen IA"}
                                </button>

                                <button
                                    className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
                                    onClick={() => runNotifyMultichannel()}
                                    disabled={notifyLoading || loading}
                                    title="Envía un resumen a Telegram + Gmail vía n8n"
                                >
                                    {notifyLoading ? "Enviando..." : "Enviar notificación"}
                                </button>

                                {insights && (
                                    <button
                                        className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                                        onClick={() => {
                                            setInsights(null);
                                            setInsightsError(null);
                                        }}
                                    >
                                        Limpiar
                                    </button>
                                )}
                            </div>
                        </div>

                        {insightsError && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{insightsError}</div>}
                        {notifyError && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{notifyError}</div>}
                        {notifyOk && <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notifyOk}</div>}

                        {!insights && !insightsLoading && !insightsError && (
                            <div className="mt-3 text-sm text-muted-foreground">
                                Tip: ajusta filtros (campaña / modo / rango) y genera el resumen para contar una historia en la demo.
                            </div>
                        )}

                        {insights && (
                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                                <div className="rounded-lg bg-muted/30 p-4">
                                    <div className="font-semibold">Resumen ejecutivo</div>
                                    <p className="mt-2 whitespace-pre-wrap text-sm">{insights.executive_summary}</p>

                                    {insights.key_metrics?.length > 0 && (
                                        <>
                                            <div className="mt-4 font-semibold">Métricas clave</div>
                                            <div className="mt-2 grid gap-2">
                                                {insights.key_metrics.map((m, i) => (
                                                    <div key={i} className="rounded-md border bg-white p-3">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div className="text-sm font-medium">{m.label}</div>
                                                            <div className="text-sm font-semibold">{m.value}</div>
                                                        </div>
                                                        <div className="mt-1 text-xs text-muted-foreground">{m.note}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}

                                    <div className="mt-4 font-semibold">Próximas acciones (48h)</div>
                                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                                        {(insights.next_actions_48h ?? []).map((x, i) => (
                                            <li key={i}>{x}</li>
                                        ))}
                                    </ul>
                                </div>

                                <div className="rounded-lg bg-muted/30 p-4">
                                    <div className="font-semibold">Anomalías detectadas</div>

                                    <div className="mt-2 space-y-3">
                                        {(insights.anomalies ?? []).length ? (
                                            insights.anomalies.map((a, i) => (
                                                <div key={i} className="rounded-lg border bg-white p-3">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="font-semibold">{a.title}</div>
                                                        {severityBadge(a.severity)}
                                                    </div>
                                                    <div className="mt-1 text-sm">{a.what_happened}</div>

                                                    <div className="mt-2 text-sm">
                                                        <div className="font-semibold">Causas probables</div>
                                                        <ul className="mt-1 list-disc pl-5">
                                                            {(a.likely_causes ?? []).map((x, j) => (
                                                                <li key={j}>{x}</li>
                                                            ))}
                                                        </ul>
                                                    </div>

                                                    <div className="mt-2 text-sm">
                                                        <div className="font-semibold">Acciones recomendadas</div>
                                                        <ul className="mt-1 list-disc pl-5">
                                                            {(a.recommended_actions ?? []).map((x, j) => (
                                                                <li key={j}>{x}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="text-sm text-muted-foreground">Sin anomalías relevantes en este rango ✅</div>
                                        )}
                                    </div>

                                    <div className="mt-4 font-semibold">Talking points para la demo</div>
                                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                                        {(insights.talking_points_for_demo ?? []).map((x, i) => (
                                            <li key={i}>{x}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ===================== Agentes + SLA + AI Coach ===================== */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div className="rounded-xl border p-4">
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                                <div>
                                    <div className="font-medium">Desempeño por agente humano</div>
                                    <div className="text-xs text-muted-foreground">
                                        Solo modo humano (para operación). AI Coach y Anomalías usan siempre humano (aunque arriba filtres modo).
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
                                        onClick={() => runAgentCoach(agent ? agent : null)}
                                        disabled={coachLoading || !agent}
                                        title={!agent ? "Selecciona un agente para generar el AI Coach" : "Coach operativo para el agente seleccionado"}
                                    >
                                        {coachLoading ? "AI Coach..." : "AI Coach (agente)"}
                                    </button>

                                    <button
                                        className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
                                        onClick={runAgentAnomalies}
                                        disabled={agentAnomsLoading || loading}
                                        title="Comparación vs período anterior + outliers (modo humano)"
                                    >
                                        {agentAnomsLoading ? "Analizando..." : "Anomalías (agentes)"}
                                    </button>

                                    {coach && (
                                        <button
                                            className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                                            onClick={() => {
                                                setCoach(null);
                                                setCoachError(null);
                                            }}
                                        >
                                            Limpiar
                                        </button>
                                    )}
                                </div>
                            </div>

                            {agentPanelError && (
                                <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{agentPanelError}</div>
                            )}

                            <div className="mt-3 overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/50">
                                        <tr className="text-left">
                                            <th className="p-3">Agente</th>
                                            <th className="p-3">Total</th>
                                            <th className="p-3">Conectadas</th>
                                            <th className="p-3">Rate</th>
                                            <th className="p-3">Duración prom</th>
                                            <th className="p-3">T. inicio prom</th>
                                            <th className="p-3 text-right">Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {agentKpis.map((r, i) => {
                                            const a = (r.agent ?? "(sin agente)") as string;
                                            const isSelected = agent && a === agent;
                                            return (
                                                <tr
                                                    key={`${r.agent ?? "na"}-${i}`}
                                                    className={`border-t hover:bg-muted/30 ${isSelected ? "bg-muted/20" : ""}`}
                                                >
                                                    <td className="p-3 font-medium">{r.agent ?? "(sin agente)"}</td>
                                                    <td className="p-3">{fmtNum(r.total_calls)}</td>
                                                    <td className="p-3">{fmtNum(r.connected_calls)}</td>
                                                    <td className="p-3">{fmtPct(r.connect_rate_pct as any)}</td>
                                                    <td className="p-3">{fmtSec(r.avg_duration_sec as any)}</td>
                                                    <td className="p-3">{fmtSec(r.avg_time_to_start_sec as any)}</td>
                                                    <td className="p-3 text-right">
                                                        <div className="flex justify-end gap-2">
                                                            <button
                                                                className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                                                                onClick={() => setAgent(a === "(sin agente)" ? "" : a)}
                                                                title="Filtrar SLA + AI Coach por este agente"
                                                            >
                                                                Filtrar
                                                            </button>
                                                            <button
                                                                className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                                                                onClick={() => runAgentCoach(a === "(sin agente)" ? null : a)}
                                                                disabled={coachLoading}
                                                                title="Generar AI Coach para este agente"
                                                            >
                                                                Coach
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {agentKpis.length === 0 && (
                                            <tr className="border-t">
                                                <td className="p-3 text-sm text-muted-foreground" colSpan={7}>
                                                    Sin datos (o RPC no disponible).
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* ======= Anomalías por agente ======= */}
                            <div className="mt-4 rounded-lg border bg-muted/20 p-4">
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div>
                                        <div className="font-semibold">Detector de anomalías por agente</div>
                                        <div className="text-xs text-muted-foreground">
                                            Comparación vs período anterior + outliers del equipo (solo modo humano). (1 anomalía por agente)
                                        </div>
                                    </div>

                                    {agentAnoms?.stats && (
                                        <div className="text-xs text-muted-foreground text-right">
                                            Promedio rate:{" "}
                                            <span className="font-mono">{agentAnoms.stats.mean_connect_rate.toFixed(1)}%</span> · σ:{" "}
                                            <span className="font-mono">{agentAnoms.stats.stdev_connect_rate.toFixed(2)}</span>
                                        </div>
                                    )}
                                </div>

                                {agentAnomsError && (
                                    <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{agentAnomsError}</div>
                                )}

                                {!agentAnoms && !agentAnomsLoading && !agentAnomsError && (
                                    <div className="mt-3 text-sm text-muted-foreground">
                                        Click en <span className="font-medium">“Anomalías (agentes)”</span> para generar el análisis.
                                    </div>
                                )}

                                {agentAnomsLoading && <div className="mt-3 text-sm text-muted-foreground">Analizando anomalías…</div>}

                                {agentAnoms?.anomalies && (
                                    <div className="mt-3 space-y-3">
                                        {agentAnoms.anomalies.length ? (
                                            agentAnoms.anomalies.map((a, i) => {
                                                const dpp = a.metrics.delta_connect_rate_pp;
                                                const prevRate = a.metrics.prev_connect_rate_pct;
                                                return (
                                                    <div key={`${a.agent}-${a.title}-${i}`} className="rounded-lg border bg-white p-3">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div className="font-semibold">
                                                                {a.agent} — {a.title}
                                                            </div>
                                                            {severityBadge(a.severity)}
                                                        </div>

                                                        <div className="mt-1 text-sm">{a.what_happened}</div>

                                                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground font-mono">
                                                            <span>calls={a.metrics.total_calls}</span>
                                                            <span>· rate={a.metrics.connect_rate_pct.toFixed(1)}%</span>
                                                            {prevRate != null && <span>· prev={prevRate.toFixed(1)}%</span>}
                                                            {dpp != null && <span>· Δrate={dpp.toFixed(1)}pp</span>}
                                                            <span>· inicio={a.metrics.avg_time_to_start_sec.toFixed(0)}s</span>
                                                            <span>· dur={a.metrics.avg_duration_sec.toFixed(0)}s</span>
                                                            {a.metrics.z_rate != null && <span>· z={a.metrics.z_rate.toFixed(2)}</span>}
                                                        </div>

                                                        {dpp != null && (
                                                            <div className="mt-2 text-xs">
                                                                {deltaBadge(dpp, "pp")}
                                                            </div>
                                                        )}

                                                        <div className="mt-3 text-sm">
                                                            <div className="font-semibold">Acciones sugeridas</div>
                                                            <ul className="mt-1 list-disc pl-5">
                                                                {(a.recommended_actions ?? []).map((x, j) => (
                                                                    <li key={j}>{x}</li>
                                                                ))}
                                                            </ul>
                                                        </div>

                                                        <div className="mt-3 flex justify-end">
                                                            <button
                                                                className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                                                                onClick={() => setAgent(a.agent === "(sin agente)" ? "" : a.agent)}
                                                                title="Filtrar SLA + Coach con este agente"
                                                            >
                                                                Ver agente
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div className="text-sm text-muted-foreground">Sin anomalías relevantes en este rango ✅</div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* ======= AI Coach panel ======= */}
                            <div className="mt-4 rounded-lg border bg-muted/20 p-4">
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div>
                                        <div className="font-semibold">AI Coach (operativo)</div>
                                        <div className="text-xs text-muted-foreground">
                                            Personalizado por agente (sin transcripciones). 1 click para “wow” en demo.
                                        </div>
                                    </div>

                                    {coachHeader && (
                                        <div className="text-right">
                                            <div className="text-sm font-medium">{coachHeader.agent}</div>
                                            {coachHeader.sla && (
                                                <div className="text-xs text-muted-foreground">
                                                    SLA:{" "}
                                                    <span className={coachHeader.ok ? "text-emerald-700" : "text-amber-700"}>
                                                        {coachHeader.sla}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {coachError && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{coachError}</div>}

                                {!coach && !coachLoading && !coachError && (
                                    <div className="mt-3 text-sm text-muted-foreground">
                                        Selecciona un agente y haz click en <span className="font-medium">Coach</span>.
                                    </div>
                                )}

                                {coachLoading && <div className="mt-3 text-sm text-muted-foreground">Generando AI Coach…</div>}

                                {coach?.coach && (
                                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                                        <div className="rounded-lg bg-white p-4 border">
                                            <div className="font-semibold">{coach.coach.coach_title || "AI Coach"}</div>

                                            <div className="mt-2 text-sm whitespace-pre-wrap">{coach.coach.what_is_happening}</div>

                                            {(coach.computed?.flags?.length ?? 0) > 0 && (
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {(coach.computed?.flags ?? []).map(coachFlagBadge)}
                                                </div>
                                            )}

                                            {coach.coach.hypotheses?.length > 0 && (
                                                <>
                                                    <div className="mt-4 font-semibold text-sm">Hipótesis</div>
                                                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                                                        {coach.coach.hypotheses.map((x, i) => (
                                                            <li key={i}>{x}</li>
                                                        ))}
                                                    </ul>
                                                </>
                                            )}

                                            {coach.coach.sla_comment && (
                                                <div className="mt-4 text-sm">
                                                    <div className="font-semibold">SLA</div>
                                                    <div className="mt-1">{coach.coach.sla_comment}</div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="rounded-lg bg-white p-4 border">
                                            {coach.coach.actions_48h?.length > 0 && (
                                                <>
                                                    <div className="font-semibold text-sm">3 acciones concretas (48h)</div>
                                                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                                                        {coach.coach.actions_48h.map((x, i) => (
                                                            <li key={i}>{x}</li>
                                                        ))}
                                                    </ul>
                                                </>
                                            )}

                                            {coach.coach.script_sugerido?.length > 0 && (
                                                <>
                                                    <div className="mt-4 font-semibold text-sm">Script sugerido (1–2 líneas)</div>
                                                    <div className="mt-2 space-y-2">
                                                        {coach.coach.script_sugerido.map((x, i) => (
                                                            <div key={i} className="rounded-md border bg-muted/20 p-3 text-sm">
                                                                {x}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </>
                                            )}

                                            {coach?.computed && (
                                                <div className="mt-4 text-xs text-muted-foreground">
                                                    Snapshot: rate {fmtPct(coach.computed.connect_rate_pct)} · inicio{" "}
                                                    {fmtSec(coach.computed.avg_time_to_start_sec)} · duración {fmtSec(coach.computed.avg_duration_sec)}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* SLA */}
                        <div className="rounded-xl border p-4">
                            <div className="font-medium">SLA de inicio (humano)</div>
                            <div className="text-xs text-muted-foreground">Distribución por “tiempo hasta iniciar” (bucket)</div>

                            <div className="mt-3 space-y-2">
                                {(slaBuckets ?? []).map((r, i) => {
                                    const pct = slaTotal > 0 ? (Number(r.calls ?? 0) / slaTotal) * 100 : 0;
                                    const k = `${String(r.bucket ?? "bucket")}-${i}`;

                                    return (
                                        <div key={k} className="flex items-center gap-3">
                                            <div className="w-28 text-sm">{r.bucket}</div>
                                            <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
                                                <div className="h-3 bg-foreground/70" style={{ width: `${pct}%` }} />
                                            </div>
                                            <div className="w-20 text-right text-sm">{fmtNum(r.calls)}</div>
                                            <div className="w-16 text-right text-xs text-muted-foreground">{pct.toFixed(1)}%</div>
                                        </div>
                                    );
                                })}
                                {(slaBuckets ?? []).length === 0 && (
                                    <div className="text-sm text-muted-foreground">Sin datos (o RPC no disponible).</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ===================== C5: Requiere acción ===================== */}
                    <div className="rounded-xl border p-4">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div>
                                <div className="font-medium">Requiere acción</div>
                                <div className="text-xs text-muted-foreground">Llamadas en cola &gt; {STALE_MINUTES} min (según filtros)</div>
                            </div>

                            <button
                                className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                                onClick={() => {
                                    setHourFromPe(null);
                                    setHourToPe(null);
                                    setBucket("queued");
                                    setPage(0);
                                }}
                            >
                                Ver detalle (cola)
                            </button>
                        </div>

                        <div className="mt-3 grid grid-cols-1 lg:grid-cols-4 gap-3">
                            <div className="rounded-xl border p-4 lg:col-span-1">
                                <div className="text-xs text-muted-foreground">En cola &gt; {STALE_MINUTES} min</div>
                                <div className="text-3xl font-semibold mt-1">{fmtNum(staleQueued)}</div>
                                <div className="text-xs text-muted-foreground mt-1">
                                    Si esto sube, hay llamadas “atascadas” o callbacks de estado pendientes.
                                </div>
                            </div>

                            <div className="rounded-xl border overflow-x-auto lg:col-span-3">
                                <div className="p-3 border-b text-sm font-medium">Más antiguas (Top 10)</div>
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/50">
                                        <tr className="text-left">
                                            <th className="p-3">Edad (min)</th>
                                            <th className="p-3">Fecha (PE)</th>
                                            <th className="p-3">Campaña</th>
                                            <th className="p-3">Modo</th>
                                            <th className="p-3">SID</th>
                                            <th className="p-3 text-right">Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {staleRows.map((r) => (
                                            <tr key={r.call_id} className="border-t hover:bg-muted/30">
                                                <td className="p-3 font-mono text-xs">{Number(r.age_minutes ?? 0).toFixed(2)}</td>
                                                <td className="p-3 whitespace-nowrap">{peDisplay(r.created_at_pe)}</td>
                                                <td className="p-3">
                                                    {r.campaign_id ? (
                                                        <Link href={`/campaigns/${r.campaign_id}`} className="hover:underline">
                                                            {r.campaign_name ?? "(sin nombre)"}
                                                        </Link>
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
                                                </td>
                                                <td className="p-3">
                                                    <span className="font-mono text-xs">{r.mode ?? "-"}</span>
                                                </td>
                                                <td className="p-3">
                                                    {r.twilio_call_sid ? (
                                                        <span className="font-mono text-xs">{r.twilio_call_sid}</span>
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
                                                </td>
                                                <td className="p-3 text-right">
                                                    <button
                                                        className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                                                        onClick={() => {
                                                            setHourFromPe(null);
                                                            setHourToPe(null);
                                                            setCampaignId(r.campaign_id ?? "");
                                                            setBucket("queued");
                                                            setPage(0);
                                                        }}
                                                    >
                                                        Filtrar
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {staleRows.length === 0 && (
                                            <tr className="border-t">
                                                <td className="p-3 text-sm text-muted-foreground" colSpan={6}>
                                                    No hay llamadas en cola &gt; {STALE_MINUTES} min ✅
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Donut (chart) */}
                    <div className="rounded-xl border p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium">Distribución por resultado (Chart)</div>
                                <div className="text-xs text-muted-foreground">Total: {fmtNum(donutTotal)}</div>
                            </div>
                        </div>

                        <div className="mt-2 h-[320px] min-h-[280px]">
                            <DonutResultChart
                                data={donut}
                                onSelectBucket={(b) => {
                                    setPage(0);
                                    setHourFromPe(null);
                                    setHourToPe(null);
                                    setBucket((prev) => (prev === b ? "" : b));
                                }}
                            />
                        </div>
                    </div>

                    {/* Trend (chart) */}
                    <div className="rounded-xl border p-4">
                        <div className="font-medium">Tendencia (Chart) ({grain === "hour" ? "hora" : "día"})</div>
                        <div className="text-xs text-muted-foreground">Clic en un punto para filtrar por día/hora</div>

                        <div className="mt-2 h-[320px] min-h-[280px]">
                            <CallsTrendChart
                                data={series}
                                onSelectPoint={(ts) => {
                                    setPage(0);

                                    if (grain === "day") {
                                        const day = toDateOnlyFromTs(ts);
                                        setFromDate(day);
                                        setToDate(day);
                                        setHourFromPe(null);
                                        setHourToPe(null);
                                        return;
                                    }

                                    const from = hourStartFromBucketTs(ts);
                                    const to = addHoursToPeTs(from, 1);

                                    setFromDate(toDateOnlyFromTs(ts));
                                    setToDate(toDateOnlyFromTs(ts));
                                    setHourFromPe(from);
                                    setHourToPe(to);
                                }}
                            />
                        </div>
                    </div>

                    {/* Barras */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div className="rounded-xl border p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="font-medium">Distribución por resultado (Barras)</div>
                                    <div className="text-xs text-muted-foreground">Total: {fmtNum(donutTotal)}</div>
                                </div>
                            </div>

                            <div className="mt-3 space-y-2">
                                {donut.map((r, i) => {
                                    const pct = donutTotal > 0 ? (Number(r.calls) / donutTotal) * 100 : 0;
                                    const k = `${String(r.result_bucket ?? "bucket")}-${i}`;
                                    return (
                                        <div key={k} className="flex items-center gap-3">
                                            <div className="w-28 text-sm">{prettyBucket(r.result_bucket)}</div>
                                            <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
                                                <div className="h-3 bg-foreground/70" style={{ width: `${pct}%` }} />
                                            </div>
                                            <div className="w-20 text-right text-sm">{fmtNum(r.calls)}</div>
                                            <div className="w-16 text-right text-xs text-muted-foreground">{pct.toFixed(1)}%</div>
                                        </div>
                                    );
                                })}
                                {donut.length === 0 && <div className="text-sm text-muted-foreground">Sin datos para el rango seleccionado.</div>}
                            </div>
                        </div>

                        <div className="rounded-xl border p-4">
                            <div className="font-medium">Tendencia (Barras) ({grain === "hour" ? "hora" : "día"})</div>
                            <div className="text-xs text-muted-foreground">Total vs Conectadas (y No contesta)</div>

                            <div className="mt-3 space-y-2">
                                {series.map((r) => {
                                    const total = Number(r.total_calls ?? 0);
                                    const conn = Number(r.connected_calls ?? 0);
                                    const na = Number(r.no_answer_calls ?? 0);
                                    const pctConn = total > 0 ? (conn / total) * 100 : 0;

                                    return (
                                        <div key={r.bucket_ts} className="flex items-center gap-3">
                                            <div className="w-36 text-xs text-muted-foreground">{new Date(r.bucket_ts).toLocaleString("es-PE")}</div>
                                            <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
                                                <div className="h-3 bg-foreground/70" style={{ width: `${pctConn}%` }} />
                                            </div>
                                            <div className="w-24 text-right text-sm">{fmtNum(total)}</div>
                                            <div className="w-24 text-right text-xs text-muted-foreground">
                                                Conn {fmtNum(conn)} · NA {fmtNum(na)}
                                            </div>
                                        </div>
                                    );
                                })}
                                {series.length === 0 && <div className="text-sm text-muted-foreground">Sin datos para el rango seleccionado.</div>}
                            </div>
                        </div>
                    </div>

                    {/* Top campaigns */}
                    <div className="rounded-xl border overflow-x-auto">
                        <div className="p-4 border-b">
                            <div className="font-medium">Top campañas</div>
                            <div className="text-xs text-muted-foreground">Por volumen (con rate de conexión)</div>
                        </div>
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr className="text-left">
                                    <th className="p-3">Campaña</th>
                                    <th className="p-3">Total</th>
                                    <th className="p-3">Conectadas</th>
                                    <th className="p-3">Rate</th>
                                    <th className="p-3 text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody>
                                {topCampaigns.map((r) => (
                                    <tr key={r.campaign_id} className="border-t hover:bg-muted/30">
                                        <td className="p-3">
                                            <Link href={`/campaigns/${r.campaign_id}`} className="font-medium hover:underline">
                                                {r.campaign_name ?? "(sin nombre)"}
                                            </Link>
                                        </td>
                                        <td className="p-3">{fmtNum(r.total_calls)}</td>
                                        <td className="p-3">{fmtNum(r.connected_calls)}</td>
                                        <td className="p-3">{fmtPct(r.connect_rate_pct)}</td>
                                        <td className="p-3 text-right">
                                            <button
                                                className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                                                onClick={() => {
                                                    setPage(0);
                                                    setHourFromPe(null);
                                                    setHourToPe(null);
                                                    setCampaignId((prev) => (prev === r.campaign_id ? "" : r.campaign_id));
                                                }}
                                            >
                                                {campaignId === r.campaign_id ? "Quitar filtro" : "Filtrar"}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {topCampaigns.length === 0 && (
                                    <tr className="border-t">
                                        <td className="p-3 text-sm text-muted-foreground" colSpan={5}>
                                            Sin datos.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Detail table */}
                    <div className="rounded-xl border overflow-x-auto">
                        <div className="p-4 border-b flex items-center justify-between gap-3 flex-wrap">
                            <div>
                                <div className="font-medium">Detalle de llamadas</div>
                                <div className="text-xs text-muted-foreground">
                                    {fmtNum(table.length)} filas (página {page + 1})
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                                    disabled={page === 0}
                                >
                                    ← Prev
                                </button>
                                <button
                                    className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                                    onClick={() => setPage((p) => p + 1)}
                                    disabled={table.length < pageSize}
                                >
                                    Next →
                                </button>
                            </div>
                        </div>

                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr className="text-left">
                                    <th className="p-3">Fecha (PE)</th>
                                    <th className="p-3">Campaña</th>
                                    <th className="p-3">Modo</th>
                                    <th className="p-3">Estado</th>
                                    <th className="p-3">Resultado</th>
                                    <th className="p-3">Duración</th>
                                    <th className="p-3">Lead</th>
                                    <th className="p-3">Twilio SID</th>
                                </tr>
                            </thead>
                            <tbody>
                                {table.map((r) => (
                                    <tr key={r.call_id} className="border-t hover:bg-muted/30">
                                        <td className="p-3 whitespace-nowrap">{peDisplay(r.created_at_pe)}</td>

                                        <td className="p-3">
                                            {r.campaign_id ? (
                                                <Link href={`/campaigns/${r.campaign_id}`} className="hover:underline">
                                                    {r.campaign_name ?? "(sin nombre)"}
                                                </Link>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </td>

                                        <td className="p-3">
                                            <span className="font-mono text-xs">{r.mode ?? "-"}</span>
                                        </td>

                                        <td className="p-3">
                                            <span className="font-mono text-xs">{r.status_norm ?? "-"}</span>
                                        </td>

                                        <td className="p-3">
                                            <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs ${bucketBadgeClass(r.result_bucket)}`}>
                                                {prettyBucket(r.result_bucket)}
                                            </span>
                                        </td>

                                        <td className="p-3">{fmtSec(r.duration_sec)}</td>

                                        <td className="p-3">
                                            {r.lead_id ? (
                                                <Link href={`/leads/${r.lead_id}`} className="hover:underline font-mono text-xs">
                                                    {r.lead_id.slice(0, 8)}…
                                                </Link>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </td>

                                        <td className="p-3">
                                            {r.twilio_call_sid ? (
                                                <span className="font-mono text-xs">{r.twilio_call_sid}</span>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}

                                {table.length === 0 && (
                                    <tr className="border-t">
                                        <td className="p-3 text-sm text-muted-foreground" colSpan={8}>
                                            Sin datos para el rango/filtros.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
