"use client";

import React, { useEffect, useMemo, useState } from "react";

type Temp = "" | "caliente" | "tibio" | "frio";
type Priority = "" | "P1" | "P2" | "P3";
type WorkStatus = "" | "queued" | "assigned" | "in_progress" | "done";

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
    next_best_action: string | null;
    quality_flags: unknown[];
    spam_flags: unknown[];
    lead_score_reasons: string[];
    work_queue?: string | null;
    work_status?: "queued" | "assigned" | "in_progress" | "done" | null;
    work_assignee_user_id?: string | null;
    work_assignee_label?: string | null;
    work_assigned_at?: string | null;
};

type WowQueueResp = {
    items: WowItem[];
    total: number | null;
    limit: number;
    offset: number;
    debug?: { endpoint?: string };
};

type WowStatsResp = {
    total: number;
    calientes: number;
    tibios: number;
    frios: number;
    sla_vencido: number;
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

function isOverdue(iso: string | null | undefined) {
    if (!iso) return false;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    return d.getTime() < Date.now();
}

function useDebouncedValue<T>(value: T, ms = 350) {
    const [v, setV] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setV(value), ms);
        return () => clearTimeout(t);
    }, [value, ms]);
    return v;
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

const SHOW_HUMAN_CALL_ALWAYS = false;
const SHOW_IA_CALL_ALWAYS = false;

function shouldShowHumanCall(it: WowItem) {
    if (SHOW_HUMAN_CALL_ALWAYS) return true;
    const isP1 = (it.priority || "").toUpperCase() === "P1";
    return isP1 || isOverdue(it.sla_due_at) || (it.lead_temperature || "").toLowerCase() === "caliente";
}

function shouldShowIaCall(it: WowItem) {
    if (SHOW_IA_CALL_ALWAYS) return true;
    const t = (it.lead_temperature || "").toLowerCase();
    return t === "caliente" || t === "tibio";
}

