"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTenant } from "@/lib/tenant/use-tenant";
import { resolveLeadPlaybook, type PlaybookActionId } from "@/lib/leads/playbooks";
import { EmptyState, ErrorState } from "@/components/ui/feedback-state";

type Temp = "" | "caliente" | "tibio" | "frio";
type Priority = "" | "P1" | "P2" | "P3";
type WorkStatus = "" | "queued" | "assigned" | "in_progress" | "done";
type HumanTakeoverStatus = "none" | "taken" | "released" | "closed";

type CampaignOption = {
    id: string;
    code: string | null;
    name: string | null;
};

type MemberOption = {
    user_id: string;
    email: string | null;
    role: string | null;
};

type TimelineItem = {
    id: string;
    event_type: string;
    event_at: string;
    actor_label: string | null;
    source: string;
    payload: Record<string, unknown> | null;
    derived?: boolean;
};

type WowItem = {
    id: string;
    campaign_id: string | null;
    campaign: string | null;
    form_id: string | null;
    created_at: string | null;
    phone: string | null;
    phone_norm: string | null;
    lead_score: number | null;
    lead_temperature: "caliente" | "tibio" | "frio" | null;
    priority: "P1" | "P2" | "P3" | null;
    sla_due_at: string | null;
    sla_status?: "no_sla" | "on_time" | "due_soon" | "overdue" | null;
    sla_is_escalated?: boolean | null;
    sla_escalation_level?: "none" | "warning" | "critical" | null;
    sla_runtime_due_in_minutes?: number | null;
    sla_runtime_overdue_minutes?: number | null;
    next_best_action: string | null;
    lead_score_reasons: string[];
    work_status?: "queued" | "assigned" | "in_progress" | "done" | null;
    work_assignee_user_id?: string | null;
    work_assignee_label?: string | null;
    work_assigned_at?: string | null;
    human_takeover_status?: HumanTakeoverStatus | null;
    human_takeover_by_user_id?: string | null;
    human_takeover_by_label?: string | null;
    human_takeover_at?: string | null;
    human_takeover_released_at?: string | null;
    human_takeover_closed_at?: string | null;
};

type WowQueueResp = {
    items: WowItem[];
    total: number | null;
    limit: number;
    offset: number;
};

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

function buildParams(args: {
    limit: number;
    offset: number;
    campaign_id?: string;
    temperature?: Temp;
    priority?: Priority;
    work_status?: WorkStatus;
    q?: string;
}) {
    const p = new URLSearchParams();
    p.set("limit", String(args.limit));
    p.set("offset", String(args.offset));

    const campaignId = (args.campaign_id || "").trim();
    const temperature = (args.temperature || "").trim().toLowerCase() as Temp;
    const priority = (args.priority || "").trim().toUpperCase() as Priority;
    const workStatus = (args.work_status || "").trim().toLowerCase() as WorkStatus;
    const q = (args.q || "").trim();

    if (campaignId) p.set("campaign_id", campaignId);
    if (temperature) p.set("temperature", temperature);
    if (priority) p.set("priority", priority);
    if (workStatus) p.set("work_status", workStatus);
    if (q) p.set("q", q);

    return p;
}

function campaignLabel(c: CampaignOption) {
    const name = (c.name || "").trim();
    const code = (c.code || "").trim();
    if (name && code) return `${name} (${code})`;
    if (name) return name;
    if (code) return code;
    return c.id;
}

function roleCanUpdateLeads(role: string | null | undefined) {
    const r = String(role || "").toLowerCase();
    return r === "superadmin" || r === "tenant_admin" || r === "supervisor";
}

