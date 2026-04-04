"use client";

import { useEffect, useMemo, useState } from "react";
import { sbFetch } from "@/lib/supabaseRest";
import { useTenant } from "@/lib/tenant/use-tenant";
import Link from "next/link";

type CallRow = {
    id: string;
    lead_id: string;
    phone: string | null;
    mode: string | null;

    handoff_reason: string | null;
    handoff_at: string | null;

    assigned_channel: string | null;
    assigned_to: string | null; // chat_id telegram

    human_status: string | null;
    human_taken_by: string | null;
    human_taken_at: string | null;
    human_closed_at: string | null;

    human_last_message_text?: string | null;
    human_last_message_at?: string | null;

    // ✅ métricas
    human_first_response_at?: string | null;
    human_response_count?: number | null;

    metadata: any; // jsonb
    updated_at: string;
};

function getLlm(row: CallRow) {
    return row?.metadata?.llm ?? {};
}

/** =======================
 *  PRIORIDAD (metadata jsonb)
 *  ======================= */
const SLA_ALERT_MIN = 5;
const OPEN_ALERT_MIN = 15;
const SLA_PENDING_MIN = 5; // pending: SLA vencido si handoff_at > 5 min
const SLA_OPEN_MIN = 15; // in_progress: atención vencida si human_taken_at > 15 min

/** =======================
 *  NEW/SEEN por asesor (metadata jsonb)
 *  ======================= */
function getLastSeenAt(row: any, advisor: string): string | null {
    const v = row?.metadata?.human?.last_seen_at?.[advisor];
    return typeof v === "string" && v.trim() ? v : null;
}

function setLastSeenInMetadata(meta: any, advisor: string, tsIso: string) {
    const base = meta && typeof meta === "object" ? meta : {};
    const human = base.human && typeof base.human === "object" ? base.human : {};
    const lastSeen =
        human.last_seen_at && typeof human.last_seen_at === "object"
            ? human.last_seen_at
            : {};
    return {
        ...base,
        human: {
            ...human,
            last_seen_at: {
                ...lastSeen,
                [advisor]: tsIso,
            },
        },
    };
}

function isNewForAdvisor(row: any, advisor: string) {
    const st = (row?.human_status || "pending").trim();
    if (st !== "in_progress") return false;

    const lastMsg = row?.human_last_message_at
        ? new Date(row.human_last_message_at).getTime()
        : NaN;
    if (!isFinite(lastMsg)) return false;

    // Solo consideramos “nuevo” si el mensaje llegó DESPUÉS de tomar
    const takenAt = row?.human_taken_at ? new Date(row.human_taken_at).getTime() : NaN;
    if (isFinite(takenAt) && lastMsg <= takenAt) return false;

    const seen = getLastSeenAt(row, advisor);
    if (!seen) return true;

    const seenT = new Date(seen).getTime();
    if (!isFinite(seenT)) return true;

    return lastMsg > seenT;
}

function getPriority(row: CallRow) {
    return Boolean(row?.metadata?.human?.priority);
}

function setPriorityInMetadata(meta: any, priority: boolean) {
    const base = meta && typeof meta === "object" ? meta : {};
    return {
        ...base,
        human: {
            ...(base.human ?? {}),
            priority,
            priority_at: priority ? new Date().toISOString() : null,
        },
    };
}

/** =======================
 *  Webhooks
 *  ======================= */
const TAKE_WEBHOOK_URL =
    process.env.NEXT_PUBLIC_N8N_TAKE_WEBHOOK ||
    "https://elastica-n8n.3haody.easypanel.host/webhook/notify-take";

const CLOSE_WEBHOOK_URL =
    process.env.NEXT_PUBLIC_N8N_CLOSE_WEBHOOK ||
    "https://elastica-n8n.3haody.easypanel.host/webhook/notify-close";

const PING_WEBHOOK_URL =
    process.env.NEXT_PUBLIC_N8N_PING_WEBHOOK ||
    "https://elastica-n8n.3haody.easypanel.host/webhook/notify-ping";

const appBaseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL || "http://localhost:3001/";

function getApiKeyOrWarn() {
    const apiKey = process.env.NEXT_PUBLIC_API_KEY || "";
    if (!apiKey) {
        console.warn("NEXT_PUBLIC_API_KEY no está definido; no se puede autenticar el webhook.");
    }
    return apiKey;
}

