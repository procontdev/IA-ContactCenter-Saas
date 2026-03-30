// app/campaigns/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { sbFetchServer } from "@/lib/supabaseRest";
import ImportLeadsButton from "./ImportLeadsButton";

export const dynamicParams = false;

type PageProps = {
    params: Promise<{ id: string }>;
};

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
    created_at: string;
    updated_at: string;
    opening_script: string;
    opening_question: string;
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
    source_url?: string | null;
    updated_at: string;
};

type CampaignStats = {
    campaign_id: string;
    campaign_code: string;
    campaign_name: string;
    is_active: boolean;

    leads_total?: number | null;
    leads_contesto?: number | null;
    leads_no_contesto?: number | null;

    calls_total?: number | null;
    calls_llm?: number | null;
    calls_human?: number | null;
    calls_completed?: number | null;

    avg_duration_sec?: number | null;
    last_call_at?: string | null;

    leads_with_calls?: number | null;
    contact_rate_pct?: number | null;
    calls_per_lead_avg?: number | null;
    calls_unsuccessful?: number | null;
    calls_with_recording?: number | null;
    avg_llm_duration_sec?: number | null;
    avg_human_duration_sec?: number | null;
    handoff_total?: number | null;
    human_engaged_total?: number | null;
    intent_portabilidad?: number | null;
    intent_alta?: number | null;
    intent_info?: number | null;

    // si lo agregaste en la vista:
    product_count?: number | null;


};

function n(v: any) {
    if (v === null || v === undefined) return "-";
    return String(v);
}

async function fetchCampaignIds() {
    return sbFetchServer<{ id: string }[]>("/rest/v1/campaigns", {
        query: {
            select: "id",
            order: "updated_at.desc",
            limit: 500,
        },
    });
}

export async function generateStaticParams() {
    const rows = await fetchCampaignIds();
    return (rows ?? []).map((r) => ({ id: r.id }));
}

async function fetchCampaign(id: string): Promise<Campaign | null> {
    const rows = await sbFetchServer<Campaign[]>("/rest/v1/campaigns", {
        query: {
            select:
                "id,code,name,description,objective,success_criteria,target_audience,llm_policy,llm_system_prompt," +
                "qualification_fields,allowed_intents,disallowed_topics,closing_reasons,is_active,created_at,updated_at," +
                "opening_script,opening_question",
            id: `eq.${id}`,
            limit: 1,
        },
    });
    return rows?.[0] ?? null;
}

async function fetchCampaignProducts(id: string): Promise<CampaignProduct[]> {
    return sbFetchServer<CampaignProduct[]>("/rest/v1/campaign_products", {
        query: {
            select: "id,campaign_id,code,name,price_monthly,currency,is_active,price_text,description,source_url,updated_at",
            campaign_id: `eq.${id}`,
            order: "updated_at.desc",
            limit: 200,
        },
    });
}

async function fetchCampaignStats(id: string): Promise<CampaignStats | null> {
    const rows = await sbFetchServer<CampaignStats[]>("/rest/v1/v_campaign_stats", {
        query: {
            select: "*",
            campaign_id: `eq.${id}`,
            limit: 1,
        },
    });
    return rows?.[0] ?? null;
}

