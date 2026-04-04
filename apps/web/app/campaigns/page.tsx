"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

// Ajusta este import según tu proyecto:
import { sbFetch } from "@/lib/supabaseRest";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback-state";

type CampaignStatsRow = {
    campaign_id: string;
    campaign_code: string | null;
    campaign_name: string | null;
    is_active: boolean | null;

    description?: string | null;
    updated_at?: string | null;
    products_total?: number | null;

    leads_total?: number | null;
    leads_contesto?: number | null;
    leads_no_contesto?: number | null;
    contact_rate_pct?: number | null;

    calls_total?: number | null;
    calls_llm?: number | null;
    calls_human?: number | null;
    calls_completed?: number | null;
    calls_unsuccessful?: number | null;

    calls_with_recording?: number | null;
    avg_duration_sec?: number | null;
    last_call_at?: string | null;

    handoff_total?: number | null;
    human_engaged_total?: number | null;

    intent_portabilidad?: number | null;
    intent_alta?: number | null;
    intent_info?: number | null;
};

import { useTenant } from "@/lib/tenant/use-tenant";

const DEMO_CODE_PREFIX = "DEMOSEED_";

async function fetchCampaignStats(tenantId?: string): Promise<CampaignStatsRow[]> {
    return sbFetch<CampaignStatsRow[]>("/rest/v1/v_campaign_stats", {
        tenantId, // 👈 Inyección automática de filtro
        query: {
            select:
                "campaign_id,campaign_code,campaign_name,is_active,description,updated_at,products_total," +
                "leads_total,leads_contesto,leads_no_contesto,contact_rate_pct," +
                "calls_total,calls_llm,calls_human,calls_completed,calls_unsuccessful,calls_with_recording,avg_duration_sec,last_call_at," +
                "handoff_total,human_engaged_total,intent_portabilidad,intent_alta,intent_info",
            order: "updated_at.desc",
            limit: 200,
        },
    });
}

function fmtPct(v?: number | null) {
    if (v == null || Number.isNaN(v)) return "-";
    return `${Number(v).toFixed(1)}%`;
}

function fmtNum(v?: number | null) {
    if (v == null || Number.isNaN(v)) return "-";
    return Intl.NumberFormat().format(Number(v));
}

