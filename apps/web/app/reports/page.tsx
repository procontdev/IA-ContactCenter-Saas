"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type CampaignRow = {
    id: string;
    code: string;
    name: string;
};

type ReportCallRow = {
    call_id: string;
    lead_id?: string | null;

    campaign?: string | null; // code ej: "Claro-Peru-Fijo"
    campaign_id?: string | null; // UUID

    phone?: string | null;
    lead_phone?: string | null;
    call_phone?: string | null;

    mode?: string | null;
    status?: string | null;

    created_at?: string | null;
    started_at?: string | null;
    ended_at?: string | null;

    duration_sec?: number | null;

    first_response_sec?: number | null;
    time_to_close_sec?: number | null;

    intent?: string | null;
    stage?: string | null;
    sentiment?: string | null;

    wrapup_present?: boolean | null;
    qa_present?: boolean | null;

    qa_score?: number | null;

    // Opcional: si viene en dataset
    lead_name?: string | null;
    lead_full_name?: string | null;

    // A veces viene metadata con cosas útiles
    metadata?: any;

    links?: {
        call?: string;
    } | null;
};

type N8NReport = {
    ok?: boolean;
    message?: string;

    meta?: any;
    dataset?: {
        calls?: ReportCallRow[];
        [k: string]: any;
    };

    [k: string]: any;
};

const SORT_KEY_STORAGE = "reports.sortKey";
const SORT_DIR_STORAGE = "reports.sortDir";

const SORT_KEYS: SortKey[] = [
    "started_at",
    "call_id",
    "campaign",
    "lead_id",
    "lead_name",
    "phone",
    "intent",
    "stage",
    "first_response_sec",
    "time_to_close_sec",
];

function isSortKey(v: any): v is SortKey {
    return SORT_KEYS.includes(v as SortKey);
}

function isSortDir(v: any): v is SortDir {
    return v === "asc" || v === "desc";
}

type SortDir = "asc" | "desc";
type SortKey =
    | "started_at"
    | "call_id"
    | "campaign"
    | "lead_id"
    | "lead_name"
    | "phone"
    | "intent"
    | "stage"
    | "first_response_sec"
    | "time_to_close_sec";

function safeStr(v: any) {
    return String(v ?? "").trim();
}

function asDMY(d: Date) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
}

function uniqByCallId(calls: ReportCallRow[]) {
    const m = new Map<string, ReportCallRow>();
    for (const c of calls) {
        const id = safeStr(c.call_id);
        if (!id) continue;
        if (!m.has(id)) m.set(id, c);
    }
    return Array.from(m.values());
}

function normalizeBucket(v: string, fallback = "unknown") {
    const s = safeStr(v).toLowerCase();
    return s ? s : fallback;
}

function percentile(sortedAsc: number[], p: number) {
    if (!sortedAsc.length) return null;
    const idx = (sortedAsc.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sortedAsc[lo];
    const w = idx - lo;
    return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
}

function avg(nums: number[]) {
    if (!nums.length) return null;
    const s = nums.reduce((a, b) => a + b, 0);
    return s / nums.length;
}

function formatSecondsToHuman(sec: number | null) {
    if (sec == null || Number.isNaN(sec)) return "-";
    const s = Math.max(0, Math.floor(sec));
    const days = Math.floor(s / 86400);
    const hrs = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const rem = s % 60;

    if (days > 0) return `${days}d ${hrs}h ${mins}m`;
    if (hrs > 0) return `${hrs}h ${mins}m ${rem}s`;
    if (mins > 0) return `${mins}m ${rem}s`;
    return `${rem}s`;
}

function formatMinutesToHumanFromSeconds(sec: number | null) {
    if (sec == null || Number.isNaN(sec)) return "-";
    const m = Math.round(sec / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h < 24) return `${h}h ${mm}m`;
    const d = Math.floor(h / 24);
    const hh = h % 24;
    return `${d}d ${hh}h`;
}

function formatDateTime(dtIso: string | null | undefined) {
    const s = safeStr(dtIso);
    if (!s) return "-";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;

    // muestra en timezone local del browser (en tu caso Lima)
    return new Intl.DateTimeFormat("es-PE", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(d);
}

function pickLeadName(c: ReportCallRow) {
    const anyC = c as any;

    const direct =
        safeStr((c as any).lead_usuario) || // 👈 viene de n8n
        safeStr(c.lead_name) ||
        safeStr(c.lead_full_name) ||
        safeStr(anyC.lead_display_name) ||
        safeStr(anyC.lead_nombre) ||
        safeStr(anyC.name);

    if (direct) return direct;

    const md = anyC.metadata;
    const fromMd =
        safeStr((c as any).lead_usuario) ||
        safeStr(md?.lead_name) ||
        safeStr(md?.lead_full_name) ||
        safeStr(md?.lead?.name) ||
        safeStr(md?.lead?.full_name) ||
        safeStr(md?.contact?.name) ||
        safeStr(md?.customer_name);

    return fromMd || "-";
}

function postJson(url: string, payload: any, apiKey?: string) {
    return fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify(payload),
    });
}

