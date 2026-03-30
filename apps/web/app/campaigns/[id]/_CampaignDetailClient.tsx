"use client";


import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

// Ajusta este import según tu proyecto:
import { sbFetch } from "@/lib/supabaseRest";

type Campaign = {
    id: string;
    code: string;
    name: string;
    description: string;
    objective: string;
    success_criteria: string;
    target_audience: string;
    llm_policy: any;
    llm_system_prompt: string;
    qualification_fields: any;
    allowed_intents: any;
    disallowed_topics: any;
    closing_reasons: any;
    is_active: boolean;
    opening_script: string;
    opening_question: string;
    created_at: string;
    updated_at: string;
};

type CampaignProduct = {
    id: string;
    campaign_id: string;
    code: string;
    name: string;
    price_monthly: number;
    currency: string;
    is_active: boolean;
    price_text?: string | null;
    description?: string | null;
    source_url: string;
    updated_at: string;
};

type CampaignStatsRow = {
    campaign_id: string;
    campaign_code: string | null;
    campaign_name: string | null;
    is_active: boolean | null;

    leads_total?: number | null;
    leads_contesto?: number | null;
    leads_no_contesto?: number | null;
    leads_with_calls?: number | null;
    contact_rate_pct?: number | null;
    calls_per_lead_avg?: number | null;

    calls_total?: number | null;
    calls_llm?: number | null;
    calls_human?: number | null;
    calls_completed?: number | null;
    calls_unsuccessful?: number | null;
    calls_with_recording?: number | null;

    avg_duration_sec?: number | null;
    avg_llm_duration_sec?: number | null;
    avg_human_duration_sec?: number | null;

    handoff_total?: number | null;
    human_engaged_total?: number | null;

    intent_portabilidad?: number | null;
    intent_alta?: number | null;
    intent_info?: number | null;

    last_call_at?: string | null;
    products_total?: number | null;

    description?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
};

async function fetchCampaign(id: string): Promise<Campaign | null> {
    const res = await sbFetch<Campaign[]>("/rest/v1/campaigns", {
        query: {
            select:
                "id,code,name,description,objective,success_criteria,target_audience,llm_policy,llm_system_prompt," +
                "qualification_fields,allowed_intents,disallowed_topics,closing_reasons,is_active,opening_script,opening_question,created_at,updated_at",
            id: `eq.${id}`,
            limit: 1,
        },
    });
    return res?.[0] ?? null;
}

async function fetchCampaignStatsById(id: string): Promise<CampaignStatsRow | null> {
    const res = await sbFetch<CampaignStatsRow[]>("/rest/v1/v_campaign_stats", {
        query: {
            select: "*",
            campaign_id: `eq.${id}`,
            limit: 1,
        },
    });
    return res?.[0] ?? null;
}

async function fetchCampaignProducts(id: string): Promise<CampaignProduct[]> {
    return sbFetch<CampaignProduct[]>("/rest/v1/campaign_products", {
        query: {
            select:
                "id,campaign_id,code,name,price_monthly,currency,is_active,price_text,description,source_url,updated_at",
            campaign_id: `eq.${id}`,
            order: "updated_at.desc",
            limit: 200,
        },
    });
}

function fmtNum(v?: number | null) {
    if (v == null || Number.isNaN(v)) return "-";
    return Intl.NumberFormat().format(Number(v));
}