async function notifyTakeToTelegram(row: CallRow, takenBy: string) {
    if (!row.assigned_to) return;

    const apiKey = getApiKeyOrWarn();
    if (!apiKey) return;

    const res = await fetch(TAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
            call_id: row.id,
            lead_id: row.lead_id,
            phone: row.phone,
            taken_by: takenBy,
            assignee_chat_id: row.assigned_to,
            app_base_url: appBaseUrl,
        }),
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Webhook error ${res.status}: ${txt}`.trim());
    }
}

async function notifyCloseToTelegram(row: CallRow, closedBy: string) {
    if (!row.assigned_to) return;

    const apiKey = getApiKeyOrWarn();
    if (!apiKey) return;

    const res = await fetch(CLOSE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
            call_id: row.id,
            lead_id: row.lead_id,
            phone: row.phone,
            closed_by: closedBy,
            assignee_chat_id: row.assigned_to,
            app_base_url: appBaseUrl,
        }),
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Webhook error ${res.status}: ${txt}`.trim());
    }
}

async function notifyPingToTelegram(row: CallRow, pingBy: string, pingReason: string) {
    if (!row.assigned_to) return;

    const apiKey = getApiKeyOrWarn();
    if (!apiKey) return;

    const res = await fetch(PING_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
            call_id: row.id,
            lead_id: row.lead_id,
            phone: row.phone,
            assignee_chat_id: row.assigned_to,
            ping_by: pingBy,
            ping_reason: pingReason,
            app_base_url: appBaseUrl,
        }),
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Ping webhook error ${res.status}: ${txt}`.trim());
    }
}

/** =======================
 *  Sorting / Flags
 *  ======================= */
function statusRank(s: string) {
    if (s === "pending") return 0;
    if (s === "in_progress") return 1;
    if (s === "closed") return 2;
    return 9;
}

// ✅ Métricas
function minsBetween(a?: string | null, b?: string | null) {
    if (!a || !b) return null;
    const da = new Date(a).getTime();
    const db = new Date(b).getTime();
    if (!isFinite(da) || !isFinite(db)) return null;
    const diffSec = Math.max(0, Math.floor((da - db) / 1000));
    return Math.round(diffSec / 60);
}

function startOfTodayLocal() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function isTodayLocal(ts?: string | null) {
    if (!ts) return false;
    const t = new Date(ts).getTime();
    if (!isFinite(t)) return false;
    return t >= startOfTodayLocal();
}

function minsSince(a?: string | null) {
    if (!a) return null;
    const da = new Date(a).getTime();
    const now = Date.now();
    if (!isFinite(da)) return null;
    const diffSec = Math.max(0, Math.floor((now - da) / 1000));
    return Math.round(diffSec / 60);
}

function fmtMins(m: number | null) {
    if (m === null) return "—";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m`;
}

