"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTenant } from "@/lib/tenant/use-tenant";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback-state";

type WorkStatus = "" | "queued" | "assigned" | "in_progress" | "done";

type CampaignOption = {
    id: string;
    code: string | null;
    name: string | null;
};

type CommercialResp = {
    kpis: {
        total: number;
        funnel: {
            queued: number;
            assigned: number;
            in_progress: number;
            closed: number;
        };
        attended: number;
        with_owner: number;
        unassigned: number;
        takeover_taken: number;
        escalated: number;
        overdue: number;
        rates: {
            attended_pct: number;
            conversion_pct: number;
            takeover_pct: number;
            escalated_pct: number;
            bottleneck_pct: number;
        };
    };
    bottlenecks: Array<{
        key: string;
        label: string;
        value: number;
        rate_pct: number;
    }>;
    campaign_breakdown: Array<{
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
    }>;
};

function readAccessTokenFromStorage() {
    if (typeof window === "undefined") return null;
    for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i) || "";
        if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw);
            const access = parsed?.access_token || parsed?.currentSession?.access_token || null;
            if (access) return String(access);
        } catch {
            // no-op
        }
    }
    return null;
}

function isManagerRole(role: string | null | undefined) {
    const r = String(role || "").toLowerCase();
    return r === "superadmin" || r === "tenant_admin" || r === "supervisor";
}

function formatCount(v: number | null | undefined) {
    return Number(v || 0).toLocaleString("es-PE");
}

function formatPct(v: number | null | undefined) {
    return `${Number(v || 0).toFixed(1)}%`;
}

function campaignLabel(c: CampaignOption) {
    const name = (c.name || "").trim();
    const code = (c.code || "").trim();
    if (name && code) return `${name} (${code})`;
    if (name) return name;
    if (code) return code;
    return c.id;
}

