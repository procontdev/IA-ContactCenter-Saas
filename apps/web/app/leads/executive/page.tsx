"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTenantPlan } from "@/lib/packaging/use-tenant-plan";
import { useTenant } from "@/lib/tenant/use-tenant";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback-state";

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

type ManagerResp = {
    kpis: {
        total: number;
        sla_due_soon: number;
        sla_overdue: number;
        sla_escalated: number;
        unassigned: number;
    };
    alerts: {
        has_overdue: boolean;
        has_escalated: boolean;
        has_unassigned_load: boolean;
    };
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

function isExecutiveRole(role: string | null | undefined) {
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

function riskBadgeClass(level: "low" | "medium" | "high") {
    if (level === "high") return "border-red-300 bg-red-50 text-red-800";
    if (level === "medium") return "border-amber-300 bg-amber-50 text-amber-800";
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
}

export default function ExecutiveDemoDashboardPage() {
    const { context, loading: tenantLoading } = useTenant();
    const { plan, loading: planLoading } = useTenantPlan();
    const canRead = isExecutiveRole(context?.role);
    const executiveFeatureEnabled = Boolean(plan?.features?.executive_dashboard);

    const [token, setToken] = useState<string | null>(null);
    const [campaignId, setCampaignId] = useState("");
    const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [commercial, setCommercial] = useState<CommercialResp | null>(null);
    const [manager, setManager] = useState<ManagerResp | null>(null);

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

    async function fetchExecutiveData() {
        if (!token) return;
        setLoading(true);
        setError(null);
        try {
            const p = new URLSearchParams();
            if (campaignId.trim()) p.set("campaign_id", campaignId.trim());

            const [commercialRes, managerRes] = await Promise.all([
                fetch(`/api/aap/leads/commercial-insights?${p.toString()}`, {
                    cache: "no-store",
                    headers: { Authorization: `Bearer ${token}` },
                }),
                fetch(`/api/aap/leads/manager-view?${p.toString()}`, {
                    cache: "no-store",
                    headers: { Authorization: `Bearer ${token}` },
                }),
            ]);

            const commercialBody = (await commercialRes.json().catch(() => ({}))) as CommercialResp & { error?: string };
            const managerBody = (await managerRes.json().catch(() => ({}))) as ManagerResp & { error?: string };

            if (!commercialRes.ok) throw new Error(String(commercialBody?.error || `Commercial HTTP ${commercialRes.status}`));
            if (!managerRes.ok) throw new Error(String(managerBody?.error || `Manager HTTP ${managerRes.status}`));

            setCommercial(commercialBody);
            setManager(managerBody);
        } catch (e: unknown) {
            setCommercial(null);
            setManager(null);
            setError(e instanceof Error ? e.message : "Error cargando executive demo dashboard");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!token || !canRead) return;
        fetchExecutiveData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, campaignId, canRead]);

    const campaignsSorted = useMemo(() => {
        const arr = Array.isArray(campaigns) ? [...campaigns] : [];
        arr.sort((a, b) => campaignLabel(a).toLowerCase().localeCompare(campaignLabel(b).toLowerCase()));
        return arr;
    }, [campaigns]);

    const kpis = commercial?.kpis;
    const managerKpis = manager?.kpis;
    const total = kpis?.total || 0;

    const funnelRows = [
        { key: "queued", label: "1) Nuevos", value: kpis?.funnel?.queued || 0 },
        { key: "assigned", label: "2) Atendidos", value: kpis?.funnel?.assigned || 0 },
        { key: "in_progress", label: "3) En gestión", value: kpis?.funnel?.in_progress || 0 },
        { key: "closed", label: "4) Cerrados", value: kpis?.funnel?.closed || 0 },
    ];

    const riskScore = Math.max(
        Number(kpis?.rates?.escalated_pct || 0),
        Number(kpis?.rates?.bottleneck_pct || 0),
        Number(total > 0 ? ((managerKpis?.sla_overdue || 0) / total) * 100 : 0),
    );
    const riskLevel: "low" | "medium" | "high" = riskScore >= 20 ? "high" : riskScore >= 8 ? "medium" : "low";

    const campaignTop = (commercial?.campaign_breakdown || []).slice(0, 5);
    const primaryBottleneck = commercial?.bottlenecks?.[0] || null;

    const alerts = [
        {
            key: "sla_overdue",
            visible: Boolean(manager?.alerts?.has_overdue),
            label: "SLA vencido",
            detail: `${formatCount(managerKpis?.sla_overdue)} leads`,
            tone: "text-red-700",
        },
        {
            key: "sla_escalated",
            visible: Boolean(manager?.alerts?.has_escalated),
            label: "Escalaciones activas",
            detail: `${formatCount(managerKpis?.sla_escalated)} casos`,
            tone: "text-amber-700",
        },
        {
            key: "unassigned",
            visible: Boolean(manager?.alerts?.has_unassigned_load),
            label: "Carga sin owner",
            detail: `${formatCount(managerKpis?.unassigned)} leads`,
            tone: "text-yellow-700",
        },
    ].filter((a) => a.visible);

    if (tenantLoading || planLoading) {
        return <LoadingState className="m-6" label="Cargando contexto de organización..." />;
    }

    if (!executiveFeatureEnabled) {
        return (
            <div className="p-6 space-y-4">
                <h1 className="text-2xl font-semibold">Executive Demo Dashboard / Investor View</h1>
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                    Esta feature no está incluida en tu plan actual ({plan?.plan_name || "Basic"}).
                </div>
                <div className="text-sm space-x-3">
                    <Link className="underline" href="/leads/desk">Human Desk</Link>
                    <Link className="underline" href="/dashboard">Dashboard</Link>
                </div>
            </div>
        );
    }

    if (!canRead) {
        return (
            <div className="p-6 space-y-4">
                <h1 className="text-2xl font-semibold">Executive Demo Dashboard / Investor View</h1>
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                    Acceso restringido. Esta vista requiere rol supervisor, tenant_admin o superadmin.
                </div>
                <div className="text-sm space-x-3">
                    <Link className="underline" href="/leads/desk">Human Desk</Link>
                    <Link className="underline" href="/leads/manager">Manager View</Link>
                    <Link className="underline" href="/leads/commercial">Commercial Insights</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold">Executive Demo Dashboard / Investor View</h1>
                    <p className="text-sm text-muted-foreground max-w-3xl">
                        Lectura high-level para demo comercial y conversación ejecutiva: volumen, atención, cierre,
                        riesgo operativo y ranking de campañas.
                    </p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                    <Link className="underline" href="/demo">Demo Launcher</Link>
                    <Link className="underline" href="/leads/commercial">Commercial Insights</Link>
                    <Link className="underline" href="/leads/manager">Manager View</Link>
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
                <div className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground">Nivel de riesgo</div>
                    <div className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-medium ${riskBadgeClass(riskLevel)}`}>
                        {riskLevel === "high" ? "Riesgo alto" : riskLevel === "medium" ? "Riesgo medio" : "Riesgo controlado"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-2">Score: {formatPct(riskScore)}</div>
                </div>
                <div className="flex items-end">
                    <button className="border rounded-md px-3 py-2 text-sm" onClick={() => fetchExecutiveData()} disabled={loading || !token}>
                        {loading ? "Refrescando..." : "Refrescar"}
                    </button>
                </div>
            </div>

            {error ? (
                <ErrorState
                    title="No pudimos actualizar el Executive Demo Dashboard"
                    description={`Puedes reintentar la carga. Detalle técnico: ${error}`}
                    className="p-3"
                />
            ) : null}

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Volumen total</div><div className="text-2xl font-semibold">{formatCount(total)}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Atención</div><div className="text-2xl font-semibold">{formatPct(kpis?.rates?.attended_pct)}</div><div className="text-xs text-muted-foreground">{formatCount(kpis?.attended)} leads</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Cierre</div><div className="text-2xl font-semibold">{formatPct(kpis?.rates?.conversion_pct)}</div><div className="text-xs text-muted-foreground">{formatCount(kpis?.funnel?.closed)} cerrados</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Takeover activo</div><div className="text-2xl font-semibold">{formatCount(kpis?.takeover_taken)}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">SLA vencido</div><div className="text-2xl font-semibold text-red-700">{formatCount(managerKpis?.sla_overdue)}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Escalación</div><div className="text-2xl font-semibold text-amber-700">{formatCount(managerKpis?.sla_escalated)}</div><div className="text-xs text-muted-foreground">Due soon: {formatCount(managerKpis?.sla_due_soon)}</div></div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2 border rounded-lg p-3 space-y-2">
                    <div className="text-sm font-medium">Funnel ejecutivo</div>
                    {!total ? (
                        <EmptyState title="Sin datos para funnel" description="Ajusta filtros o valida seed demo en el tenant activo." />
                    ) : (
                        funnelRows.map((row) => {
                            const pct = total > 0 ? Math.round((row.value / total) * 100) : 0;
                            return (
                                <div key={row.key} className="space-y-1">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-muted-foreground">{row.label}</span>
                                        <span className="font-medium">{formatCount(row.value)} · {pct}%</span>
                                    </div>
                                    <div className="h-2 rounded bg-muted overflow-hidden">
                                        <div className="h-2 bg-blue-600" style={{ width: `${Math.max(4, pct)}%` }} />
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="border rounded-lg p-3 text-sm space-y-2">
                    <div className="font-medium">Alertas y señales</div>
                    {!!alerts.length && alerts.map((alert) => (
                        <div key={alert.key} className="rounded border p-2">
                            <div className={`font-medium ${alert.tone}`}>{alert.label}</div>
                            <div className="text-xs text-muted-foreground">{alert.detail}</div>
                        </div>
                    ))}
                    {!alerts.length ? (
                        <div className="rounded border p-2 text-emerald-700 bg-emerald-50 border-emerald-200">
                            Sin alertas críticas activas en este corte.
                        </div>
                    ) : null}
                    {primaryBottleneck ? (
                        <div className="rounded border p-2">
                            <div className="font-medium">Bottleneck principal</div>
                            <div className="text-xs text-muted-foreground">
                                {primaryBottleneck.label}: {formatCount(primaryBottleneck.value)} ({formatPct(primaryBottleneck.rate_pct)})
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b text-sm font-medium">Top campañas (lectura ejecutiva)</div>
                <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                        <tr>
                            <th className="text-left px-3 py-2">Campaña</th>
                            <th className="text-left px-3 py-2">Leads</th>
                            <th className="text-left px-3 py-2">Atención</th>
                            <th className="text-left px-3 py-2">Cierre</th>
                            <th className="text-left px-3 py-2">Riesgo (esc.+SLA)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!campaignTop.length ? (
                            <tr>
                                <td colSpan={5} className="px-3 py-6">
                                    <EmptyState title="Sin campañas para ranking" description="Ajusta filtros o valida seed demo en el tenant activo." />
                                </td>
                            </tr>
                        ) : campaignTop.map((row) => (
                            <tr key={row.campaign_id} className="border-t">
                                <td className="px-3 py-2">{row.campaign_name || row.campaign_id.slice(0, 8)}</td>
                                <td className="px-3 py-2">{formatCount(row.leads_total)}</td>
                                <td className="px-3 py-2">{formatPct(row.attended_rate_pct)}</td>
                                <td className="px-3 py-2 font-medium">{formatPct(row.conversion_rate_pct)}</td>
                                <td className="px-3 py-2">{formatCount(row.escalated + row.overdue)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="rounded-lg border p-3 text-xs text-muted-foreground">
                Continuidad: esta vista resume datos de Commercial Insights + Manager View para una narrativa ejecutiva,
                sin reemplazar el análisis táctico del equipo operativo.
            </div>
        </div>
    );
}