export default async function CampaignDetailPage({ params }: PageProps) {
    const { id } = await params; // ✅ Next 16: params es Promise

    if (!id) notFound();

    const [campaign, stats, products] = await Promise.all([
        fetchCampaign(id),
        fetchCampaignStats(id),
        fetchCampaignProducts(id),
    ]);

    if (!campaign) notFound();

    const productCount = (stats as any)?.product_count ?? products.length;

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="text-sm text-muted-foreground">Campaña</div>
                    <h1 className="text-2xl font-semibold">
                        {campaign.name}{" "}
                        <span className="text-muted-foreground">({campaign.code})</span>
                    </h1>
                    <div className="text-sm text-muted-foreground mt-1">
                        Activa: <b>{campaign.is_active ? "Sí" : "No"}</b> · Actualizado:{" "}
                        <b>{new Date(campaign.updated_at).toLocaleString()}</b>
                    </div>
                </div>

                <div className="flex gap-2 flex-wrap justify-end">
                    <Link href="/campaigns" className="rounded-lg border px-3 py-2 text-sm hover:bg-muted">
                        ← Volver
                    </Link>

                    {/* ✅ BOTÓN IMPORTAR (AQUÍ) */}
                    <ImportLeadsButton
                        campaignId={campaign.id}
                        campaignCode={campaign.code}
                    />

                    <Link
                        href={`/campaigns/${campaign.id}/edit`}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-muted"
                    >
                        Editar
                    </Link>
                </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="rounded-xl border p-4">
                    <div className="text-xs text-muted-foreground">Leads</div>
                    <div className="text-2xl font-semibold">{n(stats?.leads_total ?? 0)}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                        Contesta: {n(stats?.leads_contesto ?? 0)} · No: {n(stats?.leads_no_contesto ?? 0)}
                    </div>
                </div>

                <div className="rounded-xl border p-4">
                    <div className="text-xs text-muted-foreground">Llamadas</div>
                    <div className="text-2xl font-semibold">{n(stats?.calls_total ?? 0)}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                        LLM: {n(stats?.calls_llm ?? 0)} · Humano: {n(stats?.calls_human ?? 0)}
                    </div>
                </div>

                <div className="rounded-xl border p-4">
                    <div className="text-xs text-muted-foreground">Contact rate</div>
                    <div className="text-2xl font-semibold">{n(stats?.contact_rate_pct ?? "-")}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                        Leads con llamadas: {n(stats?.leads_with_calls ?? 0)}
                    </div>
                </div>

                <div className="rounded-xl border p-4">
                    <div className="text-xs text-muted-foreground">Productos</div>
                    <div className="text-2xl font-semibold">{n(productCount)}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                        Activos: {products.filter((p) => p.is_active).length}
                    </div>
                </div>
            </div>

            {/* Info campaña */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border p-4 space-y-2">
                    <div className="font-medium">Descripción</div>
                    <div className="text-sm whitespace-pre-wrap">{campaign.description || "-"}</div>

                    <div className="font-medium mt-4">Objetivo</div>
                    <div className="text-sm whitespace-pre-wrap">{campaign.objective || "-"}</div>

                    <div className="font-medium mt-4">Criterio de éxito</div>
                    <div className="text-sm whitespace-pre-wrap">{campaign.success_criteria || "-"}</div>
                </div>

                <div className="rounded-xl border p-4 space-y-2">
                    <div className="font-medium">Apertura (voz)</div>
                    <div className="text-sm whitespace-pre-wrap">{campaign.opening_script || "-"}</div>

                    <div className="font-medium mt-4">Pregunta inicial</div>
                    <div className="text-sm whitespace-pre-wrap">{campaign.opening_question || "-"}</div>

                    <div className="font-medium mt-4">Policy / Intents</div>
                    <div className="text-xs text-muted-foreground">llm_policy</div>
                    <pre className="text-xs overflow-auto rounded-lg bg-muted p-3">
                        {JSON.stringify(campaign.llm_policy ?? {}, null, 2)}
                    </pre>
                </div>
            </div>

            {/* Productos */}
            <div className="rounded-xl border p-4">
                <div className="flex items-center justify-between">
                    <div className="font-medium">Productos de campaña</div>
                    <div className="text-xs text-muted-foreground">
                        Última llamada: {stats?.last_call_at ? new Date(stats.last_call_at).toLocaleString() : "-"}
                    </div>
                </div>

                <div className="mt-3 overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="text-xs text-muted-foreground">
                            <tr className="border-b">
                                <th className="py-2 text-left">Código</th>
                                <th className="py-2 text-left">Nombre</th>
                                <th className="py-2 text-left">Precio</th>
                                <th className="py-2 text-left">Estado</th>
                                <th className="py-2 text-left">Actualizado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {products.length === 0 ? (
                                <tr>
                                    <td className="py-4 text-muted-foreground" colSpan={5}>
                                        No hay productos registrados para esta campaña.
                                    </td>
                                </tr>
                            ) : (
                                products.map((p) => (
                                    <tr key={p.id} className="border-b last:border-b-0">
                                        <td className="py-2">{p.code}</td>
                                        <td className="py-2">{p.name}</td>
                                        <td className="py-2">
                                            {p.price_text?.trim()
                                                ? p.price_text
                                                : `${p.currency} ${Number(p.price_monthly).toFixed(2)}`}
                                        </td>
                                        <td className="py-2">{p.is_active ? "Activo" : "Inactivo"}</td>
                                        <td className="py-2">
                                            {p.updated_at ? new Date(p.updated_at).toLocaleString() : "-"}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
