"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { sbFetch } from "@/lib/supabaseRest";
import { useTenant } from "@/lib/tenant/use-tenant";

type LeadWithCampaign = {
    id: string;
    phone: string | null;
    campaign: string | null;
    estado_cliente: string | null;
    created_at: string;

    // ✅ columnas de la view v_leads_with_campaign
    campaign_name?: string | null;
    campaign_objective?: string | null;
    campaign_description?: string | null;
};

type Call = {
    id: string;
    lead_id: string;
    mode: string;
    status: string | null;
    started_at: string | null;
    created_at: string;
    duration_sec: number | null;
};

export default function LeadPage() {
    const { context, loading: tenantLoading } = useTenant();
    const tenantId = context?.tenantId || undefined;
    const [lead, setLead] = useState<LeadWithCampaign | null>(null);
    const [calls, setCalls] = useState<Call[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const id = new URLSearchParams(window.location.search).get("id");
        if (!id || tenantLoading || !tenantId) return;

        (async () => {
            setLoading(true);

            // ✅ ahora consume la VIEW
            const leadRes = await sbFetch<LeadWithCampaign[]>("/rest/v1/v_leads_with_campaign", {
                tenantId,
                query: { select: "*", id: `eq.${id}`, limit: 1 },
            });

            const callsRes = await sbFetch<Call[]>("/rest/v1/calls", {
                tenantId,
                query: {
                    select: "id,lead_id,mode,status,started_at,created_at,duration_sec",
                    lead_id: `eq.${id}`,
                    order: "created_at.desc",
                    limit: 50,
                },
            });

            setLead(leadRes[0] ?? null);
            setCalls(callsRes ?? []);
            setLoading(false);
        })().catch(() => setLoading(false));
    }, [tenantLoading, tenantId]);

    if (loading) return <div className="p-6">Cargando…</div>;
    if (!lead) return <div className="p-6">Lead no encontrado.</div>;

    const campaignName = lead.campaign_name || lead.campaign || "-";
    const objective = (lead.campaign_objective || "").trim();
    const description = (lead.campaign_description || "").trim();

    return (
        <div className="p-6 space-y-6">
            <div>
                <Link href="/leads" className="text-sm underline">
                    ← Volver
                </Link>

                <h1 className="text-2xl font-semibold mt-2">Lead</h1>

                <div className="text-sm text-muted-foreground">
                    {lead.phone ?? "-"} · {campaignName} · {lead.estado_cliente ?? "-"}
                </div>

                {/* ✅ Nuevo panel objetivo campaña */}
                {(objective || description) && (
                    <div className="mt-4 rounded-xl border p-4 bg-muted/20">
                        <div className="text-sm font-medium">Campaña</div>
                        <div className="text-sm text-muted-foreground mt-1">
                            <span className="font-medium text-foreground">Nombre:</span> {campaignName}
                        </div>
                        {objective && (
                            <div className="text-sm text-muted-foreground mt-1">
                                <span className="font-medium text-foreground">Objetivo:</span> {objective}
                            </div>
                        )}
                        {description && (
                            <div className="text-sm text-muted-foreground mt-1">
                                <span className="font-medium text-foreground">Descripción:</span> {description}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="rounded-xl border overflow-hidden">
                <div className="p-3 font-medium bg-muted/50">Llamadas</div>
                <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                        <tr>
                            <th className="text-left p-3">Modo</th>
                            <th className="text-left p-3">Estado</th>
                            <th className="text-left p-3">Inicio</th>
                            <th className="text-left p-3">Duración</th>
                            <th className="text-right p-3">Detalle</th>
                        </tr>
                    </thead>
                    <tbody>
                        {calls.map((c) => (
                            <tr key={c.id} className="border-t">
                                <td className="p-3">{c.mode}</td>
                                <td className="p-3">{(c.status || "").trim() || "-"}</td>
                                <td className="p-3">{c.started_at ? new Date(c.started_at).toLocaleString() : "-"}</td>
                                <td className="p-3">{c.duration_sec ?? "-"}</td>
                                <td className="p-3 text-right">
                                    <Link className="underline" href={`/call?id=${c.id}`}>
                                        Ver
                                    </Link>
                                </td>
                            </tr>
                        ))}
                        {calls.length === 0 && (
                            <tr>
                                <td className="p-6 text-center text-muted-foreground" colSpan={5}>
                                    No hay llamadas para este lead.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
