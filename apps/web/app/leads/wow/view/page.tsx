"use client";

import Link from "next/link";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { sbFetch } from "@/lib/supabaseRest";
import { useTenant } from "@/lib/tenant/use-tenant";

type Lead = {
    id: string;
    phone: string | null;

    // campo original en leads
    campaign: string | null;

    // vienen de la view v_leads_with_campaign
    campaign_name?: string | null;
    campaign_objective?: string | null;

    estado_cliente: string | null;
    estado_usuario: string | null;
    fecha?: string | null;
    created_at: string;
};

type Call = {
    id: string;
    lead_id: string;
    mode: "human" | "llm" | string;
    status: string | null;

    started_at: string | null;
    ended_at?: string | null;
    created_at: string | null;

    duration_sec: number | null;
    phone: string | null;
    twilio_call_sid: string | null;

    agent_phone?: string | null;

    assigned_to?: string | null;
    assigned_channel?: string | null;

    human_status?: string | null;
    human_taken_by?: string | null;
    human_taken_at?: string | null;
    human_closed_at?: string | null;

    metadata?: any; // jsonb
};

type WowInsight = {
    id: string;
    campaign_id: string | null;
    campaign: string | null;

    phone: string | null;
    phone_norm: string | null;

    lead_score: number | null;
    lead_temperature: "caliente" | "tibio" | "frio" | null;

    priority: "P1" | "P2" | "P3" | null;
    sla_due_at: string | null;

    next_best_action: string | null;

    quality_flags: any[];
    spam_flags: any[];
    lead_score_reasons: string[];
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

const WOW_NAV_KEY = "wow_queue_nav_v1";

function safeJsonParse<T>(s: string | null): T | null {
    if (!s) return null;
    try {
        return JSON.parse(s) as T;
    } catch {
        return null;
    }
}

function fmtSec(s: number | null) {
    if (s === null || s === undefined) return "-";
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}

function shortSid(sid: string | null) {
    if (!sid) return "-";
    return sid.length > 14 ? `${sid.slice(0, 6)}…${sid.slice(-6)}` : sid;
}

function normStatus(s?: string | null) {
    return String(s ?? "").trim().toLowerCase();
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

function isOverdue(iso: string | null | undefined) {
    if (!iso) return false;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    return d.getTime() < Date.now();
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

function getTurnsCount(call: Call) {
    const turns = call?.metadata?.llm?.turns;
    return Array.isArray(turns) ? turns.length : 0;
}

function pickBestCall(calls: Call[]) {
    if (!calls?.length) return null;

    // 1) última completed con duración razonable
    const completedGood = calls.find((c) => {
        const st = normStatus(c.status);
        const dur = Number(c.duration_sec ?? 0);
        return st === "completed" && dur >= 20;
    });
    if (completedGood) return completedGood;

    // 2) última llm con turns
    const llmWithTurns = calls.find((c) => {
        const isLLM = String(c.mode ?? "").toLowerCase() === "llm";
        return isLLM && getTurnsCount(c) >= 2;
    });
    if (llmWithTurns) return llmWithTurns;

    return calls[0];
}

type CallContext = {
    callId: string;
    mode: string;
    status: string;
    durationSec: number | null;
    stage: string | null;
    intent: string | null;
    nextBestAction: string | null;
    handoffScore: number | null;
    saleState: string | null;
    source: string | null;
};

function buildCallContext(call: Call | null): CallContext | null {
    if (!call) return null;

    const meta = call.metadata ?? {};
    const llm = meta.llm ?? {};
    const assistant = meta.assistant ?? {};

    const intent =
        (assistant.intent && String(assistant.intent)) ||
        (llm.service_interest && String(llm.service_interest)) ||
        null;

    const nextBestAction =
        (assistant.next_best_action && String(assistant.next_best_action)) || null;

    const handoffScore =
        meta.handoff_score !== undefined && meta.handoff_score !== null
            ? Number(meta.handoff_score)
            : null;

    const stage =
        (llm.stage && String(llm.stage)) ||
        (assistant.stage && String(assistant.stage)) ||
        null;

    const saleState =
        (llm.done === true ? "Cerrado (IA)" : null) ||
        (handoffScore && handoffScore > 0 ? "Derivado a humano" : null) ||
        null;

    const source =
        (assistant.source && String(assistant.source)) ||
        (meta.source_last && String(meta.source_last)) ||
        (meta.source && String(meta.source)) ||
        null;

    return {
        callId: call.id,
        mode: String(call.mode ?? "-"),
        status: normStatus(call.status) || "-",
        durationSec: call.duration_sec ?? null,
        stage,
        intent,
        nextBestAction,
        handoffScore,
        saleState,
        source,
    };
}

async function fetchCalls(leadId: string, tenantId?: string) {
    return sbFetch<Call[]>("/rest/v1/calls", {
        tenantId,
        query: {
            select:
                "id,lead_id,mode,status,started_at,ended_at,created_at,duration_sec,phone,twilio_call_sid," +
                "agent_phone,assigned_to,assigned_channel,human_status,human_taken_by,human_taken_at,human_closed_at,metadata",
            lead_id: `eq.${leadId}`,
            order: "created_at.desc",
            limit: 50,
        },
    });
}

async function fetchLeadWithCampaign(leadId: string, tenantId?: string) {
    // 1) Intentar view (recomendado)
    try {
        const v = await sbFetch<Lead[]>("/rest/v1/v_leads_with_campaign", {
            tenantId,
            query: { select: "*", id: `eq.${leadId}`, limit: 1 },
        });
        if (v?.[0]) return v[0];
    } catch {
        // fallback abajo
    }

    // 2) Fallback: tabla leads (sin campaign_name/objective)
    const t = await sbFetch<Lead[]>("/rest/v1/leads", {
        tenantId,
        query: { select: "*", id: `eq.${leadId}`, limit: 1 },
    });
    return t?.[0] ?? null;
}

async function fetchWowInsight(leadId: string, tenantId?: string) {
    // Intentamos la view WOW (la que ya usas en wow-queue)
    try {
        const v = await sbFetch<WowInsight[]>("/rest/v1/v_leads_wow_queue", {
            tenantId,
            query: {
                select:
                    "id,campaign_id,campaign,phone,phone_norm,lead_score,lead_temperature,priority,sla_due_at,next_best_action,quality_flags,spam_flags,lead_score_reasons",
                id: `eq.${leadId}`,
                limit: 1,
            },
        });
        return v?.[0] ?? null;
    } catch {
        return null;
    }
}

async function fetchLeadTimeline(leadId: string, token: string) {
    const res = await fetch(`/api/aap/leads/${encodeURIComponent(leadId)}/timeline?limit=80`, {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(String(body?.error || `Timeline error ${res.status}`));
    }
    return Array.isArray(body?.items) ? (body.items as TimelineItem[]) : [];
}

function LeadWowViewInner() {
    const sp = useSearchParams();
    const router = useRouter();
    const { context, loading: tenantLoading } = useTenant();
    const tenantId = context?.tenantId || undefined;

    const rawId = sp.get("id");
    const id = useMemo(() => {
        if (!rawId) return null;
        return rawId.trim().replace(/^"+|"+$/g, "");
    }, [rawId]);

    const [lead, setLead] = useState<Lead | null>(null);
    const [wow, setWow] = useState<WowInsight | null>(null);
    const [calls, setCalls] = useState<Call[]>([]);
    const [loading, setLoading] = useState(true);
    const [calling, setCalling] = useState<null | "human" | "llm">(null);
    const [error, setError] = useState<string | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [timeline, setTimeline] = useState<TimelineItem[]>([]);
    const [timelineLoading, setTimelineLoading] = useState(false);
    const [timelineError, setTimelineError] = useState<string | null>(null);

    useEffect(() => {
        setToken(readAccessTokenFromStorage());
    }, []);

    // ✅ Navegación Anterior/Siguiente (desde WOW Queue)
    const [nav, setNav] = useState<{ ids: string[]; currentId?: string | null } | null>(null);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const st = safeJsonParse<{ ids: string[]; currentId?: string }>(sessionStorage.getItem(WOW_NAV_KEY));
        if (st?.ids?.length) setNav(st);
    }, []);

    const navIndex = useMemo(() => {
        const ids = nav?.ids || [];
        if (!id) return -1;
        return ids.indexOf(id);
    }, [nav, id]);

    const prevId = useMemo(() => {
        if (!nav?.ids?.length) return null;
        if (navIndex <= 0) return null;
        return nav.ids[navIndex - 1] || null;
    }, [nav, navIndex]);

    const nextId = useMemo(() => {
        if (!nav?.ids?.length) return null;
        if (navIndex < 0) return null;
        if (navIndex >= nav.ids.length - 1) return null;
        return nav.ids[navIndex + 1] || null;
    }, [nav, navIndex]);

    function goToLead(targetId: string) {
        if (!targetId) return;
        if (typeof window !== "undefined") {
            sessionStorage.setItem(WOW_NAV_KEY, JSON.stringify({ ids: nav?.ids || [], currentId: targetId }));
        }
        router.push(`/leads/wow/view?id=${encodeURIComponent(targetId)}#wow-insights`);
    }

    useEffect(() => {
        let alive = true;

        async function run() {
            if (tenantLoading || !tenantId) return;
            if (!id) {
                setLoading(false);
                setError("Falta parámetro id");
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const [leadItem, callsRes, wowRes] = await Promise.all([
                    fetchLeadWithCampaign(id, tenantId),
                    fetchCalls(id, tenantId),
                    fetchWowInsight(id, tenantId),
                ]);

                if (!alive) return;
                setLead(leadItem);
                setCalls(callsRes ?? []);
                setWow(wowRes);
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
    }, [id, tenantLoading, tenantId]);

    useEffect(() => {
        let alive = true;

        async function runTimeline() {
            if (!id || !token) {
                setTimeline([]);
                if (!token) setTimelineError("No se detectó sesión para cargar timeline.");
                return;
            }

            setTimelineLoading(true);
            setTimelineError(null);
            try {
                const items = await fetchLeadTimeline(id, token);
                if (!alive) return;
                setTimeline(items);
            } catch (e: any) {
                if (!alive) return;
                setTimeline([]);
                setTimelineError(e?.message ?? String(e));
            } finally {
                if (!alive) return;
                setTimelineLoading(false);
            }
        }

        runTimeline();
        return () => {
            alive = false;
        };
    }, [id, token]);

    const N8N_BASE =
        process.env.NEXT_PUBLIC_N8N_BASE_URL || "https://elastica-n8n.3haody.easypanel.host";
    const startHumanUrl = `${N8N_BASE}/webhook/api/calls/start-human`;
    const startLlmUrl = `${N8N_BASE}/webhook/api/calls/start-llm`;

    function isFinalStatus(st: string | null) {
        const s = (st || "").trim().toLowerCase();
        return ["completed", "failed", "busy", "no-answer", "canceled"].includes(s);
    }

    async function refreshCallsWithPolling(
        leadId: string,
        opts?: { maxTries?: number; delayMs?: number }
    ) {
        const maxTries = opts?.maxTries ?? 12;
        const delayMs = opts?.delayMs ?? 2000;

        for (let i = 0; i < maxTries; i++) {
            const res = await fetchCalls(leadId);
            const arr = res ?? [];
            setCalls(arr);

            const latestCall = arr[0];
            if (latestCall && isFinalStatus(latestCall.status)) return latestCall;

            await new Promise((r) => setTimeout(r, delayMs));
        }

        const last = (await fetchCalls(leadId))?.[0] ?? null;
        if (last) setCalls((await fetchCalls(leadId)) ?? []);
        return last;
    }

    async function startCall(mode: "human" | "llm") {
        if (!lead) return;

        if (!lead.phone || !String(lead.phone).trim()) {
            alert("❌ Este lead no tiene teléfono.");
            return;
        }

        const url = mode === "human" ? startHumanUrl : startLlmUrl;

        try {
            setCalling(mode);

            const r = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    lead_id: lead.id,
                    phone: lead.phone,
                    source: "demo-ui-wow",

                    // contexto de campaña (opcional)
                    campaign: lead.campaign || "",
                    campaign_name: lead.campaign_name || "",
                    campaign_objective: lead.campaign_objective || "",
                }),
            });

            const rawText = await r.text();
            if (!r.ok) throw new Error(`${r.status} ${rawText}`);

            let data: any = null;
            try {
                data = rawText ? JSON.parse(rawText) : null;
            } catch {
                data = null;
            }

            const callId = data?.call_id || data?.id || data?.call?.id || null;
            if (callId) {
                const cleanCallId = String(callId || "").replace(/^=+/, "").trim();
                router.push(`/call?id=${encodeURIComponent(cleanCallId)}`);
                return;
            }

            const latestCall = await refreshCallsWithPolling(lead.id, { maxTries: 6, delayMs: 1500 });
            if (latestCall?.id) {
                router.push(`/call?id=${encodeURIComponent(latestCall.id)}`);
                return;
            }

            alert(`✅ Llamada ${mode === "human" ? "Humano" : "IA"} iniciada (sin call_id retornado)`);
        } catch (e: any) {
            alert(`❌ Error iniciando llamada: ${e?.message ?? e}`);
        } finally {
            setCalling(null);
        }
    }

    const bestCall = React.useMemo(() => pickBestCall(calls ?? []), [calls]);
    const ctx = React.useMemo(() => buildCallContext(bestCall), [bestCall]);

    const lastCompleted = React.useMemo(() => {
        const arr = calls ?? [];
        return arr.find((c) => normStatus(c.status) === "completed") ?? null;
    }, [calls]);

    if (loading) return <div className="p-6">Cargando…</div>;
    if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
    if (!lead) return <div className="p-6">Lead no encontrado.</div>;

    const campaignLabel =
        (lead.campaign_name && lead.campaign_name.trim()) ||
        (lead.campaign && lead.campaign.trim()) ||
        "-";

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <Link href="/leads/wow" className="text-sm underline">
                            ← Volver a WOW
                        </Link>

                        {prevId ? (
                            <button
                                className="text-sm underline"
                                onClick={() => goToLead(prevId)}
                                title="Lead anterior (misma página de WOW Queue)"
                            >
                                ← Anterior
                            </button>
                        ) : (
                            <span className="text-sm text-muted-foreground">← Anterior</span>
                        )}

                        {nextId ? (
                            <button
                                className="text-sm underline"
                                onClick={() => goToLead(nextId)}
                                title="Lead siguiente (misma página de WOW Queue)"
                            >
                                Siguiente →
                            </button>
                        ) : (
                            <span className="text-sm text-muted-foreground">Siguiente →</span>
                        )}
                    </div>

                    <h1 className="text-2xl font-semibold mt-2">Detalle de Lead (WOW)</h1>
                    <div className="text-sm text-muted-foreground">
                        {lead.phone ?? "-"} · {campaignLabel}
                    </div>
                </div>

                <div className="flex gap-2">
                    <button
                        disabled={!!calling}
                        onClick={() => startCall("human")}
                        className="px-3 py-2 rounded-lg border hover:bg-muted disabled:opacity-50"
                    >
                        {calling === "human" ? "Llamando…" : "Llamar (Humano)"}
                    </button>
                    <button
                        disabled={!!calling}
                        onClick={() => startCall("llm")}
                        className="px-3 py-2 rounded-lg border hover:bg-muted disabled:opacity-50"
                    >
                        {calling === "llm" ? "Llamando…" : "Llamar (IA)"}
                    </button>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-xl border p-4 space-y-2">
                    <div className="font-medium">Datos principales</div>
                    <div className="text-sm">
                        <b>Teléfono:</b> {lead.phone ?? "-"}
                    </div>
                    <div className="text-sm">
                        <b>Campaña (código):</b> {lead.campaign ?? "-"}
                    </div>
                    <div className="text-sm">
                        <b>Campaña (nombre):</b> {lead.campaign_name ?? "-"}
                    </div>
                    <div className="text-sm">
                        <b>Objetivo:</b> {lead.campaign_objective ?? "-"}
                    </div>
                    <div className="text-sm">
                        <b>Estado cliente:</b> {lead.estado_cliente ?? "-"}
                    </div>
                    <div className="text-sm">
                        <b>Estado usuario:</b> {lead.estado_usuario ?? "-"}
                    </div>
                    <div className="text-sm">
                        <b>Fecha CRM:</b> {lead.fecha ? new Date(lead.fecha).toLocaleString() : "-"}
                    </div>
                    <div className="text-sm">
                        <b>Creado en demo:</b> {new Date(lead.created_at).toLocaleString()}
                    </div>
                </div>

                <div className="rounded-xl border p-4 space-y-2" id="wow-insights">
                    <div className="font-medium">WOW Insights</div>

                    {!wow ? (
                        <div className="text-sm text-muted-foreground">
                            No se pudo cargar la vista WOW para este lead (v_leads_wow_queue).
                        </div>
                    ) : (
                        <>
                            <div className="text-sm">
                                <b>Temperatura:</b> {wow.lead_temperature ?? "-"}
                            </div>
                            <div className="text-sm">
                                <b>Score:</b> {wow.lead_score ?? "-"}
                            </div>
                            <div className="text-sm">
                                <b>Prioridad:</b> {wow.priority ?? "-"}
                            </div>
                            <div className="text-sm">
                                <b>SLA:</b> {formatDatePe(wow.sla_due_at)}{" "}
                                <span className={`ml-2 text-xs ${isOverdue(wow.sla_due_at) ? "text-red-600" : "text-muted-foreground"}`}>
                                    {isOverdue(wow.sla_due_at) ? "Vencido" : "OK"}
                                </span>
                            </div>
                            <div className="text-sm">
                                <b>Next Best Action:</b> {wow.next_best_action ?? "-"}
                            </div>

                            <details className="mt-2">
                                <summary className="cursor-pointer select-none underline text-sm">
                                    Ver razones del score
                                </summary>
                                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                                    {(wow.lead_score_reasons || []).map((r, idx) => (
                                        <li key={idx}>• {r}</li>
                                    ))}
                                </ul>
                            </details>
                        </>
                    )}
                </div>

                <div className="rounded-xl border p-4 space-y-2 md:col-span-2">
                    <div className="font-medium">Contexto (BD / Llamadas)</div>

                    {!bestCall || !ctx ? (
                        <div className="text-sm text-muted-foreground">Sin llamadas registradas para este lead.</div>
                    ) : (
                        <>
                            <div className="text-sm">
                                <b>Mejor Call ID:</b> {ctx.callId}
                            </div>
                            <div className="text-sm">
                                <b>Modo:</b> {ctx.mode}
                            </div>
                            <div className="text-sm">
                                <b>Status:</b> {ctx.status}
                            </div>
                            <div className="text-sm">
                                <b>Duración:</b> {ctx.durationSec ?? "-"} sec
                            </div>
                            <div className="text-sm">
                                <b>Stage:</b> {ctx.stage ?? "-"}
                            </div>
                            <div className="text-sm">
                                <b>Intent:</b> {ctx.intent ?? "-"}
                            </div>
                            <div className="text-sm">
                                <b>Next best action:</b> {ctx.nextBestAction ?? "-"}
                            </div>
                            <div className="text-sm">
                                <b>Handoff score:</b> {ctx.handoffScore ?? "-"}
                            </div>
                            <div className="text-sm">
                                <b>Sale state:</b> {ctx.saleState ?? "-"}
                            </div>

                            {lastCompleted?.id && (
                                <div className="text-xs text-muted-foreground mt-2">
                                    Última llamada completed: {lastCompleted.id}
                                </div>
                            )}

                            <div className="text-xs text-muted-foreground mt-2">
                                Fuente: demo_callcenter.calls (best call) + metadata.llm / metadata.assistant
                            </div>
                        </>
                    )}
                </div>

                <div className="rounded-xl border p-4 space-y-2 md:col-span-2">
                    <div className="font-medium">Actividad del lead (timeline MVP)</div>

                    {timelineLoading ? (
                        <div className="text-sm text-muted-foreground">Cargando timeline…</div>
                    ) : timelineError ? (
                        <div className="text-sm text-red-600">{timelineError}</div>
                    ) : !timeline.length ? (
                        <div className="text-sm text-muted-foreground">Sin eventos para este lead.</div>
                    ) : (
                        <div className="space-y-2">
                            {timeline.map((ev) => (
                                <div key={ev.id} className="rounded-md border p-2">
                                    <div className="text-sm font-medium">{ev.event_type}</div>
                                    <div className="text-xs text-muted-foreground">
                                        {formatDatePe(ev.event_at)} · {ev.actor_label || "system"} · {ev.source}
                                        {ev.derived ? " · derived" : ""}
                                    </div>
                                    <pre className="mt-1 text-xs overflow-x-auto whitespace-pre-wrap">
                                        {JSON.stringify(ev.payload || {}, null, 2)}
                                    </pre>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-3 flex items-center justify-between bg-muted/50 md:col-span-2">
                    <div className="font-medium">Llamadas generadas en la demo</div>
                    {calls?.[0]?.id && (
                        <Link className="underline text-sm" href={`/call?id=${encodeURIComponent(calls[0].id)}`}>
                            Ver última llamada →
                        </Link>
                    )}
                </div>

                <div className="rounded-xl border overflow-hidden md:col-span-2">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30">
                            <tr>
                                <th className="text-left p-3">Modo</th>
                                <th className="text-left p-3">Estado</th>
                                <th className="text-left p-3">Inicio</th>
                                <th className="text-left p-3">Duración</th>
                                <th className="text-left p-3">Twilio SID</th>
                                <th className="text-right p-3">Detalle</th>
                            </tr>
                        </thead>
                        <tbody>
                            {calls.map((c) => {
                                const status = (c.status || "").trim();
                                const start = c.started_at || c.created_at;
                                return (
                                    <tr key={c.id} className="border-t">
                                        <td className="p-3">{c.mode}</td>
                                        <td className="p-3">{status || "-"}</td>
                                        <td className="p-3">{start ? new Date(start).toLocaleString() : "-"}</td>
                                        <td className="p-3">{fmtSec(c.duration_sec)}</td>
                                        <td className="p-3" title={c.twilio_call_sid ?? ""}>
                                            {shortSid(c.twilio_call_sid)}
                                        </td>
                                        <td className="p-3 text-right">
                                            <Link className="underline" href={`/call?id=${encodeURIComponent(c.id)}`}>
                                                Ver
                                            </Link>
                                        </td>
                                    </tr>
                                );
                            })}

                            {calls.length === 0 && (
                                <tr>
                                    <td className="p-6 text-center text-muted-foreground" colSpan={6}>
                                        Aún no hay llamadas generadas para este lead.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* (opcional) Barra inferior de navegación */}
            {nav?.ids?.length ? (
                <div className="flex items-center justify-between border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">
                        Navegación WOW: {navIndex >= 0 ? `${navIndex + 1} / ${nav.ids.length}` : `- / ${nav.ids.length}`}
                    </div>
                    <div className="flex gap-2">
                        <button
                            className="border rounded-md px-3 py-2 text-sm disabled:opacity-50"
                            disabled={!prevId}
                            onClick={() => prevId && goToLead(prevId)}
                        >
                            ← Anterior
                        </button>
                        <button
                            className="border rounded-md px-3 py-2 text-sm disabled:opacity-50"
                            disabled={!nextId}
                            onClick={() => nextId && goToLead(nextId)}
                        >
                            Siguiente →
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

export default function LeadWowViewPage() {
    return (
        <Suspense fallback={<div className="p-6">Cargando…</div>}>
            <LeadWowViewInner />
        </Suspense>
    );
}