function fmtPct(v?: number | null) {
    if (v == null || Number.isNaN(v)) return "-";
    return `${Number(v).toFixed(1)}%`;
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

function JsonBlock({ value }: { value: any }) {
    const text = useMemo(() => {
        try {
            return JSON.stringify(value ?? null, null, 2);
        } catch {
            return String(value ?? "");
        }
    }, [value]);

    return (
        <pre className="text-xs rounded-lg border bg-muted/20 p-3 overflow-auto max-h-[320px]">
            {text}
        </pre>
    );
}

export default function CampaignDetailPage() {
    const params = useParams();
    const id = String((params as any)?.id ?? "");

    const [campaign, setCampaign] = useState<Campaign | null>(null);
    const [stats, setStats] = useState<CampaignStatsRow | null>(null);
    const [products, setProducts] = useState<CampaignProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;

        async function run() {
            if (!id) {
                setLoading(false);
                setError("Falta parámetro id");
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const [c, s, p] = await Promise.all([
                    fetchCampaign(id),
                    fetchCampaignStatsById(id),
                    fetchCampaignProducts(id),
                ]);

                if (!alive) return;
                setCampaign(c);
                setStats(s);
                setProducts(p ?? []);
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
    }, [id]);

    if (loading) {
        return (
            <div className="p-6">
                <div className="rounded-xl border p-4 text-sm text-muted-foreground">Cargando campaña…</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6 space-y-3">
                <div className="rounded-xl border p-4 text-sm text-red-600">Error: {error}</div>
                <Link href="/campaigns" className="text-sm underline">
                    Volver
                </Link>
            </div>
        );
    }

    if (!campaign) {
        return (
            <div className="p-6 space-y-3">
                <div className="rounded-xl border p-4 text-sm">No se encontró la campaña.</div>
                <Link href="/campaigns" className="text-sm underline">
                    Volver
                </Link>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">
                        <Link href="/campaigns" className="hover:underline">
                            Campañas
                        </Link>{" "}
                        / <span className="font-mono">{campaign.code}</span>
                    </div>
                    <h1 className="text-2xl font-semibold">{campaign.name}</h1>
                    <div className="text-sm text-muted-foreground">
                        upd: {fmtDate(campaign.updated_at)} · created: {fmtDate(campaign.created_at)}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs border ${campaign.is_active ? "bg-green-50" : "bg-muted"
                            }`}
                    >
                        {campaign.is_active ? "Activa" : "Inactiva"}
                    </span>

                    <Link
                        href={`/campaigns/${campaign.id}/edit`}
                        className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-muted"
                    >
                        Editar
                    </Link>
                </div>
            </div>

            {/* Cards KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-xl border p-4 space-y-1">
                    <div className="text-xs text-muted-foreground">Leads</div>
                    <div className="text-2xl font-semibold">{fmtNum(stats?.leads_total)}</div>
                    <div className="text-sm text-muted-foreground">
                        contesto: {fmtNum(stats?.leads_contesto)} · no: {fmtNum(stats?.leads_no_contesto)}
                    </div>
                    <div className="text-sm">
                        <b>Contact %:</b> {fmtPct(stats?.contact_rate_pct)}
                    </div>
                </div>

                <div className="rounded-xl border p-4 space-y-1">
                    <div className="text-xs text-muted-foreground">Llamadas</div>
                    <div className="text-2xl font-semibold">{fmtNum(stats?.calls_total)}</div>
                    <div className="text-sm text-muted-foreground">
                        llm: {fmtNum(stats?.calls_llm)} · human: {fmtNum(stats?.calls_human)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                        ok: {fmtNum(stats?.calls_completed)} · fail: {fmtNum(stats?.calls_unsuccessful)}
                    </div>
                    <div className="text-sm">
                        <b>Avg dur:</b> {fmtSec(stats?.avg_duration_sec)}
                    </div>
                </div>

                <div className="rounded-xl border p-4 space-y-1">
                    <div className="text-xs text-muted-foreground">Operación</div>
                    <div className="text-sm">
                        <b>Handoff:</b> {fmtNum(stats?.handoff_total)}{" "}
                        <span className="text-muted-foreground">
                            (human engaged: {fmtNum(stats?.human_engaged_total)})
                        </span>
                    </div>
                    <div className="text-sm">
                        <b>Recordings:</b> {fmtNum(stats?.calls_with_recording)}
                    </div>
                    <div className="text-sm">
                        <b>Productos:</b> {fmtNum(stats?.products_total)}
                    </div>
                    <div className="text-sm">
                        <b>Última llamada:</b> {fmtDate(stats?.last_call_at)}
                    </div>
                </div>
            </div>

            {/* Info textual */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-xl border p-4 space-y-2">
                    <div className="font-medium">Descripción / Objetivo</div>
                    <div className="text-sm">
                        <b>Descripción:</b> {campaign.description || "-"}
                    </div>
                    <div className="text-sm">
                        <b>Objetivo:</b> {campaign.objective || "-"}
                    </div>
                    <div className="text-sm">
                        <b>Criterio de éxito:</b> {campaign.success_criteria || "-"}
                    </div>
                    <div className="text-sm">
                        <b>Audiencia:</b> {campaign.target_audience || "-"}
                    </div>
                </div>

                <div className="rounded-xl border p-4 space-y-2">
                    <div className="font-medium">Apertura (Voice)</div>
                    <div className="text-sm">
                        <b>Opening script:</b> {campaign.opening_script || "-"}
                    </div>
                    <div className="text-sm">
                        <b>Opening question:</b> {campaign.opening_question || "-"}
                    </div>
                </div>
            </div>

            {/* Tabs simples (sin librería): Stats JSON + Productos */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-xl border p-4 space-y-2">
                    <div className="font-medium">LLM Policy</div>
                    <JsonBlock value={campaign.llm_policy} />
                </div>

                <div className="rounded-xl border p-4 space-y-2">
                    <div className="font-medium">System Prompt</div>
                    <pre className="text-xs rounded-lg border bg-muted/20 p-3 overflow-auto max-h-[320px] whitespace-pre-wrap">
                        {campaign.llm_system_prompt || ""}
                    </pre>
                </div>
            </div>

            <div className="rounded-xl border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <div className="font-medium">Productos de campaña</div>
                        <div className="text-sm text-muted-foreground">
                            Total: {products.length} (mostrando hasta 200)
                        </div>
                    </div>

                    <Link
                        href={`/campaigns/${campaign.id}/products`}
                        className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-muted"
                    >
                        Administrar productos
                    </Link>
                </div>

                <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr className="text-left">
                                <th className="p-3">Código</th>
                                <th className="p-3">Nombre</th>
                                <th className="p-3">Precio</th>
                                <th className="p-3">Activo</th>
                                <th className="p-3">Updated</th>
                            </tr>
                        </thead>
                        <tbody>
                            {products.map((p) => (
                                <tr key={p.id} className="border-t hover:bg-muted/30">
                                    <td className="p-3 font-mono text-xs">{p.code}</td>
                                    <td className="p-3">
                                        <div className="flex flex-col">
                                            <span className="font-medium">{p.name}</span>
                                            {p.description ? (
                                                <span className="text-xs text-muted-foreground">
                                                    {String(p.description).slice(0, 90)}
                                                    {String(p.description).length > 90 ? "…" : ""}
                                                </span>
                                            ) : null}
                                        </div>
                                    </td>
                                    <td className="p-3">
                                        {p.price_text ? (
                                            <span>{p.price_text}</span>
                                        ) : (
                                            <span>
                                                {p.currency} {p.price_monthly}
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-3">{p.is_active ? "Sí" : "No"}</td>
                                    <td className="p-3">{fmtDate(p.updated_at)}</td>
                                </tr>
                            ))}

                            {products.length === 0 && (
                                <tr>
                                    <td className="p-4 text-sm text-muted-foreground" colSpan={5}>
                                        No hay productos registrados para esta campaña.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Extras: Intents */}
            <div className="rounded-xl border p-4 space-y-2">
                <div className="font-medium">Intents (IA)</div>
                <div className="text-sm text-muted-foreground">
                    Distribución según lo que viene guardado en metadata (ej. llm.service_interest / assistant.intent).
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Portabilidad</div>
                        <div className="text-xl font-semibold">{fmtNum(stats?.intent_portabilidad)}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Alta</div>
                        <div className="text-xl font-semibold">{fmtNum(stats?.intent_alta)}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">Info</div>
                        <div className="text-xl font-semibold">{fmtNum(stats?.intent_info)}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