export default function LeadsDeskPage() {
    const { context } = useTenant();

    const [campaignId, setCampaignId] = useState("");
    const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
    const [temperature, setTemperature] = useState<Temp>("");
    const [priority, setPriority] = useState<Priority>("");
    const [workStatus, setWorkStatus] = useState<WorkStatus>("");
    const [onlyEscalated, setOnlyEscalated] = useState(false);
    const [onlyOverdue, setOnlyOverdue] = useState(false);
    const [q, setQ] = useState("");

    const [pageSize, setPageSize] = useState(25);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [items, setItems] = useState<WowItem[]>([]);
    const [total, setTotal] = useState<number>(0);

    const [token, setToken] = useState<string | null>(null);
    const [members, setMembers] = useState<MemberOption[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [assigneeByLead, setAssigneeByLead] = useState<Record<string, string>>({});
    const [savingLeadId, setSavingLeadId] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    const [timelineLoading, setTimelineLoading] = useState(false);
    const [timelineError, setTimelineError] = useState<string | null>(null);
    const [timeline, setTimeline] = useState<TimelineItem[]>([]);

    const canUpdateLeads = roleCanUpdateLeads(context?.role);

    const filteredItems = useMemo(() => {
        return (items || []).filter((it) => {
            if (onlyEscalated && !it.sla_is_escalated) return false;
            if (onlyOverdue && String(it.sla_status || "") !== "overdue") return false;
            return true;
        });
    }, [items, onlyEscalated, onlyOverdue]);

    const selectedLead = useMemo(() => {
        return filteredItems.find((it) => it.id === selectedId) || filteredItems[0] || null;
    }, [filteredItems, selectedId]);

    useEffect(() => {
        setToken(readAccessTokenFromStorage());
    }, []);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const r = await fetch("/api/aap/leads/wow-campaigns", { cache: "no-store" });
                const j = await r.json().catch(() => null);
                if (!alive) return;
                setCampaigns((Array.isArray(j?.items) ? j.items : []) as CampaignOption[]);
            } catch {
                if (!alive) return;
                setCampaigns([]);
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        if (!token) return;
        let alive = true;
        (async () => {
            try {
                const res = await fetch("/api/tenant/members", {
                    cache: "no-store",
                    headers: { Authorization: `Bearer ${token}` },
                });
                const body = await res.json().catch(() => ({}));
                if (!alive) return;
                setMembers(res.ok && Array.isArray(body?.items) ? body.items : []);
            } catch {
                if (!alive) return;
                setMembers([]);
            }
        })();
        return () => {
            alive = false;
        };
    }, [token]);

    async function fetchQueue() {
        setLoading(true);
        setError(null);
        try {
            const params = buildParams({
                limit: pageSize,
                offset,
                campaign_id: campaignId,
                temperature,
                priority,
                work_status: workStatus,
                q,
            });
            const r = await fetch(`/api/aap/leads/wow-queue?${params.toString()}`, { cache: "no-store" });
            const j = (await r.json()) as WowQueueResp;
            const maybeError = j && typeof j === "object" && "error" in (j as Record<string, unknown>)
                ? String((j as Record<string, unknown>).error || "")
                : "";
            if (!r.ok) throw new Error(maybeError || "Error cargando cola");

            const rows = Array.isArray(j.items) ? j.items : [];
            setItems(rows);
            setTotal(typeof j.total === "number" ? j.total : 0);

            if (rows.length && !selectedId) {
                setSelectedId(rows[0].id);
            }

            const defaults: Record<string, string> = {};
            rows.forEach((it) => {
                defaults[it.id] = String(it.work_assignee_user_id || "");
            });
            setAssigneeByLead((prev) => ({ ...defaults, ...prev }));
        } catch (e: unknown) {
            setItems([]);
            setTotal(0);
            setError(e instanceof Error ? e.message : "Error inesperado");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        fetchQueue();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [offset, pageSize, campaignId, temperature, priority, workStatus, q]);

    useEffect(() => {
        const leadId = selectedLead?.id;
        if (!leadId || !token) {
            setTimeline([]);
            return;
        }

        let alive = true;
        (async () => {
            setTimelineLoading(true);
            setTimelineError(null);
            try {
                const res = await fetch(`/api/aap/leads/${encodeURIComponent(leadId)}/timeline?limit=60`, {
                    cache: "no-store",
                    headers: { Authorization: `Bearer ${token}` },
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(String(body?.error || `Timeline error ${res.status}`));
                if (!alive) return;
                setTimeline(Array.isArray(body?.items) ? body.items : []);
            } catch (e: unknown) {
                if (!alive) return;
                setTimeline([]);
                setTimelineError(e instanceof Error ? e.message : "Error timeline");
            } finally {
                if (!alive) return;
                setTimelineLoading(false);
            }
        })();

        return () => {
            alive = false;
        };
    }, [selectedLead?.id, token]);

    async function mutateAssignment(args: { leadId: string; operation: "assign" | "release" | "set_status" | "takeover_take" | "takeover_release" | "takeover_close"; assignee_user_id?: string; work_status?: WorkStatus; }) {
        if (!canUpdateLeads) {
            setActionError("Tu rol actual no tiene permisos para modificar ownership/takeover o estado del lead.");
            return;
        }

        if (!token) {
            setActionError("No se detectó sesión (Bearer token). Inicia sesión para operar leads.");
            return;
        }

        try {
            setActionError(null);
            setSavingLeadId(args.leadId);
            const res = await fetch("/api/aap/leads/work-queue/assign", {
                method: "POST",
                cache: "no-store",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    lead_id: args.leadId,
                    operation: args.operation,
                    assignee_user_id: args.assignee_user_id,
                    work_status: args.work_status,
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);

            const item = body?.item || null;
            if (!item) return;

            setItems((prev) => prev.map((it) => (it.id === args.leadId ? {
                ...it,
                work_status: (item.work_status as WowItem["work_status"]) ?? it.work_status ?? null,
                priority: (item.priority as WowItem["priority"]) ?? it.priority ?? null,
                sla_due_at: (item.sla_due_at as string | null) ?? it.sla_due_at ?? null,
                sla_status: (item.sla_status as WowItem["sla_status"]) ?? it.sla_status ?? null,
                sla_is_escalated: (item.sla_is_escalated as boolean | null) ?? it.sla_is_escalated ?? null,
                sla_escalation_level: (item.sla_escalation_level as WowItem["sla_escalation_level"]) ?? it.sla_escalation_level ?? null,
                work_assignee_user_id: (item.work_assignee_user_id as string | null) ?? null,
                work_assignee_label: (item.work_assignee_label as string | null) ?? null,
                work_assigned_at: (item.work_assigned_at as string | null) ?? null,
                human_takeover_status: (item.human_takeover_status as WowItem["human_takeover_status"]) ?? "none",
                human_takeover_by_user_id: (item.human_takeover_by_user_id as string | null) ?? null,
                human_takeover_by_label: (item.human_takeover_by_label as string | null) ?? null,
                human_takeover_at: (item.human_takeover_at as string | null) ?? null,
                human_takeover_released_at: (item.human_takeover_released_at as string | null) ?? null,
                human_takeover_closed_at: (item.human_takeover_closed_at as string | null) ?? null,
            } : it)));
        } catch (e: unknown) {
            setActionError(e instanceof Error ? e.message : String(e));
        } finally {
            setSavingLeadId(null);
        }
    }

    const campaignsSorted = useMemo(() => {
        const arr = Array.isArray(campaigns) ? [...campaigns] : [];
        arr.sort((a, b) => campaignLabel(a).toLowerCase().localeCompare(campaignLabel(b).toLowerCase()));
        return arr;
    }, [campaigns]);

    const selectedAssignee = selectedLead ? (assigneeByLead[selectedLead.id] ?? String(selectedLead.work_assignee_user_id || "")) : "";
    const takeoverStatus = String(selectedLead?.human_takeover_status || "none").toLowerCase();
    const rowSaving = selectedLead ? savingLeadId === selectedLead.id : false;
    const selectedPlaybook = useMemo(() => {
        if (!selectedLead) return null;
        return resolveLeadPlaybook({
            next_best_action: selectedLead.next_best_action,
            priority: selectedLead.priority,
            sla_status: selectedLead.sla_status,
            sla_is_escalated: selectedLead.sla_is_escalated,
            sla_escalation_level: selectedLead.sla_escalation_level,
            work_status: selectedLead.work_status,
            human_takeover_status: selectedLead.human_takeover_status,
            lead_temperature: selectedLead.lead_temperature,
            work_assignee_user_id: selectedLead.work_assignee_user_id,
            work_assignee_label: selectedLead.work_assignee_label,
        });
    }, [selectedLead]);

    async function runPlaybookAction(actionId: PlaybookActionId) {
        if (!selectedLead) return;
        if (actionId === "open_timeline") {
            document.getElementById("desk-lead-timeline")?.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }
        if (actionId === "open_detail") {
            window.location.href = `/leads/wow/view?id=${encodeURIComponent(selectedLead.id)}#wow-insights`;
            return;
        }

        if (!canUpdateLeads) return;

        if (actionId === "assign_owner") {
            if (!selectedAssignee) {
                setActionError("Selecciona primero un owner para aplicar la recomendación.");
                return;
            }
            await mutateAssignment({ leadId: selectedLead.id, operation: "assign", assignee_user_id: selectedAssignee });
            return;
        }

        if (actionId === "set_in_progress") {
            await mutateAssignment({ leadId: selectedLead.id, operation: "set_status", work_status: "in_progress" });
            return;
        }

        if (actionId === "set_done") {
            await mutateAssignment({ leadId: selectedLead.id, operation: "set_status", work_status: "done" });
            return;
        }

        if (actionId === "takeover_take") {
            await mutateAssignment({ leadId: selectedLead.id, operation: "takeover_take" });
            return;
        }

        if (actionId === "takeover_release") {
            await mutateAssignment({ leadId: selectedLead.id, operation: "takeover_release" });
            return;
        }

        if (actionId === "takeover_close") {
            await mutateAssignment({ leadId: selectedLead.id, operation: "takeover_close" });
        }
    }

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Lead Operations Workspace (Human Desk)</h1>
                    <p className="text-sm text-muted-foreground">
                        Cola operativa unificada con detalle lateral, acciones rápidas y timeline.
                    </p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                    <Link className="underline" href="/leads/wow">WOW Queue clásica</Link>
                    <Link className="underline" href="/leads">Listado crudo</Link>
                </div>
            </div>

            {!canUpdateLeads ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                    Perfil actual con alcance limitado: puedes visualizar, pero acciones de assignment/estado pueden estar restringidas por rol.
                </div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
                <div>
                    <div className="text-xs text-muted-foreground mb-1">Campaña</div>
                    <select className="w-full border rounded-md px-3 py-2 text-sm" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                        <option value="">Todas</option>
                        {campaignsSorted.map((c) => <option key={c.id} value={c.id}>{campaignLabel(c)}</option>)}
                    </select>
                </div>
                <div>
                    <div className="text-xs text-muted-foreground mb-1">Temperatura</div>
                    <select className="w-full border rounded-md px-3 py-2 text-sm" value={temperature} onChange={(e) => setTemperature((e.target.value || "") as Temp)}>
                        <option value="">Todas</option><option value="caliente">Caliente</option><option value="tibio">Tibio</option><option value="frio">Frío</option>
                    </select>
                </div>
                <div>
                    <div className="text-xs text-muted-foreground mb-1">Prioridad</div>
                    <select className="w-full border rounded-md px-3 py-2 text-sm" value={priority} onChange={(e) => setPriority((e.target.value || "") as Priority)}>
                        <option value="">Todas</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option>
                    </select>
                </div>
                <div>
                    <div className="text-xs text-muted-foreground mb-1">Estado trabajo</div>
                    <select className="w-full border rounded-md px-3 py-2 text-sm" value={workStatus} onChange={(e) => setWorkStatus((e.target.value || "") as WorkStatus)}>
                        <option value="">Todos</option><option value="queued">queued</option><option value="assigned">assigned</option><option value="in_progress">in_progress</option><option value="done">done</option>
                    </select>
                </div>
                <div>
                    <div className="text-xs text-muted-foreground mb-1">Búsqueda</div>
                    <input className="w-full border rounded-md px-3 py-2 text-sm" placeholder="teléfono / form_id" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={onlyEscalated} onChange={(e) => setOnlyEscalated(e.target.checked)} />
                    Solo escalados
                </label>
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
                    Solo SLA vencido
                </label>
            </div>

            <div className="flex items-center justify-between text-sm">
                <div>
                    {loading ? "Cargando..." : `Mostrando ${filteredItems.length} de ${total} leads`}
                </div>
                <div className="flex items-center gap-2">
                    <select className="border rounded-md px-2 py-2 text-sm" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}><option value={25}>25/pág</option><option value={50}>50/pág</option><option value={100}>100/pág</option></select>
                    <button className="border rounded-md px-3 py-2 text-sm" onClick={() => fetchQueue()} disabled={loading}>Refrescar</button>
                </div>
            </div>

            {error ? (
                <ErrorState
                    title="No pudimos cargar la cola operativa"
                    description={`Puedes reintentar la carga. Detalle técnico: ${error}`}
                    className="p-3"
                />
            ) : null}

            {actionError ? (
                <ErrorState
                    title="No pudimos completar la acción"
                    description={actionError}
                    className="p-3"
                />
            ) : null}

            <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-4">
                <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                            <tr>
                                <th className="text-left px-3 py-2">Lead</th>
                                <th className="text-left px-3 py-2">Campaña</th>
                                <th className="text-left px-3 py-2">P</th>
                                <th className="text-left px-3 py-2">SLA</th>
                                <th className="text-left px-3 py-2">Owner</th>
                                <th className="text-left px-3 py-2">Takeover</th>
                            </tr>
                        </thead>
                        <tbody>
                            {!filteredItems.length ? (
                                <tr>
                                    <td className="px-3 py-6" colSpan={6}>
                                        <EmptyState
                                            title="No hay leads para los filtros seleccionados"
                                            description="Prueba quitar filtros o ampliar el rango para continuar con la operación."
                                        />
                                    </td>
                                </tr>
                            ) : filteredItems.map((it) => {
                                const isActive = selectedLead?.id === it.id;
                                const slaStatus = String(it.sla_status || "").toLowerCase();
                                return (
                                    <tr key={it.id} className={`border-t cursor-pointer ${isActive ? "bg-muted/40" : ""}`} onClick={() => setSelectedId(it.id)}>
                                        <td className="px-3 py-2">
                                            <div className="font-medium">{it.phone || "-"}</div>
                                            <div className="text-xs text-muted-foreground">{it.id.slice(0, 8)} · {formatDatePe(it.created_at)}</div>
                                        </td>
                                        <td className="px-3 py-2">{it.campaign || "-"}</td>
                                        <td className="px-3 py-2"><span className="inline-flex items-center border rounded-full px-2 py-0.5 text-xs">{it.priority || "-"}</span></td>
                                        <td className="px-3 py-2">
                                            <div>{formatDatePe(it.sla_due_at)}</div>
                                            <div className={`text-xs ${slaStatus === "overdue" ? "text-red-600" : slaStatus === "due_soon" ? "text-amber-600" : "text-muted-foreground"}`}>
                                                {slaStatus || "no_sla"}
                                                {it.sla_is_escalated ? ` · escalado:${it.sla_escalation_level || "warning"}` : ""}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-xs">{it.work_assignee_label || it.work_assignee_user_id || "Sin owner"}</td>
                                        <td className="px-3 py-2"><span className="inline-flex items-center border rounded-full px-2 py-0.5 text-xs">{it.human_takeover_status || "none"}</span></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="border rounded-lg p-4 space-y-4">
                    {!selectedLead ? (
                        <EmptyState
                            title="Selecciona un lead para comenzar"
                            description="Desde la tabla izquierda podrás abrir contexto, timeline y acciones rápidas."
                        />
                    ) : (
                        <>
                            <div>
                                <div className="text-xs text-muted-foreground">Lead</div>
                                <div className="text-lg font-semibold">{selectedLead.phone || "-"}</div>
                                <div className="text-xs text-muted-foreground">{selectedLead.id}</div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div><b>Campaña:</b> {selectedLead.campaign || "-"}</div>
                                <div><b>Form:</b> {selectedLead.form_id || "-"}</div>
                                <div><b>Temperatura:</b> {selectedLead.lead_temperature || "-"}</div>
                                <div><b>Score:</b> {selectedLead.lead_score ?? "-"}</div>
                                <div><b>Prioridad:</b> {selectedLead.priority || "-"}</div>
                                <div><b>Estado:</b> {selectedLead.work_status || "queued"}</div>
                                <div><b>SLA:</b> {formatDatePe(selectedLead.sla_due_at)}</div>
                                <div><b>Takeover:</b> {takeoverStatus}</div>
                            </div>

                            <div className="rounded-md border p-3 space-y-2">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <div className="text-xs text-muted-foreground">Playbook / Next Best Action</div>
                                        <div className="text-sm font-semibold">{selectedPlaybook?.title || "Sin recomendación"}</div>
                                    </div>
                                    <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-xs ${selectedPlaybook?.severity === "critical" ? "border-red-300 text-red-700" : selectedPlaybook?.severity === "warning" ? "border-amber-300 text-amber-700" : "border-slate-300 text-slate-700"}`}>
                                        {selectedPlaybook?.severity || "info"}
                                    </span>
                                </div>

                                <div className="text-xs text-muted-foreground">{selectedPlaybook?.summary || "-"}</div>

                                <div className="text-sm rounded-md bg-muted/40 p-2">
                                    <b>NBA persistida:</b> {selectedLead.next_best_action || "-"}
                                </div>

                                {selectedPlaybook?.actions?.length ? (
                                    <div className="flex flex-wrap gap-2">
                                        {selectedPlaybook.actions.map((action) => {
                                            const isMutating = action.id !== "open_timeline" && action.id !== "open_detail";
                                            return (
                                                <button
                                                    key={action.id}
                                                    className="border rounded-md px-2 py-1 text-xs disabled:opacity-50"
                                                    disabled={rowSaving || (isMutating && !canUpdateLeads)}
                                                    onClick={() => runPlaybookAction(action.id)}
                                                >
                                                    {action.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : null}
                            </div>

                            <div className="space-y-2">
                                <div className="text-sm font-medium">Acciones rápidas</div>
                                <div className="flex flex-wrap gap-2">
                                    <select className="border rounded-md px-2 py-1 text-xs" value={selectedAssignee} onChange={(e) => setAssigneeByLead((prev) => ({ ...prev, [selectedLead.id]: e.target.value }))}>
                                        <option value="">Seleccionar owner</option>
                                        {members.map((m) => <option key={m.user_id} value={m.user_id}>{(m.email || m.user_id) + (m.role ? ` · ${m.role}` : "")}</option>)}
                                    </select>
                                    <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={!canUpdateLeads || rowSaving || !selectedAssignee} onClick={() => mutateAssignment({ leadId: selectedLead.id, operation: "assign", assignee_user_id: selectedAssignee })}>Asignar</button>
                                    <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={!canUpdateLeads || rowSaving} onClick={() => mutateAssignment({ leadId: selectedLead.id, operation: "release" })}>Liberar</button>
                                    <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={!canUpdateLeads || rowSaving} onClick={() => mutateAssignment({ leadId: selectedLead.id, operation: "set_status", work_status: "in_progress" })}>En curso</button>
                                    <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={!canUpdateLeads || rowSaving} onClick={() => mutateAssignment({ leadId: selectedLead.id, operation: "set_status", work_status: "done" })}>Cerrar</button>
                                    <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={!canUpdateLeads || rowSaving || takeoverStatus === "taken" || takeoverStatus === "closed"} onClick={() => mutateAssignment({ leadId: selectedLead.id, operation: "takeover_take" })}>Tomar lead</button>
                                    <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={!canUpdateLeads || rowSaving || takeoverStatus !== "taken"} onClick={() => mutateAssignment({ leadId: selectedLead.id, operation: "takeover_release" })}>Soltar takeover</button>
                                    <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={!canUpdateLeads || rowSaving || takeoverStatus === "closed"} onClick={() => mutateAssignment({ leadId: selectedLead.id, operation: "takeover_close" })}>Cerrar takeover</button>
                                </div>
                            </div>

                            <div className="space-y-2" id="desk-lead-timeline">
                                <div className="text-sm font-medium">Timeline</div>
                                {timelineLoading ? <div className="text-sm text-muted-foreground">Cargando timeline...</div> : null}
                                {timelineError ? <div className="text-sm text-red-600">{timelineError}</div> : null}
                                {!timelineLoading && !timelineError && !timeline.length ? <div className="text-sm text-muted-foreground">Sin eventos.</div> : null}
                                <div className="max-h-72 overflow-auto space-y-2">
                                    {timeline.map((ev) => (
                                        <div key={ev.id} className="rounded-md border p-2">
                                            <div className="text-xs font-medium">{ev.event_type}</div>
                                            <div className="text-[11px] text-muted-foreground">{formatDatePe(ev.event_at)} · {ev.actor_label || "system"} · {ev.source}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-2 border-t text-xs">
                                <div className="flex gap-3 flex-wrap">
                                    <Link className="underline" href={`/leads/wow/view?id=${encodeURIComponent(selectedLead.id)}#wow-insights`}>
                                        Abrir detalle completo
                                    </Link>
                                    <Link className="underline" href={`/leads/workspace?leadId=${encodeURIComponent(selectedLead.id)}`}>
                                        Abrir Omnichannel Workspace
                                    </Link>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Offset: {offset} · Total: {total}</div>
                <div className="flex gap-2">
                    <button className="border rounded-md px-3 py-2 text-sm disabled:opacity-50" disabled={loading || offset <= 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Anterior</button>
                    <button className="border rounded-md px-3 py-2 text-sm disabled:opacity-50" disabled={loading || offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>Siguiente</button>
                </div>
            </div>
        </div>
    );
}