function supabaseRestGet(url: string, anonKey: string) {
    return fetch(url, {
        method: "GET",
        headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            "Accept-Profile": "demo_callcenter",
        },
    });
}

// ---------- Sorting helpers (sin hooks) ----------
function toggleSort(key: SortKey, currentKey: SortKey, dir: SortDir): SortDir {
    if (key === currentKey) return dir === "asc" ? "desc" : "asc";
    return "asc";
}

function cmpNullable(a: any, b: any) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;

    if (typeof a === "number" && typeof b === "number") return a - b;

    return String(a).localeCompare(String(b), "es", {
        sensitivity: "base",
        numeric: true,
    });
}

export default function ReportsPage() {
    // ---- Config ----
    const WEBHOOK_URL =
        "https://elastica-n8n.3haody.easypanel.host/webhook/campaign-audit-report";

    const N8N_API_KEY =
        (process.env.NEXT_PUBLIC_N8N_REPORT_API_KEY as string) || "";

    const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL as string) || "";
    const SUPABASE_ANON =
        (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string) || "";

    // ---- State ----
    const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
    const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]);
    const [dateFrom, setDateFrom] = useState<string>(() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return asDMY(d);
    });
    const [dateTo, setDateTo] = useState<string>(() => asDMY(new Date()));

    const [loadingCampaigns, setLoadingCampaigns] = useState(false);
    const [loadingReport, setLoadingReport] = useState(false);
    const [error, setError] = useState<string>("");
    const [reportRaw, setReportRaw] = useState<N8NReport | null>(null);

    // ✅ Sorting state (hooks dentro del componente)
    const [sortKey, setSortKey] = useState<SortKey>(() => {
        if (typeof window === "undefined") return "started_at";
        try {
            const v = window.localStorage.getItem(SORT_KEY_STORAGE);
            return isSortKey(v) ? v : "started_at";
        } catch {
            return "started_at";
        }
    });

    const [sortDir, setSortDir] = useState<SortDir>(() => {
        if (typeof window === "undefined") return "desc";
        try {
            const v = window.localStorage.getItem(SORT_DIR_STORAGE);
            return isSortDir(v) ? v : "desc";
        } catch {
            return "desc";
        }
    });


    // ---- Load campaigns ----
    useEffect(() => {
        try {
            window.localStorage.setItem(SORT_KEY_STORAGE, sortKey);
            window.localStorage.setItem(SORT_DIR_STORAGE, sortDir);
        } catch {
            // ignore
        }
    }, [sortKey, sortDir]);

    useEffect(() => {
        let cancelled = false;

        async function run() {
            setLoadingCampaigns(true);
            setError("");

            try {
                if (!SUPABASE_URL || !SUPABASE_ANON) {
                    throw new Error(
                        "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en el .env"
                    );
                }

                const url = `${SUPABASE_URL}/rest/v1/campaigns?select=id,code,name&order=name.asc`;
                const res = await supabaseRestGet(url, SUPABASE_ANON);

                if (!res.ok) {
                    const txt = await res.text();
                    throw new Error(`Supabase REST ${res.status}: ${txt}`);
                }

                const data = (await res.json()) as CampaignRow[];
                if (cancelled) return;

                setCampaigns(data || []);

                // default: seleccionar todas solo la primera vez
                setSelectedCampaignIds((prev) =>
                    prev.length ? prev : (data || []).map((c) => c.id)
                );
            } catch (e: any) {
                if (!cancelled) setError(e?.message || "Error cargando campañas");
            } finally {
                if (!cancelled) setLoadingCampaigns(false);
            }
        }

        run();
        return () => {
            cancelled = true;
        };
    }, [SUPABASE_URL, SUPABASE_ANON]);

    // ---- Maps ----
    const campById = useMemo(() => {
        const m = new Map<string, CampaignRow>();
        for (const c of campaigns) m.set(c.id, c);
        return m;
    }, [campaigns]);

    const selectedCampaignCodes = useMemo(() => {
        const codes: string[] = [];
        for (const id of selectedCampaignIds) {
            const c = campById.get(id);
            if (c?.code) codes.push(c.code);
        }
        return codes;
    }, [selectedCampaignIds, campById]);

    // ---- Calls (raw -> dedupe -> filter) ----
    const filteredCalls = useMemo(() => {
        const callsAll = (reportRaw?.dataset?.calls || []) as ReportCallRow[];
        if (!callsAll.length) return [];

        const deduped = uniqByCallId(callsAll);

        // Si por alguna razón n8n devuelve “de más”, filtramos aquí
        const idsSet = new Set(selectedCampaignIds.map(String));
        const codesSet = new Set(selectedCampaignCodes.map(String));

        return deduped.filter((c) => {
            const cid = safeStr((c as any).campaign_id);
            if (cid) return idsSet.has(cid);

            // fallback si aún viene code
            const code = safeStr((c as any).campaign);
            if (code) return codesSet.has(code);

            return false;
        });
    }, [reportRaw, selectedCampaignIds, selectedCampaignCodes]);

    // ---- KPIs (SIEMPRE desde filteredCalls) ----
    const derived = useMemo(() => {
        const calls = filteredCalls;

        const total = calls.length;

        const wrapupPresent = calls.filter((c) => !!c.wrapup_present).length;
        const qaPresent = calls.filter((c) => !!c.qa_present).length;

        const wrapupPct = total ? Math.round((wrapupPresent / total) * 100) : 0;
        const qaPct = total ? Math.round((qaPresent / total) * 100) : 0;

        // Caps opcionales (si n8n los manda)
        const frMax =
            Number(reportRaw?.meta?.sla_cleaning?.first_response_max_sec ?? 0) || 0;
        const tcMax =
            Number(reportRaw?.meta?.sla_cleaning?.time_to_close_max_sec ?? 0) || 0;

        const fr = calls
            .map((c) =>
                typeof c.first_response_sec === "number" ? c.first_response_sec : null
            )
            .filter((v): v is number => v != null && v >= 0 && (!frMax || v <= frMax))
            .sort((a, b) => a - b);

        const tc = calls
            .map((c) =>
                typeof c.time_to_close_sec === "number" ? c.time_to_close_sec : null
            )
            .filter((v): v is number => v != null && v >= 0 && (!tcMax || v <= tcMax))
            .sort((a, b) => a - b);

        const frAvg = avg(fr);
        const frP50 = percentile(fr, 0.5);
        const frP95 = percentile(fr, 0.95);

        const tcAvg = avg(tc);
        const tcP50 = percentile(tc, 0.5);
        const tcP95 = percentile(tc, 0.95);

        const intentCounts = new Map<string, number>();
        const stageCounts = new Map<string, number>();

        for (const c of calls) {
            const i = normalizeBucket(c.intent || "", "unknown");
            const st = normalizeBucket(c.stage || "", "unknown");
            intentCounts.set(i, (intentCounts.get(i) || 0) + 1);
            stageCounts.set(st, (stageCounts.get(st) || 0) + 1);
        }

        const intentsTop = Array.from(intentCounts.entries())
            .map(([intent, count]) => ({ intent, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        const stagesTop = Array.from(stageCounts.entries())
            .map(([stage, count]) => ({ stage, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        return {
            total,
            sla: {
                first: { avg: frAvg, p50: frP50, p95: frP95 },
                close: { avg: tcAvg, p50: tcP50, p95: tcP95 },
            },
            coverage: { wrapupPct, qaPct },
            intentsTop,
            stagesTop,
        };
    }, [filteredCalls, reportRaw]);

    // ---- UI Actions ----
    function toggleCampaign(id: string) {
        setSelectedCampaignIds((prev) => {
            const set = new Set(prev);
            if (set.has(id)) set.delete(id);
            else set.add(id);
            return Array.from(set);
        });
    }

    function selectAll() {
        setSelectedCampaignIds(campaigns.map((c) => c.id));
    }

    function clearAll() {
        setSelectedCampaignIds([]);
    }

    async function generateReport() {
        setError("");
        setLoadingReport(true);
        setReportRaw(null);

        try {
            if (!selectedCampaignIds.length) {
                throw new Error("Selecciona al menos 1 campaña.");
            }

            const app_base_url =
                typeof window !== "undefined"
                    ? window.location.origin
                    : "http://localhost:3000";

            // IMPORTANTE: enviamos IDs (UUID)
            const payload = {
                campaigns: selectedCampaignIds,
                date_from: dateFrom,
                date_to: dateTo,
                app_base_url,
            };

            const res = await postJson(WEBHOOK_URL, payload, N8N_API_KEY || undefined);

            const text = await res.text();
            if (!text || !text.trim()) {
                throw new Error(
                    "El webhook respondió vacío (no devolvió JSON). Revisa el último nodo de respuesta en n8n."
                );
            }

            let json: N8NReport;
            try {
                json = JSON.parse(text);
            } catch {
                throw new Error(`Respuesta no-JSON del webhook: ${text.slice(0, 500)}`);
            }

            if (!res.ok) {
                throw new Error(json?.message || `Webhook error HTTP ${res.status}`);
            }

            if (json?.ok === false) {
                throw new Error(json?.message || "Webhook devolvió ok=false");
            }

            setReportRaw(json);
        } catch (e: any) {
            setError(e?.message || "Error generando reporte");
        } finally {
            setLoadingReport(false);
        }
    }

    function campaignLabelFromCall(c: ReportCallRow) {
        const cid = safeStr((c as any).campaign_id);
        if (cid) {
            const camp = campById.get(cid);
            if (camp) return `${camp.name} (${camp.code})`;
            return cid;
        }

        const code = safeStr((c as any).campaign);
        if (code) {
            const camp = campaigns.find((x) => x.code === code);
            if (camp) return `${camp.name} (${camp.code})`;
            return code;
        }

        return "-";
    }

    // ✅ Sorted calls (después de filtrar)
    const sortedCalls = useMemo(() => {
        const rows = [...filteredCalls];

        const getValue = (c: ReportCallRow): any => {
            switch (sortKey) {
                case "started_at": {
                    const s = safeStr(c.started_at);
                    if (!s) return null;
                    const t = new Date(s).getTime();
                    return Number.isNaN(t) ? null : t;
                }
                case "call_id":
                    return safeStr(c.call_id) || null;
                case "campaign":
                    return campaignLabelFromCall(c) || null;
                case "lead_id":
                    return safeStr(c.lead_id) || null;
                case "lead_name":
                    return pickLeadName(c) || null;
                case "phone": {
                    const p = safeStr(c.phone || c.lead_phone || c.call_phone || "");
                    return p || null;
                }
                case "intent":
                    return safeStr(c.intent) || null;
                case "stage":
                    return safeStr(c.stage) || null;
                case "first_response_sec":
                    return typeof c.first_response_sec === "number" ? c.first_response_sec : null;
                case "time_to_close_sec":
                    return typeof c.time_to_close_sec === "number" ? c.time_to_close_sec : null;
                default:
                    return null;
            }
        };

        rows.sort((a, b) => {
            const va = getValue(a);
            const vb = getValue(b);
            const r = cmpNullable(va, vb);
            return sortDir === "asc" ? r : -r;
        });

        return rows;
    }, [filteredCalls, sortKey, sortDir, campaigns, campById]);

    const isBusy = loadingCampaigns || loadingReport;

    const thBtn = (key: SortKey, label: string) => (
        <button
            type="button"
            className="inline-flex items-center gap-1 hover:underline"
            onClick={() => {
                const next = toggleSort(key, sortKey, sortDir);
                setSortKey(key);
                setSortDir(next);
            }}
        >
            {label} {sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : ""}
        </button>
    );

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="text-sm text-gray-500">
                        <a href="/" className="hover:underline">
                            ← Volver
                        </a>
                    </div>
                    <h1 className="text-3xl font-semibold mt-2">Reporte IA por campaña</h1>
                    <p className="text-gray-500 mt-1">
                        Auditoría (jefatura) · KPIs + hallazgos por campaña
                    </p>
                </div>

                <div className="text-right text-sm text-gray-500">
                    <div>Webhook:</div>
                    <div className="font-mono text-xs break-all">{WEBHOOK_URL}</div>
                </div>
            </div>

            <div className="border rounded-xl p-5 space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* Campaigns */}
                    <div className="lg:col-span-5">
                        <div className="flex items-center justify-between">
                            <div className="font-semibold">Campañas</div>
                            <div className="text-sm text-gray-500 space-x-3">
                                <button
                                    type="button"
                                    className="underline"
                                    onClick={selectAll}
                                    disabled={loadingCampaigns}
                                >
                                    Seleccionar todas
                                </button>
                                <button
                                    type="button"
                                    className="underline"
                                    onClick={clearAll}
                                    disabled={loadingCampaigns}
                                >
                                    Quitar todas
                                </button>
                            </div>
                        </div>

                        <div className="mt-3 border rounded-lg p-3 max-h-44 overflow-auto">
                            {loadingCampaigns && (
                                <div className="text-sm text-gray-500">Leyendo campañas...</div>
                            )}

                            {!loadingCampaigns && campaigns.length === 0 && (
                                <div className="text-sm text-gray-500">No hay campañas.</div>
                            )}

                            {!loadingCampaigns &&
                                campaigns.map((c) => {
                                    const checked = selectedCampaignIds.includes(c.id);
                                    return (
                                        <label
                                            key={c.id}
                                            className="flex items-center gap-2 py-1 select-none cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleCampaign(c.id)}
                                                disabled={isBusy}
                                            />
                                            <span>
                                                {c.name}{" "}
                                                <span className="text-gray-500">({c.code})</span>
                                            </span>
                                        </label>
                                    );
                                })}
                        </div>

                        <div className="text-xs text-gray-500 mt-2">
                            Seleccionadas: {selectedCampaignIds.length}
                        </div>
                    </div>

                    {/* Dates */}
                    <div className="lg:col-span-3">
                        <div className="font-semibold">Desde (dd/mm/yyyy)</div>
                        <input
                            className="mt-2 w-full border rounded-lg px-3 py-2"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            disabled={isBusy}
                        />
                    </div>

                    <div className="lg:col-span-3">
                        <div className="font-semibold">Hasta (dd/mm/yyyy)</div>
                        <input
                            className="mt-2 w-full border rounded-lg px-3 py-2"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            disabled={isBusy}
                        />
                    </div>

                    {/* Button */}
                    <div className="lg:col-span-1 flex items-end">
                        <button
                            type="button"
                            onClick={generateReport}
                            disabled={isBusy || selectedCampaignIds.length === 0}
                            className="w-full bg-black text-white rounded-lg py-2 px-3 disabled:opacity-50"
                        >
                            {loadingReport ? "Generando..." : "Generar reporte"}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="border border-red-200 bg-red-50 text-red-700 rounded-lg p-3 text-sm">
                        {error}
                    </div>
                )}
            </div>

            {/* Summary + Dataset */}
            {reportRaw && (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <div className="border rounded-xl p-5">
                            <div className="font-semibold">Totales</div>
                            <div className="text-4xl font-semibold mt-3">{derived.total}</div>
                            <div className="text-gray-500 text-sm mt-1">
                                Llamadas (calculado desde dataset.calls)
                            </div>
                        </div>

                        <div className="border rounded-xl p-5">
                            <div className="font-semibold">SLA · Primer respuesta</div>
                            <div className="text-sm text-gray-600 mt-2">
                                Avg: {formatMinutesToHumanFromSeconds(derived.sla.first.avg)}
                                {" · "}
                                P50: {formatMinutesToHumanFromSeconds(derived.sla.first.p50)}
                                {" · "}
                                P95: {formatMinutesToHumanFromSeconds(derived.sla.first.p95)}
                            </div>

                            <div className="font-semibold mt-4">SLA · Cierre</div>
                            <div className="text-sm text-gray-600 mt-2">
                                Avg: {formatMinutesToHumanFromSeconds(derived.sla.close.avg)}
                                {" · "}
                                P50: {formatMinutesToHumanFromSeconds(derived.sla.close.p50)}
                                {" · "}
                                P95: {formatMinutesToHumanFromSeconds(derived.sla.close.p95)}
                            </div>
                        </div>

                        <div className="border rounded-xl p-5">
                            <div className="font-semibold">Cobertura IA</div>
                            <div className="text-sm text-gray-600 mt-3">
                                Wrap-Up presente: <b>{derived.coverage.wrapupPct}%</b>
                            </div>
                            <div className="text-sm text-gray-600 mt-2">
                                QA presente: <b>{derived.coverage.qaPct}%</b>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <div className="border rounded-xl p-5 lg:col-span-2">
                            <div className="font-semibold mb-3">Top Intents</div>
                            {derived.intentsTop.length ? (
                                <div className="space-y-2">
                                    {derived.intentsTop.map((x) => (
                                        <div
                                            key={`intent-${x.intent}`}
                                            className="flex justify-between text-sm"
                                        >
                                            <span>{x.intent}</span>
                                            <span className="text-gray-600">{x.count}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-sm text-gray-500">Sin datos.</div>
                            )}
                        </div>

                        <div className="border rounded-xl p-5">
                            <div className="font-semibold mb-3">Top Etapas</div>
                            {derived.stagesTop.length ? (
                                <div className="space-y-2">
                                    {derived.stagesTop.map((x) => (
                                        <div
                                            key={`stage-${x.stage}`}
                                            className="flex justify-between text-sm"
                                        >
                                            <span>{x.stage}</span>
                                            <span className="text-gray-600">{x.count}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-sm text-gray-500">Sin datos.</div>
                            )}
                        </div>
                    </div>

                    <div className="border rounded-xl overflow-hidden">
                        <div className="p-5 flex items-center justify-between">
                            <div className="font-semibold">Dataset (calls)</div>
                            <div className="text-sm text-gray-500">
                                {sortedCalls.length} registros
                            </div>
                        </div>

                        <div className="overflow-auto">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50 text-gray-700">
                                    <tr>
                                        <th className="text-left px-4 py-3">
                                            {thBtn("started_at", "Inicio")}
                                        </th>
                                        <th className="text-left px-4 py-3">
                                            {thBtn("call_id", "Call")}
                                        </th>
                                        <th className="text-left px-4 py-3">
                                            {thBtn("campaign", "Campaña")}
                                        </th>
                                        <th className="text-left px-4 py-3">
                                            {thBtn("lead_id", "Lead")}
                                        </th>
                                        <th className="text-left px-4 py-3">
                                            {thBtn("lead_name", "Lead (nombre)")}
                                        </th>
                                        <th className="text-left px-4 py-3">
                                            {thBtn("phone", "Teléfono")}
                                        </th>
                                        <th className="text-left px-4 py-3">
                                            {thBtn("intent", "Intent")}
                                        </th>
                                        <th className="text-left px-4 py-3">
                                            {thBtn("stage", "Etapa")}
                                        </th>
                                        <th className="text-left px-4 py-3">
                                            {thBtn("first_response_sec", "SLA 1ra resp")}
                                        </th>
                                        <th className="text-left px-4 py-3">
                                            {thBtn("time_to_close_sec", "Tiempo cierre")}
                                        </th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {sortedCalls.length === 0 ? (
                                        <tr>
                                            <td className="px-4 py-6 text-gray-500" colSpan={10}>
                                                No hay llamadas para el filtro seleccionado.
                                            </td>
                                        </tr>
                                    ) : (
                                        sortedCalls.map((c, idx) => {
                                            const callId = safeStr(c.call_id);
                                            const leadId = safeStr(c.lead_id);
                                            const phone = safeStr(
                                                c.phone || c.lead_phone || c.call_phone || ""
                                            );

                                            const intent = safeStr(c.intent || "");
                                            const stage = safeStr(c.stage || "");

                                            const leadName = pickLeadName(c);

                                            const callHref = callId ? `/call/?id=${callId}` : "#";
                                            const leadHref = leadId ? `/leads/view/?id=${leadId}` : "#";

                                            return (
                                                <tr
                                                    key={`${callId}-${idx}`}
                                                    className="border-t hover:bg-gray-50"
                                                >
                                                    <td className="px-4 py-3 whitespace-nowrap">
                                                        {formatDateTime(c.started_at)}
                                                    </td>

                                                    <td className="px-4 py-3 font-mono text-xs">
                                                        {callId ? (
                                                            <Link
                                                                href={callHref}
                                                                className="text-blue-600 hover:underline"
                                                            >
                                                                {callId}
                                                            </Link>
                                                        ) : (
                                                            "-"
                                                        )}
                                                    </td>

                                                    <td className="px-4 py-3">
                                                        {(() => {
                                                            const cid = safeStr((c as any).campaign_id);
                                                            const label = campaignLabelFromCall(c);

                                                            // Ajusta la ruta si tu detalle está en otro path
                                                            const href = cid ? `/campaigns/${cid}` : "";

                                                            return cid ? (
                                                                <Link href={href} className="text-blue-600 hover:underline">
                                                                    {label}
                                                                </Link>
                                                            ) : (
                                                                <span>{label}</span>
                                                            );
                                                        })()}
                                                    </td>


                                                    <td className="px-4 py-3 font-mono text-xs">
                                                        {leadId ? (
                                                            <Link
                                                                href={leadHref}
                                                                className="text-blue-600 hover:underline"
                                                            >
                                                                {leadId}
                                                            </Link>
                                                        ) : (
                                                            "-"
                                                        )}
                                                    </td>

                                                    <td className="px-4 py-3">
                                                        {leadId ? (
                                                            <Link
                                                                href={leadHref}
                                                                className="text-blue-600 hover:underline"
                                                            >
                                                                {leadName}
                                                            </Link>
                                                        ) : (
                                                            leadName || "-"
                                                        )}
                                                    </td>

                                                    <td className="px-4 py-3">{phone || "-"}</td>
                                                    <td className="px-4 py-3">{intent || "-"}</td>
                                                    <td className="px-4 py-3">{stage || "-"}</td>

                                                    <td className="px-4 py-3">
                                                        {formatSecondsToHuman(
                                                            typeof c.first_response_sec === "number"
                                                                ? c.first_response_sec
                                                                : null
                                                        )}
                                                    </td>

                                                    <td className="px-4 py-3">
                                                        {formatSecondsToHuman(
                                                            typeof c.time_to_close_sec === "number"
                                                                ? c.time_to_close_sec
                                                                : null
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