export default function HandoffsPage() {
    const { context, loading: tenantLoading } = useTenant();
    const tenantId = context?.tenantId || undefined;
    const [rows, setRows] = useState<CallRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [flashIds, setFlashIds] = useState<Record<string, number>>({});

    const [statusFilter, setStatusFilter] = useState<"pending" | "in_progress" | "closed" | "all">(
        "pending"
    );
    const [onlyWithActivity, setOnlyWithActivity] = useState(false);
    const [onlyPriority, setOnlyPriority] = useState(false);
    const [onlyClosedToday, setOnlyClosedToday] = useState(false);
    const [onlySlaBreached, setOnlySlaBreached] = useState(false);
    const [onlyOpenBreached, setOnlyOpenBreached] = useState(false);

    const ADVISORS = ["asesor_demo", "Ramiro", "Carla"] as const;

    const [activeAdvisor, setActiveAdvisor] = useState<string>(() => {
        if (typeof window === "undefined") return "asesor_demo";
        return localStorage.getItem("activeAdvisor") || "asesor_demo";
    });

    const [onlyMine, setOnlyMine] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        localStorage.setItem("activeAdvisor", activeAdvisor);
    }, [activeAdvisor]);

    async function load() {
        setLoading(true);
        setError(null);

        try {
            const data = await sbFetch<CallRow[]>("/rest/v1/calls", {
                tenantId,
                query: {
                    select:
                        "id,lead_id,phone,mode,handoff_reason,handoff_at,assigned_channel,assigned_to,human_status,human_taken_by,human_taken_at,human_closed_at,human_last_message_text,human_last_message_at,human_first_response_at,human_response_count,metadata,updated_at",
                    mode: "eq.human",
                    handoff_at: "not.is.null",
                    order: "handoff_at.desc",
                    limit: 50,
                },
            });

            setRows(data || []);
        } catch (e: any) {
            setError(e?.message || "Error cargando handoffs");
        } finally {
            setLoading(false);
        }
    }

    async function take(row: CallRow) {
        const takenBy = activeAdvisor;

        const status = (row.human_status || "pending").trim();
        if (status !== "pending") return;

        // ✅ al tomar: mostrar “Mis casos” y cambiar estado a En atención
        setOnlyMine(true);
        setStatusFilter("in_progress");

        // ✅ BONUS: marcar visto inicial para evitar “Nuevo” inmediato tras tomar
        const initialSeen = row.human_last_message_at || new Date().toISOString();
        const nextMeta = setLastSeenInMetadata(row.metadata, activeAdvisor, initialSeen);

        try {
            await sbFetch("/rest/v1/calls?id=eq." + encodeURIComponent(row.id), {
                method: "PATCH",
                tenantId,
                body: {
                    human_status: "in_progress",
                    human_taken_by: takenBy,
                    human_taken_at: new Date().toISOString(),
                    metadata: nextMeta,
                },
            });

            try {
                await notifyTakeToTelegram(row, takenBy);
            } catch (err: any) {
                console.warn("No se pudo notificar a Telegram (take):", err?.message || err);
            }

            await load();
        } catch (e: any) {
            alert(e?.message || "Error tomando caso");
        }
    }

    async function close(row: CallRow) {
        const closedBy = activeAdvisor;

        const status = (row.human_status || "pending").trim();
        if (status === "closed") return;

        try {
            await sbFetch("/rest/v1/calls?id=eq." + encodeURIComponent(row.id), {
                method: "PATCH",
                tenantId,
                body: {
                    human_status: "closed",
                    human_closed_at: new Date().toISOString(),
                },
            });

            try {
                await notifyCloseToTelegram(row, closedBy);
            } catch (err: any) {
                console.warn("No se pudo notificar a Telegram (close):", err?.message || err);
            }

            await load();
        } catch (e: any) {
            alert(e?.message || "Error cerrando caso");
        }
    }

    async function ping(row: CallRow) {
        const pingBy = "supervisor_demo";
        const status = (row.human_status || "pending").trim();

        let reason = "Seguimiento";
        if (status === "pending") reason = "SLA vencido";
        else if (status === "in_progress") reason = "Atención vencida";

        try {
            await notifyPingToTelegram(row, pingBy, reason);
            alert("Ping enviado ✅");
        } catch (e: any) {
            alert(e?.message || "Error enviando ping");
        }
    }

    async function autoMarkPriorityIfNeeded() {
        const candidates = rows.filter((r) => {
            const status = (r.human_status || "pending").trim();
            if (status !== "pending") return false;

            const age = minsSince(r.handoff_at);
            if (age === null) return false;

            const breached = age > SLA_PENDING_MIN;
            if (!breached) return false;

            if (getPriority(r)) return false;
            if (r?.metadata?.human?.auto_priority_at) return false;

            return true;
        });

        const batch = candidates.slice(0, 3);

        for (const r of batch) {
            try {
                const nextMeta = setPriorityInMetadata(r.metadata, true);
                nextMeta.human = {
                    ...(nextMeta.human ?? {}),
                    auto_priority_at: new Date().toISOString(),
                    auto_priority_reason: "sla_pending_breached",
                };

                await sbFetch(`/rest/v1/calls?id=eq.${encodeURIComponent(r.id)}`, {
                    method: "PATCH",
                    tenantId,
                    body: { metadata: nextMeta },
                });
            } catch (e: any) {
                console.warn("autoMarkPriority failed", r.id, e?.message || e);
            }
        }

        if (batch.length > 0) {
            await load();
        }
    }

    async function togglePriority(row: CallRow) {
        const next = !getPriority(row);
        const nextMeta = setPriorityInMetadata(row.metadata, next);

        try {
            await sbFetch("/rest/v1/calls?id=eq." + encodeURIComponent(row.id), {
                method: "PATCH",
                tenantId,
                body: {
                    metadata: nextMeta
                },
            });
            await load();
        } catch (e: any) {
            alert(e?.message || "Error actualizando prioridad");
        }
    }

    async function copyTelegramCmd(row: CallRow) {
        const cmd = `/call ${row.id} `;
        try {
            await navigator.clipboard.writeText(cmd);
            alert("Copiado ✅ Pega el comando en Telegram y escribe tu respuesta después del ID.");
        } catch {
            alert(cmd);
        }
    }

    async function markSeen(row: CallRow) {
        try {
            const seenTo = row?.human_last_message_at || new Date().toISOString();
            const nextMeta = setLastSeenInMetadata(row.metadata, activeAdvisor, seenTo);

            await sbFetch("/rest/v1/calls?id=eq." + encodeURIComponent(row.id), {
                method: "PATCH",
                tenantId,
                body: {
                    metadata: nextMeta
                },
            });

            await load();
        } catch (e: any) {
            alert(e?.message || "Error marcando como visto");
        }
    }

    const view = useMemo(() => {
        let out = [...rows];

        if (statusFilter !== "all") {
            out = out.filter((r) => (r.human_status || "pending") === statusFilter);
        }

        if (onlyWithActivity) {
            out = out.filter((r) => (r.human_last_message_text || "").trim().length > 0);
        }

        if (onlyPriority) {
            out = out.filter((r) => getPriority(r));
        }

        if (onlyClosedToday) {
            out = out.filter(
                (r) => (r.human_status || "pending") === "closed" && isTodayLocal(r.human_closed_at)
            );
        }

        if (onlySlaBreached) {
            out = out.filter((r) => {
                const sla = minsBetween(r.human_first_response_at, r.human_taken_at);
                return sla !== null && sla > SLA_ALERT_MIN;
            });
        }

        if (onlyOpenBreached) {
            out = out.filter((r) => {
                const st = (r.human_status || "pending").trim();
                if (st !== "in_progress") return false;
                const openMin = minsSince(r.human_taken_at);
                return openMin !== null && openMin > OPEN_ALERT_MIN;
            });
        }

        if (onlyMine) {
            out = out.filter((r) => {
                const st = (r.human_status || "pending").trim();
                if (st === "in_progress" || st === "closed") {
                    return (r.human_taken_by || "").trim() === activeAdvisor;
                }
                return false;
            });
        }

        out.sort((a, b) => {
            const pa = getPriority(a) ? 1 : 0;
            const pb = getPriority(b) ? 1 : 0;
            if (pa !== pb) return pb - pa;

            const sa = (a.human_status || "pending").trim();
            const sb = (b.human_status || "pending").trim();
            const ra = statusRank(sa);
            const rb = statusRank(sb);
            if (ra !== rb) return ra - rb;

            const ta = new Date(a.handoff_at || a.updated_at).getTime();
            const tb = new Date(b.handoff_at || b.updated_at).getTime();
            return tb - ta;
        });

        return out;
    }, [
        rows,
        statusFilter,
        onlyWithActivity,
        onlyPriority,
        onlyClosedToday,
        onlySlaBreached,
        onlyOpenBreached,
        onlyMine,
        activeAdvisor,
    ]);

    const stats = useMemo(() => {
        const pending = rows.filter((r) => (r.human_status || "pending") === "pending").length;
        const inProgress = rows.filter((r) => (r.human_status || "pending") === "in_progress").length;
        const closed = rows.filter((r) => (r.human_status || "pending") === "closed").length;
        const closedToday = rows.filter(
            (r) => (r.human_status || "pending") === "closed" && isTodayLocal(r.human_closed_at)
        ).length;
        return { pending, inProgress, closed, closedToday };
    }, [rows]);

    // ✅ Auto-refresh ligero: 15s, solo pestaña visible + refresh al volver
    useEffect(() => {
        let t: any = null;

        const start = () => {
            if (t) clearInterval(t);
            t = setInterval(() => {
                if (document.visibilityState === "visible") load();
            }, 15000);
        };

        const stop = () => {
            if (t) clearInterval(t);
            t = null;
        };

        const onVis = () => {
            if (document.visibilityState === "visible") {
                load();
                start();
            } else {
                stop();
            }
        };

        onVis();
        document.addEventListener("visibilitychange", onVis);

        return () => {
            stop();
            document.removeEventListener("visibilitychange", onVis);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!rows || rows.length === 0) return;
        autoMarkPriorityIfNeeded();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows]);

    // ✅ Flash 4s cuando hay nuevos para el asesor activo
    useEffect(() => {
        if (!rows?.length) return;

        const now = Date.now();
        const newOnes = rows.filter((r) => isNewForAdvisor(r, activeAdvisor));
        if (newOnes.length === 0) return;

        setFlashIds((prev) => {
            const next = { ...prev };
            let changed = false;

            for (const r of newOnes) {
                if (next[r.id] && now - next[r.id] < 4000) continue;
                next[r.id] = now;
                changed = true;

                setTimeout(() => {
                    setFlashIds((p) => {
                        const n = { ...p };
                        delete n[r.id];
                        return n;
                    });
                }, 4000);
            }

            return changed ? next : prev;
        });
    }, [rows, activeAdvisor]);

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold">Handoffs</h1>
                    <div className="text-sm text-muted-foreground">
                        Cola de casos derivados a asesor (refresco automático cada 15s; pausa en segundo plano)
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-2">
                    <span className="text-xs px-2 py-0.5 rounded-full border">Pendientes: {stats.pending}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full border">En atención: {stats.inProgress}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full border">Cerrados: {stats.closed}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full border">Cerrados hoy: {stats.closedToday}</span>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                    <label className="text-sm">
                        Estado:&nbsp;
                        <select
                            className="border rounded-md px-2 py-1 bg-background"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as any)}
                        >
                            <option value="pending">Pendientes</option>
                            <option value="in_progress">En atención</option>
                            <option value="closed">Cerrados</option>
                            <option value="all">Todos</option>
                        </select>
                    </label>

                    <label className="text-sm flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={onlyWithActivity}
                            onChange={(e) => setOnlyWithActivity(e.target.checked)}
                        />
                        Solo con actividad
                    </label>

                    <label className="text-sm flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={onlyPriority}
                            onChange={(e) => setOnlyPriority(e.target.checked)}
                        />
                        Solo prioridad
                    </label>

                    <label className="text-sm flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={onlyClosedToday}
                            onChange={(e) => {
                                const v = e.target.checked;
                                setOnlyClosedToday(v);
                                if (v) setStatusFilter("closed");
                            }}
                        />
                        Cerrados hoy
                    </label>

                    <label className="text-sm flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={onlySlaBreached}
                            onChange={(e) => setOnlySlaBreached(e.target.checked)}
                        />
                        Vencidos SLA (&gt; {SLA_ALERT_MIN}m)
                    </label>

                    <label className="text-sm flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={onlyOpenBreached}
                            onChange={(e) => setOnlyOpenBreached(e.target.checked)}
                        />
                        Atención vencida (&gt; {OPEN_ALERT_MIN}m)
                    </label>

                    <label className="text-sm">
                        Asesor:&nbsp;
                        <select
                            className="border rounded-md px-2 py-1 bg-background"
                            value={activeAdvisor}
                            onChange={(e) => setActiveAdvisor(e.target.value)}
                        >
                            {ADVISORS.map((a) => (
                                <option key={a} value={a}>
                                    {a}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="text-sm flex items-center gap-2">
                        <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
                        Mis casos
                    </label>

                    <button className="border rounded-md px-3 py-1" onClick={load} disabled={loading}>
                        {loading ? "Cargando…" : "Refrescar"}
                    </button>
                </div>
            </div>

            {error && <div className="text-sm text-red-500">{error}</div>}

            <div className="rounded-xl border overflow-hidden">
                <div className="p-3 font-medium bg-muted/50">Últimos handoffs</div>

                <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                        <tr>
                            <th className="text-left p-3">Handoff</th>
                            <th className="text-left p-3">Estado</th>
                            <th className="text-left p-3">Teléfono</th>
                            <th className="text-left p-3">Interés</th>
                            <th className="text-left p-3">Etapa</th>
                            <th className="text-left p-3">Motivo</th>
                            <th className="text-left p-3">Asignado</th>
                            <th className="text-left p-3">Actividad</th>
                            <th className="text-left p-3">Cerrado</th>
                            <th className="text-left p-3">Métricas</th>
                            <th className="text-left p-3">Cmd Telegram</th>
                            <th className="text-right p-3">Acciones</th>
                            <th className="text-right p-3">Links</th>
                        </tr>
                    </thead>

                    <tbody>
                        {view.map((r) => {
                            const llm = getLlm(r);
                            const interest = (llm.service_interest || "").trim() || "—";
                            const stage = (llm.stage || "").trim() || "—";
                            const status = (r.human_status || "pending").trim();

                            const pendingAgeMin = status === "pending" ? minsSince(r.handoff_at) : null;
                            const pendingSlaBreached = pendingAgeMin !== null && pendingAgeMin > SLA_PENDING_MIN;

                            const openAgeMin = status === "in_progress" ? minsSince(r.human_taken_at) : null;
                            const openBreached = openAgeMin !== null && openAgeMin > SLA_OPEN_MIN;

                            const lastHumanText = (r.human_last_message_text || "").trim();
                            const lastHumanAt = r.human_last_message_at
                                ? new Date(r.human_last_message_at).toLocaleString()
                                : "";

                            const isPriority = getPriority(r);
                            const closeReason = (r?.metadata?.human?.close_reason || "").toString().trim();
                            const closeNotes = (r?.metadata?.human?.close_notes || "").toString().trim();

                            const msgCount =
                                typeof r.human_response_count === "number" ? r.human_response_count : null;
                            const slaMin = minsBetween(r.human_first_response_at, r.human_taken_at);
                            const slaAlert = slaMin !== null && slaMin > SLA_ALERT_MIN;

                            const openMin = r.human_closed_at ? null : minsSince(r.human_taken_at);
                            const resolutionMin = r.human_closed_at
                                ? minsBetween(r.human_closed_at, r.human_taken_at)
                                : null;
                            const openAlert = status === "in_progress" && openMin !== null && openMin > OPEN_ALERT_MIN;

                            const pingDisabled = !(r.assigned_to || "").toString().trim();

                            const newForMe = isNewForAdvisor(r, activeAdvisor);
                            const flashing = Boolean(flashIds[r.id]);

                            return (
                                <tr
                                    key={r.id}
                                    className={[
                                        "border-t align-top transition",
                                        newForMe ? "bg-amber-50/40" : "",
                                        flashing ? "animate-pulse" : "",
                                    ].join(" ")}
                                >
                                    <td className="p-3">
                                        {r.handoff_at ? new Date(r.handoff_at).toLocaleString() : "—"}
                                    </td>

                                    <td className="p-3">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span>{status}</span>

                                            {isPriority && (
                                                <span className="text-xs px-2 py-0.5 rounded-full border">🔥 PRIORIDAD</span>
                                            )}

                                            {newForMe && status !== "closed" && (
                                                <span className="text-xs px-2 py-0.5 rounded-full border">
                                                    🟢 Nuevo (para {activeAdvisor})
                                                </span>
                                            )}

                                            {openAlert && (
                                                <span className="text-xs px-2 py-0.5 rounded-full border border-red-500 text-red-600">
                                                    ⏳ Abierto {openMin}m ⚠️
                                                </span>
                                            )}

                                            {status === "closed" && (
                                                <span
                                                    className="text-xs px-2 py-0.5 rounded-full border"
                                                    title={closeNotes ? `Nota: ${closeNotes}` : ""}
                                                >
                                                    🏁 {closeReason || "Cerrado"}
                                                </span>
                                            )}

                                            {pendingSlaBreached && (
                                                <span className="text-xs px-2 py-0.5 rounded-full border border-red-500 text-red-600">
                                                    ⏳ SLA vencido {pendingAgeMin}m
                                                </span>
                                            )}

                                            {openBreached && (
                                                <span className="text-xs px-2 py-0.5 rounded-full border border-orange-500 text-orange-600">
                                                    🔥 Atención vencida {openAgeMin}m
                                                </span>
                                            )}

                                            {(r.human_taken_by || "").trim() && (
                                                <span className="text-xs text-muted-foreground">Tomado por: {r.human_taken_by}</span>
                                            )}
                                        </div>
                                    </td>

                                    <td className="p-3">{r.phone ?? "—"}</td>
                                    <td className="p-3">{interest}</td>
                                    <td className="p-3">{stage}</td>

                                    <td className="p-3">
                                        {((r.handoff_reason || "").trim() || "—") +
                                            (status === "closed" && (closeReason || closeNotes)
                                                ? ` · cierre: ${closeReason || "Cerrado"}`
                                                : "")}
                                    </td>

                                    <td className="p-3">{r.assigned_channel ? `${r.assigned_channel}:${r.assigned_to}` : "—"}</td>

                                    <td className="p-3">
                                        {lastHumanText ? (
                                            <div className="space-y-1">
                                                <div className="text-xs text-muted-foreground">{lastHumanAt}</div>
                                                <div className="whitespace-pre-wrap">{lastHumanText}</div>
                                            </div>
                                        ) : (
                                            <span className="text-muted-foreground">—</span>
                                        )}
                                    </td>

                                    <td className="p-3">
                                        {r.human_closed_at ? (
                                            new Date(r.human_closed_at).toLocaleString()
                                        ) : (
                                            <span className="text-muted-foreground">—</span>
                                        )}
                                    </td>

                                    <td className="p-3">
                                        <div className="space-y-1">
                                            <div className={`text-xs ${slaAlert ? "text-red-600" : "text-muted-foreground"}`}>
                                                Msg: {msgCount ?? "—"} · SLA: {fmtMins(slaMin)}
                                                {slaAlert ? " ⚠️ Vencido" : ""}
                                            </div>

                                            <div className="text-xs text-muted-foreground">
                                                {r.human_closed_at ? `Res: ${fmtMins(resolutionMin)}` : `Abierto: ${fmtMins(openMin)}`}
                                            </div>
                                        </div>
                                    </td>

                                    <td className="p-3">
                                        <button className="border rounded-md px-3 py-1" onClick={() => copyTelegramCmd(r)}>
                                            Copiar /call
                                        </button>
                                    </td>

                                    <td className="p-3 text-right space-x-2 whitespace-nowrap">
                                        {newForMe && (
                                            <button
                                                className="border rounded-md px-3 py-1"
                                                onClick={() => markSeen(r)}
                                                title="Marcar último mensaje como visto"
                                            >
                                                Visto
                                            </button>
                                        )}

                                        <button className="border rounded-md px-3 py-1" onClick={() => togglePriority(r)} title="Marcar/quitar prioridad">
                                            {isPriority ? "Quitar prioridad" : "Prioridad"}
                                        </button>

                                        <button
                                            className="border rounded-md px-3 py-1"
                                            onClick={() => ping(r)}
                                            disabled={pingDisabled}
                                            title={pingDisabled ? "No tiene assigned_to (chat id)" : "Enviar recordatorio por Telegram"}
                                        >
                                            🔔 Ping
                                        </button>

                                        <button
                                            className="border rounded-md px-3 py-1"
                                            onClick={() => take(r)}
                                            disabled={status !== "pending"}
                                            title={status !== "pending" ? "Solo se puede tomar si está pendiente" : "Tomar caso"}
                                        >
                                            Tomar
                                        </button>

                                        <button
                                            className="border rounded-md px-3 py-1"
                                            onClick={() => close(r)}
                                            disabled={status === "closed"}
                                            title={status === "closed" ? "Ya está cerrado" : "Cerrar caso"}
                                        >
                                            Cerrar
                                        </button>
                                    </td>

                                    <td className="p-3 text-right space-x-3 whitespace-nowrap">
                                        <Link className="underline" href={`/call?id=${r.id}`}>
                                            Ver call
                                        </Link>
                                        <Link className="underline" href={`/lead?id=${r.lead_id}`}>
                                            Ver lead
                                        </Link>
                                        {r.lead_id ? (
                                            <Link className="underline" href={`/leads/workspace?leadId=${encodeURIComponent(r.lead_id)}&callId=${encodeURIComponent(r.id)}`}>
                                                Workspace
                                            </Link>
                                        ) : null}
                                    </td>
                                </tr>
                            );
                        })}

                        {view.length === 0 && (
                            <tr>
                                <td className="p-6 text-center text-muted-foreground" colSpan={13}>
                                    No hay handoffs en este estado.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