function fmtSec(v?: number | null) {
    if (v == null || Number.isNaN(v)) return "-";
    const sec = Math.max(0, Math.floor(Number(v)));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtDate(v?: string | null) {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString("es-PE");
}

export default function CampaignsPage() {
    const { context, loading: tenantLoading } = useTenant();
    const [rows, setRows] = useState<CampaignStatsRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [q, setQ] = useState("");
    const [onlyActive, setOnlyActive] = useState(false);

    useEffect(() => {
        if (tenantLoading) return;

        let alive = true;
        async function run() {
            setLoading(true);
            setError(null);
            try {
                const data = await fetchCampaignStats(context?.tenantId || undefined);
                if (!alive) return;
                setRows(data ?? []);
            } catch (e: any) {
                if (!alive) return;
                setError(e?.message ?? String(e));
            } finally {
                if (!alive) return;
                setLoading(false);
            }
        }
        run();
        return () => {
            alive = false;
        };
    }, [tenantLoading, context?.tenantId]);

    const filtered = useMemo(() => {
        const qq = q.trim().toLowerCase();
        return (rows ?? []).filter((r) => {
            if (onlyActive && !r.is_active) return false;
            if (!qq) return true;
            const hay =
                `${r.campaign_code ?? ""} ${r.campaign_name ?? ""} ${r.description ?? ""}`.toLowerCase();
            return hay.includes(qq);
        });
    }, [rows, q, onlyActive]);

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold">Campañas</h1>
                    <p className="text-sm text-muted-foreground">
                        Listado y métricas resumidas (leads, llamadas, handoff, intents, productos).
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Link
                        href="/campaigns/new"
                        className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-muted"
                    >
                        + Nueva campaña
                    </Link>
                </div>
            </div>

            <div className="flex gap-3 flex-wrap items-center">
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar por code, nombre o descripción…"
                    className="w-full sm:w-[420px] rounded-md border px-3 py-2 text-sm"
                />
                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        checked={onlyActive}
                        onChange={(e) => setOnlyActive(e.target.checked)}
                    />
                    Solo activas
                </label>
                <button
                    className="inline-flex items-center rounded-md border px-3 py-2 text-xs hover:bg-muted"
                    onClick={() => setQ(DEMO_CODE_PREFIX)}
                >
                    Ver solo DEMOSEED_
                </button>
            </div>

            {loading && <LoadingState label="Cargando campañas y métricas..." />}

            {error && <ErrorState title="No pudimos cargar campañas" description={error} />}

            {!loading && !error && (
                <div className="rounded-xl border overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr className="text-left">
                                <th className="p-3">Campaña</th>
                                <th className="p-3">Activa</th>
                                <th className="p-3">Leads</th>
                                <th className="p-3">Contact %</th>
                                <th className="p-3">Calls</th>
                                <th className="p-3">LLM/Human</th>
                                <th className="p-3">Handoff</th>
                                <th className="p-3">Avg dur</th>
                                <th className="p-3">Recordings</th>
                                <th className="p-3">Productos</th>
                                <th className="p-3">Última llamada</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((r) => (
                                <tr key={r.campaign_id} className="border-t hover:bg-muted/30">
                                    <td className="p-3">
                                        <div className="flex flex-col">
                                            <Link
                                                href={`/campaigns/${r.campaign_id}`}
                                                className="font-medium hover:underline"
                                            >
                                                {r.campaign_name ?? "(sin nombre)"}
                                            </Link>
                                            <div className="text-xs text-muted-foreground">
                                                <span className="font-mono">{r.campaign_code ?? "-"}</span>
                                                {String(r.campaign_code || "").toUpperCase().startsWith(DEMO_CODE_PREFIX) ? (
                                                    <span className="ml-2 inline-flex rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                                                        DEMO
                                                    </span>
                                                ) : null}
                                                {r.description ? (
                                                    <>
                                                        {" "}
                                                        · <span>{String(r.description).slice(0, 90)}{String(r.description).length > 90 ? "…" : ""}</span>
                                                    </>
                                                ) : null}
                                            </div>
                                        </div>
                                    </td>

                                    <td className="p-3">
                                        <span
                                            className={`inline-flex rounded-full px-2 py-0.5 text-xs border ${r.is_active ? "bg-green-50" : "bg-muted"
                                                }`}
                                        >
                                            {r.is_active ? "Sí" : "No"}
                                        </span>
                                    </td>

                                    <td className="p-3">{fmtNum(r.leads_total)}</td>

                                    <td className="p-3">{fmtPct(r.contact_rate_pct)}</td>

                                    <td className="p-3">
                                        <div className="flex flex-col">
                                            <span>{fmtNum(r.calls_total)}</span>
                                            <span className="text-xs text-muted-foreground">
                                                ok: {fmtNum(r.calls_completed)} · fail: {fmtNum(r.calls_unsuccessful)}
                                            </span>
                                        </div>
                                    </td>

                                    <td className="p-3">
                                        <span className="font-mono text-xs">
                                            {fmtNum(r.calls_llm)} / {fmtNum(r.calls_human)}
                                        </span>
                                    </td>

                                    <td className="p-3">
                                        <div className="flex flex-col">
                                            <span>{fmtNum(r.handoff_total)}</span>
                                            <span className="text-xs text-muted-foreground">
                                                human engaged: {fmtNum(r.human_engaged_total)}
                                            </span>
                                        </div>
                                    </td>

                                    <td className="p-3">{fmtSec(r.avg_duration_sec)}</td>

                                    <td className="p-3">{fmtNum(r.calls_with_recording)}</td>

                                    <td className="p-3">{fmtNum(r.products_total)}</td>

                                    <td className="p-3">
                                        <div className="flex flex-col">
                                            <span>{fmtDate(r.last_call_at)}</span>
                                            <span className="text-xs text-muted-foreground">
                                                upd: {fmtDate(r.updated_at)}
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            ))}

                            {filtered.length === 0 && (
                                <tr>
                                    <td className="p-4" colSpan={11}>
                                        <EmptyState
                                            title="No encontramos campañas con esos filtros"
                                            description="Ajusta la búsqueda o desactiva el filtro de campañas activas."
                                        />
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
