"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTenant } from "@/lib/tenant/use-tenant";

type WorkStatus = "" | "queued" | "assigned" | "in_progress" | "done";

type CampaignOption = {
    id: string;
    code: string | null;
    name: string | null;
};

type ManagerItem = {
    id: string;
    campaign: string | null;
    campaign_id: string | null;
    phone: string | null;
    created_at: string | null;
    priority: "P1" | "P2" | "P3" | null;
    work_status: "queued" | "assigned" | "in_progress" | "done" | null;
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

type ManagerResp = {
    kpis: {
        total: number;
        queued: number;
        assigned: number;
        in_progress: number;
        done: number;
        with_owner: number;
        unassigned: number;
        takeover_taken: number;
        takeover_released: number;
        takeover_closed: number;
        takeover_none: number;
        sla_due_soon: number;
        sla_overdue: number;
        sla_escalated: number;
    };
    alerts: {
        has_overdue: boolean;
        has_escalated: boolean;
        has_unassigned_load: boolean;
    };
    items: ManagerItem[];
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

function formatDatePe(iso: string | null | undefined) {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    return new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima",
        year: "2-digit",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(d);
}

function campaignLabel(c: CampaignOption) {
    const name = (c.name || "").trim();
    const code = (c.code || "").trim();
    if (name && code) return `${name} (${code})`;
    if (name) return name;
    if (code) return code;
    return c.id;
}

function isManagerRole(role: string | null | undefined) {
    const r = String(role || "").toLowerCase();
    return r === "superadmin" || r === "tenant_admin" || r === "supervisor";
}

export default function LeadsManagerPage() {
    const { context, loading: tenantLoading } = useTenant();

    const [token, setToken] = useState<string | null>(null);
    const [campaignId, setCampaignId] = useState("");
    const [workStatus, setWorkStatus] = useState<WorkStatus>("");
    const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resp, setResp] = useState<ManagerResp | null>(null);

    const canRead = isManagerRole(context?.role);

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

    async function fetchManagerView() {
        if (!token) return;
        setLoading(true);
        setError(null);
        try {
            const p = new URLSearchParams();
            if (campaignId.trim()) p.set("campaign_id", campaignId.trim());
            if (workStatus.trim()) p.set("work_status", workStatus.trim());
            p.set("limit", "40");

            const res = await fetch(`/api/aap/leads/manager-view?${p.toString()}`, {
                cache: "no-store",
                headers: { Authorization: `Bearer ${token}` },
            });
            const body = (await res.json().catch(() => ({}))) as ManagerResp & { error?: string };
            if (!res.ok) throw new Error(String(body?.error || `HTTP ${res.status}`));
            setResp(body);
        } catch (e: unknown) {
            setResp(null);
            setError(e instanceof Error ? e.message : "Error cargando manager view");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!token || !canRead) return;
        fetchManagerView();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, campaignId, workStatus, canRead]);

    const campaignsSorted = useMemo(() => {
        const arr = Array.isArray(campaigns) ? [...campaigns] : [];
        arr.sort((a, b) => campaignLabel(a).toLowerCase().localeCompare(campaignLabel(b).toLowerCase()));
        return arr;
    }, [campaigns]);

    const kpis = resp?.kpis;
    const items = Array.isArray(resp?.items) ? resp!.items : [];

    if (tenantLoading) {
        return <div className="p-6 text-sm text-muted-foreground">Cargando contexto tenant...</div>;
    }

    if (!canRead) {
        return (
            <div className="p-6 space-y-4">
                <h1 className="text-2xl font-semibold">Manager View (Reporting operativo)</h1>
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                    Acceso restringido. Esta vista requiere rol supervisor, tenant_admin o superadmin.
                </div>
                <div className="text-sm">
                    Puedes continuar operando desde <Link className="underline" href="/leads/desk">Human Desk</Link>.
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Manager View (Reporting operativo)</h1>
                    <p className="text-sm text-muted-foreground">
                        Supervisión operativa consolidada de cola, ownership, takeover y SLA.
                    </p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                    <Link className="underline" href="/leads/desk">Abrir Human Desk</Link>
                    <Link className="underline" href="/leads/wow">WOW Queue</Link>
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
                    <button className="border rounded-md px-3 py-2 text-sm" onClick={() => fetchManagerView()} disabled={loading || !token}>
                        {loading ? "Refrescando..." : "Refrescar"}
                    </button>
                </div>
            </div>

            {error ? <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Total</div><div className="text-xl font-semibold">{kpis?.total || 0}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Queued</div><div className="text-xl font-semibold">{kpis?.queued || 0}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">In progress</div><div className="text-xl font-semibold">{kpis?.in_progress || 0}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Sin owner</div><div className="text-xl font-semibold">{kpis?.unassigned || 0}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Takeover taken</div><div className="text-xl font-semibold">{kpis?.takeover_taken || 0}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">SLA due soon</div><div className="text-xl font-semibold">{kpis?.sla_due_soon || 0}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">SLA overdue</div><div className="text-xl font-semibold text-red-700">{kpis?.sla_overdue || 0}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Escalados</div><div className="text-xl font-semibold text-amber-700">{kpis?.sla_escalated || 0}</div></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="border rounded-lg p-3 text-sm">
                    <div className="font-medium mb-2">Distribución por estado</div>
                    <div className="space-y-1 text-muted-foreground">
                        <div>queued: <b className="text-foreground">{kpis?.queued || 0}</b></div>
                        <div>assigned: <b className="text-foreground">{kpis?.assigned || 0}</b></div>
                        <div>in_progress: <b className="text-foreground">{kpis?.in_progress || 0}</b></div>
                        <div>done: <b className="text-foreground">{kpis?.done || 0}</b></div>
                    </div>
                </div>
                <div className="border rounded-lg p-3 text-sm">
                    <div className="font-medium mb-2">Ownership / takeover</div>
                    <div className="space-y-1 text-muted-foreground">
                        <div>Con owner: <b className="text-foreground">{kpis?.with_owner || 0}</b></div>
                        <div>Sin owner: <b className="text-foreground">{kpis?.unassigned || 0}</b></div>
                        <div>takeover taken: <b className="text-foreground">{kpis?.takeover_taken || 0}</b></div>
                        <div>takeover released: <b className="text-foreground">{kpis?.takeover_released || 0}</b></div>
                    </div>
                </div>
                <div className="border rounded-lg p-3 text-sm">
                    <div className="font-medium mb-2">Alertas operativas</div>
                    <div className="space-y-1 text-muted-foreground">
                        <div>{resp?.alerts?.has_overdue ? "🔴" : "🟢"} SLA overdue</div>
                        <div>{resp?.alerts?.has_escalated ? "🟠" : "🟢"} Leads escalados</div>
                        <div>{resp?.alerts?.has_unassigned_load ? "🟡" : "🟢"} Carga sin owner</div>
                    </div>
                </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b text-sm font-medium">Leads operativos priorizados</div>
                <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                        <tr>
                            <th className="text-left px-3 py-2">Lead</th>
                            <th className="text-left px-3 py-2">Campaña</th>
                            <th className="text-left px-3 py-2">Estado</th>
                            <th className="text-left px-3 py-2">Owner/Takeover</th>
                            <th className="text-left px-3 py-2">SLA</th>
                            <th className="text-left px-3 py-2">NBA</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!items.length ? (
                            <tr><td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>Sin leads para los filtros actuales.</td></tr>
                        ) : items.map((it) => (
                            <tr key={it.id} className="border-t">
                                <td className="px-3 py-2">
                                    <Link className="underline" href={`/leads/wow/view?id=${encodeURIComponent(it.id)}`}>{it.id.slice(0, 8)}.</Link>
                                    <div className="text-xs text-muted-foreground">{it.phone || "-"} · {formatDatePe(it.created_at)}</div>
                                </td>
                                <td className="px-3 py-2">{it.campaign || "-"}</td>
                                <td className="px-3 py-2">
                                    <span className="inline-flex items-center border rounded-full px-2 py-0.5 text-xs mr-1">{it.work_status || "queued"}</span>
                                    <span className="inline-flex items-center border rounded-full px-2 py-0.5 text-xs">{it.priority || "-"}</span>
                                </td>
                                <td className="px-3 py-2">
                                    <div className="text-xs">{it.work_assignee_label || it.work_assignee_user_id || "Sin owner"}</div>
                                    <div className="text-xs text-muted-foreground">takeover:{it.human_takeover_status || "none"}</div>
                                </td>
                                <td className="px-3 py-2">
                                    <div>{formatDatePe(it.sla_due_at)}</div>
                                    <div className={`text-xs ${String(it.sla_status || "") === "overdue" ? "text-red-600" : String(it.sla_status || "") === "due_soon" ? "text-amber-600" : "text-muted-foreground"}`}>
                                        {it.sla_status || "no_sla"}
                                        {it.sla_is_escalated ? ` · escalado:${it.sla_escalation_level || "warning"}` : ""}
                                    </div>
                                </td>
                                <td className="px-3 py-2">{it.next_best_action || "-"}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