export default function LeadsWowQueueClient() {
    const [campaignId, setCampaignId] = useState("");
    const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
    const [campaignsLoading, setCampaignsLoading] = useState(false);

    const [temperature, setTemperature] = useState<Temp>("");
    const [priority, setPriority] = useState<Priority>("");
    const [workStatus, setWorkStatus] = useState<WorkStatus>("");
    const [q, setQ] = useState("");
    const qDebounced = useDebouncedValue(q, 350);

    const [pageSize, setPageSize] = useState(50);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [items, setItems] = useState<WowItem[]>([]);
    const [total, setTotal] = useState<number>(0);

    const [stats, setStats] = useState<WowStatsResp>({ total: 0, calientes: 0, tibios: 0, frios: 0, sla_vencido: 0 });

    const [callingLeadId, setCallingLeadId] = useState<string | null>(null);
    const [callingMode, setCallingMode] = useState<null | "human" | "llm">(null);
    const [savingLeadId, setSavingLeadId] = useState<string | null>(null);

    const [token, setToken] = useState<string | null>(null);
    const [members, setMembers] = useState<MemberOption[]>([]);
    const [assigneeByLead, setAssigneeByLead] = useState<Record<string, string>>({});

    const page = useMemo(() => Math.floor(offset / Math.max(1, pageSize)) + 1, [offset, pageSize]);
    const totalPages = useMemo(() => Math.max(1, Math.ceil((total || 0) / Math.max(1, pageSize))), [total, pageSize]);

    const campaignsSorted = useMemo(() => {
        const arr = Array.isArray(campaigns) ? [...campaigns] : [];
        arr.sort((a, b) => campaignLabel(a).toLowerCase().localeCompare(campaignLabel(b).toLowerCase()));
        return arr;
    }, [campaigns]);

    useEffect(() => {
        let alive = true;
        (async () => {
            setCampaignsLoading(true);
            try {
                const r = await fetch("/api/aap/leads/wow-campaigns", { cache: "no-store" });
                const j = await r.json().catch(() => null);
                if (!alive) return;
                setCampaigns((Array.isArray(j) ? j : null) || (Array.isArray(j?.items) ? j.items : null) || []);
            } catch {
                if (!alive) return;
                setCampaigns([]);
            } finally {
                if (!alive) return;
                setCampaignsLoading(false);
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        setOffset(0);
    }, [campaignId, temperature, priority, workStatus, qDebounced, pageSize]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        for (let i = 0; i < window.localStorage.length; i += 1) {
            const key = window.localStorage.key(i) || "";
            if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
            const raw = window.localStorage.getItem(key);
            if (!raw) continue;
            try {
                const parsed = JSON.parse(raw);
                const access = parsed?.access_token || parsed?.currentSession?.access_token || null;
                if (access) {
                    setToken(String(access));
                    break;
                }
            } catch {
                // no-op
            }
        }
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
                q: qDebounced,
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

    async function fetchStats() {
        try {
            const p = new URLSearchParams();
            if (campaignId.trim()) p.set("campaign_id", campaignId.trim());
            const r = await fetch(`/api/aap/leads/wow-stats?${p.toString()}`, { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) return;
            setStats({
                total: Number(j.total || 0),
                calientes: Number(j.calientes || 0),
                tibios: Number(j.tibios || 0),
                frios: Number(j.frios || 0),
                sla_vencido: Number(j.sla_vencido || 0),
            });
        } catch {
            // no-op
        }
    }

    useEffect(() => {
        fetchQueue();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [offset, pageSize, campaignId, temperature, priority, workStatus, qDebounced]);

    useEffect(() => {
        fetchStats();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [campaignId]);

    async function mutateAssignment(args: { leadId: string; operation: "assign" | "release" | "set_status"; assignee_user_id?: string; work_status?: WorkStatus; }) {
        if (!token) {
            alert("❌ No se detectó sesión (Bearer token). Inicia sesión para asignar leads.");
            return;
        }
        try {
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
                work_queue: (item.work_queue as string | null) ?? it.work_queue ?? null,
                work_status: (item.work_status as WowItem["work_status"]) ?? it.work_status ?? null,
                work_assignee_user_id: (item.work_assignee_user_id as string | null) ?? null,
                work_assignee_label: (item.work_assignee_label as string | null) ?? null,
                work_assigned_at: (item.work_assigned_at as string | null) ?? null,
            } : it)));
        } catch (e: unknown) {
            alert(`❌ Error en assignment: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setSavingLeadId(null);
        }
    }

    function getN8nBase() {
        return process.env.NEXT_PUBLIC_N8N_BASE_URL || "https://elastica-n8n.3haody.easypanel.host";
    }

    async function startCallFromRow(it: WowItem, mode: "human" | "llm") {
        if (callingLeadId) return;
        const phone = (it.phone || "").trim();
        if (!phone) return alert("❌ Este lead no tiene teléfono.");

        const N8N_BASE = getN8nBase();
        const url = mode === "human" ? `${N8N_BASE}/webhook/api/calls/start-human` : `${N8N_BASE}/webhook/api/calls/start-llm`;
        try {
            setCallingLeadId(it.id);
            setCallingMode(mode);
            const r = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lead_id: it.id, phone, source: mode === "human" ? "demo-ui-wow-queue-human" : "demo-ui-wow-queue-llm", campaign: it.campaign || "", campaign_name: it.campaign || "", campaign_objective: "" }),
            });
            const rawText = await r.text();
            if (!r.ok) throw new Error(`${r.status} ${rawText}`);
            let data: Record<string, unknown> | null = null;
            try { data = rawText ? JSON.parse(rawText) : null; } catch { }
            const callObject = data && typeof data.call === "object" && data.call ? (data.call as Record<string, unknown>) : null;
            const callId = data?.call_id || data?.id || callObject?.id || null;
            if (callId) {
                window.location.href = `/call?id=${encodeURIComponent(String(callId || "").replace(/^=+/, "").trim())}`;
                return;
            }
            alert(`✅ Llamada ${mode === "human" ? "Humano" : "IA"} iniciada (sin call_id retornado).`);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            alert(`❌ Error iniciando llamada ${mode === "human" ? "humana" : "IA"}: ${message}`);
        } finally {
            setCallingLeadId(null);
            setCallingMode(null);
        }
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div>
                    <div className="text-xs text-muted-foreground mb-1">Campaña</div>
                    <select className="w-full border rounded-md px-3 py-2 text-sm" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={campaignsLoading}>
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
                    <div className="text-xs text-muted-foreground mb-1">Buscar (teléfono / form_id)</div>
                    <input className="w-full border rounded-md px-3 py-2 text-sm" placeholder="Ej: 9766. o form." value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">Total</div><div className="text-2xl font-semibold">{stats.total || total || 0}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">🔥 Calientes</div><div className="text-2xl font-semibold">{stats.calientes || 0}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">🟡 Tibios</div><div className="text-2xl font-semibold">{stats.tibios || 0}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">🧊 Fríos</div><div className="text-2xl font-semibold">{stats.frios || 0}</div></div>
                <div className="border rounded-lg p-3"><div className="text-xs text-muted-foreground">⏱️ SLA vencido</div><div className="text-2xl font-semibold">{stats.sla_vencido || 0}</div></div>
            </div>

            <div className="flex items-center justify-between gap-3">
                <div className="text-sm">Mostrando {items.length} de {total}{loading ? <span className="ml-2 text-muted-foreground">(cargando...)</span> : null}</div>
                <div className="flex items-center gap-2">
                    <select className="border rounded-md px-2 py-2 text-sm" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}><option value={25}>25/pág</option><option value={50}>50/pág</option><option value={100}>100/pág</option></select>
                    <button className="border rounded-md px-3 py-2 text-sm" onClick={() => fetchQueue()} disabled={loading}>Refrescar</button>
                </div>
            </div>

            {error ? <div className="border border-red-300 bg-red-50 text-red-800 rounded-md p-3 text-sm">{error}</div> : null}

            <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                        <tr className="text-left">
                            <th className="px-3 py-2">Lead</th><th className="px-3 py-2">Campaña</th><th className="px-3 py-2">Teléfono</th><th className="px-3 py-2">Temp</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">P</th><th className="px-3 py-2">SLA</th><th className="px-3 py-2">Ownership</th><th className="px-3 py-2">Next Best Action</th><th className="px-3 py-2">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 ? (
                            <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Sin resultados con esos filtros.</td></tr>
                        ) : items.map((it) => {
                            const rowCalling = callingLeadId === it.id;
                            const rowSaving = savingLeadId === it.id;
                            const hasPhone = !!(it.phone && it.phone.trim().length);
                            const canHuman = hasPhone && shouldShowHumanCall(it);
                            const canIA = hasPhone && shouldShowIaCall(it);
                            const selectedAssignee = assigneeByLead[it.id] ?? String(it.work_assignee_user_id || "");
                            return (
                                <tr key={it.id} className="border-t">
                                    <td className="px-3 py-2"><a className="underline" href={`/leads/wow/view?id=${encodeURIComponent(it.id)}`}>{it.id.slice(0, 8)}.</a><div className="text-xs text-muted-foreground">{formatDatePe(it.created_at)}</div></td>
                                    <td className="px-3 py-2"><div className="font-medium">{it.campaign || "-"}</div>{it.campaign_id ? <div className="text-xs text-muted-foreground">{it.campaign_id.slice(0, 8)}.</div> : null}</td>
                                    <td className="px-3 py-2"><div>{it.phone || "-"}</div><div className="text-xs text-muted-foreground">{it.phone_norm || "-"}</div></td>
                                    <td className="px-3 py-2"><span className="inline-flex items-center border rounded-full px-2 py-0.5 text-xs">{it.lead_temperature || "-"}</span></td>
                                    <td className="px-3 py-2 font-semibold">{it.lead_score ?? "-"}</td>
                                    <td className="px-3 py-2"><span className="inline-flex items-center border rounded-full px-2 py-0.5 text-xs">{it.priority || "-"}</span></td>
                                    <td className="px-3 py-2"><div>{formatDatePe(it.sla_due_at)}</div><div className={`text-xs ${isOverdue(it.sla_due_at) ? "text-red-600" : "text-muted-foreground"}`}>{isOverdue(it.sla_due_at) ? "Vencido" : "OK"}</div></td>
                                    <td className="px-3 py-2"><div className="text-xs"><span className="inline-flex items-center border rounded-full px-2 py-0.5">{it.work_status || "queued"}</span></div><div className="text-xs text-muted-foreground mt-1">{it.work_assignee_label || it.work_assignee_user_id || "Sin owner"}</div></td>
                                    <td className="px-3 py-2">{it.next_best_action || "-"}</td>
                                    <td className="px-3 py-2">
                                        <div className="flex flex-wrap gap-2">
                                            <a className="underline" href={`/leads/wow/view?id=${encodeURIComponent(it.id)}#wow-insights`}>Ver</a>
                                            {canHuman ? <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={rowCalling} onClick={() => startCallFromRow(it, "human")}>{rowCalling && callingMode === "human" ? "Llamando..." : "Llamar (Humano)"}</button> : null}
                                            {canIA ? <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={rowCalling} onClick={() => startCallFromRow(it, "llm")}>{rowCalling && callingMode === "llm" ? "Llamando..." : "Llamar (IA)"}</button> : null}

                                            <select className="border rounded-md px-2 py-1 text-xs" value={selectedAssignee} onChange={(e) => setAssigneeByLead((prev) => ({ ...prev, [it.id]: e.target.value }))} disabled={rowSaving}>
                                                <option value="">Seleccionar owner</option>
                                                {members.map((m) => <option key={m.user_id} value={m.user_id}>{(m.email || m.user_id) + (m.role ? ` · ${m.role}` : "")}</option>)}
                                            </select>
                                            <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={rowSaving || !selectedAssignee} onClick={() => mutateAssignment({ leadId: it.id, operation: "assign", assignee_user_id: selectedAssignee })}>{rowSaving ? "Guardando..." : "Asignar"}</button>
                                            <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={rowSaving} onClick={() => mutateAssignment({ leadId: it.id, operation: "release" })}>Liberar</button>
                                            <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={rowSaving} onClick={() => mutateAssignment({ leadId: it.id, operation: "set_status", work_status: "in_progress" })}>En curso</button>
                                            <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={rowSaving} onClick={() => mutateAssignment({ leadId: it.id, operation: "set_status", work_status: "done" })}>Cerrar</button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>

                <div className="flex items-center justify-between p-3 border-t">
                    <div className="text-xs text-muted-foreground">Página {page} de {totalPages}</div>
                    <div className="flex gap-2">
                        <button className="border rounded-md px-3 py-2 text-sm disabled:opacity-50" disabled={loading || offset <= 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Anterior</button>
                        <button className="border rounded-md px-3 py-2 text-sm disabled:opacity-50" disabled={loading || offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>Siguiente</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