export default function LeadsCommercialInsightsPage() {
    const { context, loading: tenantLoading } = useTenant();
    const canRead = isManagerRole(context?.role);

    const [token, setToken] = useState<string | null>(null);
    const [campaignId, setCampaignId] = useState("");
    const [workStatus, setWorkStatus] = useState<WorkStatus>("");
    const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resp, setResp] = useState<CommercialResp | null>(null);

    useEffect(() => {
        setToken(readAccessTokenFromStorage());
    }, []);

    useEffect(() => {
        if (!token) return;
        let alive = true;
        (async () => {
            try {
                const res = await fetch("/api/aap/leads/wow-campaigns", {
                    cache: "no-store",
                    headers: { Authorization: `Bearer ${token}` },
                });
                const body = await res.json().catch(() => ({}));
                if (!alive) return;
                setCampaigns(res.ok && Array.isArray(body?.items) ? body.items : []);
            } catch {
                if (!alive) return;
                setCampaigns([]);
            }
        })();

        return () => {
            alive = false;
        };
    }, [token]);

    async function fetchCommercialInsights() {
        if (!token) return;
        setLoading(true);
        setError(null);
        try {
            const p = new URLSearchParams();
            if (campaignId.trim()) p.set("campaign_id", campaignId.trim());
            if (workStatus.trim()) p.set("work_status", workStatus.trim());

            const res = await fetch(`/api/aap/leads/commercial-insights?${p.toString()}`, {
                cache: "no-store",
                headers: { Authorization: `Bearer ${token}` },
            });
            const body = (await res.json().catch(() => ({}))) as CommercialResp & { error?: string };
            if (!res.ok) throw new Error(String(body?.error || `HTTP ${res.status}`));
            setResp(body);
        } catch (e: unknown) {
            setResp(null);
            setError(e instanceof Error ? e.message : "Error cargando commercial insights");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!token || !canRead) return;
        fetchCommercialInsights();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, campaignId, workStatus, canRead]);

    const campaignsSorted = useMemo(() => {
        const arr = Array.isArray(campaigns) ? [...campaigns] : [];
        arr.sort((a, b) => campaignLabel(a).toLowerCase().localeCompare(campaignLabel(b).toLowerCase()));
        return arr;
    }, [campaigns]);

    const kpis = resp?.kpis;
    const funnel = kpis?.funnel;

    const funnelRows = [
        { key: "queued", label: "1) Nuevo/En cola", value: funnel?.queued || 0 },
        { key: "assigned", label: "2) Asignado", value: funnel?.assigned || 0 },
        { key: "in_progress", label: "3) En progreso", value: funnel?.in_progress || 0 },
        { key: "closed", label: "4) Cerrado", value: funnel?.closed || 0 },
    ];

    const maxFunnel = Math.max(1, ...funnelRows.map((row) => row.value));

    if (tenantLoading) {
        return <LoadingState className="m-6" label="Cargando contexto de organización..." />;
    }

    if (!canRead) {
        return (
            <div className="p-6 space-y-4">
                <h1 className="text-2xl font-semibold">Commercial Funnel / Conversion Insights</h1>
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                    Acceso restringido. Esta vista requiere rol supervisor, tenant_admin o superadmin.
                </div>
                <div className="text-sm space-x-3">
                    <Link className="underline" href="/leads/desk">Human Desk</Link>
                    <Link className="underline" href="/leads/manager">Manager View</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Commercial Funnel / Conversion Insights</h1>
                    <p className="text-sm text-muted-foreground">
                        Lectura comercial/gerencial para avance de leads, conversión por campaña y cuellos operativos.
                    </p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                    <Link className="underline" href="/leads/manager">Manager View</Link>
                    <Link className="underline" href="/leads/desk">Human Desk</Link>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                    <div className="text-xs text-muted-foreground mb-1">Campaña</div>
                    <select className="w-full border rounded-md px-3 py-2 text-sm" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                        <option value="">Todas</option>
                        {campaignsSorted.map((c) => <option key={c.id} value={c.id}>{campaignLabel(c)}</option>)}
                    </select>
                </div>
                <div>
                    <div className="text-xs text-muted-foreground mb-1">Estado de trabajo</div>
                    <select className="w-full border rounded-md px-3 py-2 text-sm" value={workStatus} onChange={(e) => setWorkStatus((e.target.value || "") as WorkStatus)}>
                        <option value="">Todos</option>
                        <option value="queued">queued</option>
                        <option value="assigned">assigned</option>
                        <option value="in_progress">in_progress</option>
                        <option value="done">done</option>
                    </select>
                </div>
                <div className="flex items-end">
                    <button className="border rounded-md px-3 py-2 text-sm" onClick={() => fetchCommercialInsights()} disabled={loading || !token}>
                        {loading ? "Refrescando..." : "Refrescar"}
                    </button>
                </div>
            </div>

            {error ? (
                <ErrorState
                    title="No pudimos actualizar Commercial Insights"
                    description={`Puedes reintentar la carga. Detalle técnico: ${error}`}
                    className="p-3"
                />
            ) : null}

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Leads</div><div className="text-xl font-semibold">{formatCount(kpis?.total)}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Atendidos</div><div className="text-xl font-semibold">{formatCount(kpis?.attended)}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Cerrados</div><div className="text-xl font-semibold">{formatCount(funnel?.closed)}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Takeover activo</div><div className="text-xl font-semibold">{formatCount(kpis?.takeover_taken)}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Escalados</div><div className="text-xl font-semibold text-amber-700">{formatCount(kpis?.escalated)}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">SLA vencido</div><div className="text-xl font-semibold text-red-700">{formatCount(kpis?.overdue)}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Conv. global</div><div className="text-xl font-semibold">{formatPct(kpis?.rates?.conversion_pct)}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Bottleneck</div><div className="text-xl font-semibold">{formatPct(kpis?.rates?.bottleneck_pct)}</div></div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="border rounded-lg p-3 space-y-2">
                    <div className="text-sm font-medium">Funnel mínimo de leads</div>
                    {funnelRows.map((row) => {
                        const width = Math.max(6, Math.round((row.value / maxFunnel) * 100));
                        return (
                            <div key={row.key} className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">{row.label}</span>
                                    <span className="font-medium">{formatCount(row.value)}</span>
                                </div>
                                <div className="h-2 rounded bg-muted overflow-hidden">
                                    <div className="h-2 bg-blue-600" style={{ width: `${width}%` }} />
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="border rounded-lg p-3 text-sm">
                    <div className="font-medium mb-2">Cuellos de botella operativos</div>
                    {!resp?.bottlenecks?.length ? (
                        <EmptyState title="Sin alertas" description="No encontramos señales de cuello de botella con los filtros actuales." />
                    ) : (
                        <div className="space-y-2">
                            {resp.bottlenecks.map((b) => (
                                <div key={b.key} className="rounded border p-2">
                                    <div className="flex items-center justify-between">
                                        <span>{b.label}</span>
                                        <span className="font-medium">{formatCount(b.value)}</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground">Impacto: {formatPct(b.rate_pct)}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b text-sm font-medium">Conversión por campaña (ranking)</div>
                <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                        <tr>
                            <th className="text-left px-3 py-2">Campaña</th>
                            <th className="text-left px-3 py-2">Leads</th>
                            <th className="text-left px-3 py-2">Atendidos</th>
                            <th className="text-left px-3 py-2">En progreso</th>
                            <th className="text-left px-3 py-2">Cerrados</th>
                            <th className="text-left px-3 py-2">Conv.%</th>
                            <th className="text-left px-3 py-2">Escalados</th>
                            <th className="text-left px-3 py-2">SLA vencido</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!resp?.campaign_breakdown?.length ? (
                            <tr>
                                <td className="px-3 py-6" colSpan={8}>
                                    <EmptyState
                                        title="Sin campañas para este corte"
                                        description="Revisa filtros o valida seed demo en el tenant activo."
                                    />
                                </td>
                            </tr>
                        ) : resp.campaign_breakdown.map((row) => (
                            <tr key={row.campaign_id} className="border-t">
                                <td className="px-3 py-2">{row.campaign_name || row.campaign_id.slice(0, 8)}</td>
                                <td className="px-3 py-2">{formatCount(row.leads_total)}</td>
                                <td className="px-3 py-2">{formatCount(row.attended)} ({formatPct(row.attended_rate_pct)})</td>
                                <td className="px-3 py-2">{formatCount(row.in_progress)}</td>
                                <td className="px-3 py-2">{formatCount(row.closed)}</td>
                                <td className="px-3 py-2 font-medium">{formatPct(row.conversion_rate_pct)}</td>
                                <td className="px-3 py-2">{formatCount(row.escalated)}</td>
                                <td className="px-3 py-2">{formatCount(row.overdue)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
