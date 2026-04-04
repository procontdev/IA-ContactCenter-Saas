"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { sbFetch } from "@/lib/supabaseRest";
import React from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback-state";

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

    // (estos pueden venir del excel, pero ya NO los usaremos para el panel CRM)
    usuario?: string | null;
    duracion_sec?: number | null;
    call_state_general?: string | null;
    sale_state?: string | null;
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
    form_id: string | null;
    created_at: string | null;

    phone: string | null;
    phone_norm: string | null;

    lead_score: number | null;
    lead_temperature: "caliente" | "tibio" | "frio" | null;
    priority: "P1" | "P2" | "P3" | null;

    sla_due_at: string | null;
    next_best_action: string | null;

    quality_flags: any[] | null;
    spam_flags: any[] | null;
    lead_score_reasons: string[] | null;
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

import { useTenant } from "@/lib/tenant/use-tenant";

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
    const rows = await sbFetch<WowInsight[]>("/rest/v1/v_leads_wow_queue", {
        tenantId,
        query: {
            select:
                "id,campaign_id,campaign,form_id,created_at,phone,phone_norm,lead_score,lead_temperature,priority,sla_due_at,next_best_action,quality_flags,spam_flags,lead_score_reasons",
            id: `eq.${leadId}`,
            limit: 1,
        },
    });
    return rows?.[0] ?? null;
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

function LeadViewInner() {
    const sp = useSearchParams();
    const router = useRouter();
    const { context, loading: tenantLoading } = useTenant();
    const rawId = sp.get("id");
    const from = (sp.get("from") || "").trim().toLowerCase(); // "wow" si vienes desde WOW

    const id = useMemo(() => {
        if (!rawId) return null;
        return rawId.trim().replace(/^"+|"+$/g, "");
    }, [rawId]);

    const [lead, setLead] = useState<Lead | null>(null);
    const [calls, setCalls] = useState<Call[]>([]);
    const [wow, setWow] = useState<WowInsight | null>(null);

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

    useEffect(() => {
        let alive = true;

        async function run() {
            if (tenantLoading) return;
            if (!id) {
                setLoading(false);
                setError("Falta parámetro id");
                return;
            }

            if (!context?.tenantId) {
                setLoading(false);
                setError("No se pudo resolver el contexto del tenant.");
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const [leadItem, callsRes, wowRow] = await Promise.all([
                    fetchLeadWithCampaign(id, context.tenantId),
                    fetchCalls(id, context.tenantId),
                    // WOW es “nice to have”: si falla, no rompemos la pantalla.
                    fetchWowInsight(id, context.tenantId).catch(() => null),
                ]);

                if (!alive) return;
                setLead(leadItem);
                setCalls(callsRes ?? []);
                setWow(wowRow);
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
        tenantId?: string,
        opts?: { maxTries?: number; delayMs?: number }
    ) {
        const maxTries = opts?.maxTries ?? 12;
        const delayMs = opts?.delayMs ?? 2000;

        for (let i = 0; i < maxTries; i++) {
            const res = await fetchCalls(leadId, tenantId);
            const arr = res ?? [];
            setCalls(arr);

            const latestCall = arr[0];
            if (latestCall && isFinalStatus(latestCall.status)) return latestCall;

            await new Promise((r) => setTimeout(r, delayMs));
        }

        const last = (await fetchCalls(leadId, tenantId))?.[0] ?? null;
        if (last) setCalls((await fetchCalls(leadId, tenantId)) ?? []);
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
                    source: "demo-crm-view",
                    tenant_id: context?.tenantId, // 👈 Pasamos tenant_id a n8n

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

            const latestCall = await refreshCallsWithPolling(lead.id, context?.tenantId || undefined, { maxTries: 6, delayMs: 1500 });
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

    if (loading) return <LoadingState className="m-6" label="Cargando detalle del lead..." />;
    if (error) return <ErrorState title="No pudimos abrir este lead" description={error} className="m-6" />;
    if (!lead) {
        return (
            <EmptyState
                title="Este lead no está disponible"
                description="Verifica el identificador o vuelve al listado para seleccionar otro lead."
                className="m-6"
            />
        );
    }

    const campaignLabel =
        (lead.campaign_name && lead.campaign_name.trim()) ||
        (lead.campaign && lead.campaign.trim()) ||
        "-";

    const backHref = from === "wow" ? "/leads/wow" : "/leads";
    const backText = from === "wow" ? "← Volver a WOW Queue" : "← Volver a Leads";

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="flex gap-3 text-sm">
                        <Link href={backHref} className="underline">
                            {backText}
                        </Link>
                        <Link href="/leads" className="underline text-muted-foreground">
                            Ver listado crudo
                        </Link>
                    </div>

                    <h1 className="text-2xl font-semibold mt-2">
                        Detalle de Lead{from === "wow" ? " (WOW)" : ""}
                    </h1>
                    <div className="text-sm text-muted-foreground">
                        {lead.phone ?? "-"} · {campaignLabel}
                    </div>
                </div>

                <div className="flex gap-2">
                    <Link
                        href={`/leads/workspace?leadId=${encodeURIComponent(lead.id)}`}
                        className="px-3 py-2 rounded-lg border hover:bg-muted"
                    >
                        Omnichannel Workspace
                    </Link>
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

                {/* --- PANEL CONTEXTO DESDE BD --- */}
                <div className="rounded-xl border p-4 space-y-3">
                    <div className="font-medium">Contexto (BD / Llamadas)</div>

                    {!bestCall || !ctx ? (
                        <div className="text-sm text-muted-foreground">
                            Sin llamadas registradas para este lead.
                        </div>
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
                                <b>Next best action (call):</b> {ctx.nextBestAction ?? "-"}
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

                    {/* --- WOW INSIGHTS (no depende de calls) --- */}
                    <div className="border-t pt-3 space-y-2">
                        <div className="font-medium text-sm">WOW Insights</div>

                        {!wow ? (
                            <div className="text-sm text-muted-foreground">
                                No hay datos WOW para este lead (o la vista no lo incluye aún).
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="text-sm">
                                        <b>Temperatura:</b>{" "}
                                        <span className="inline-flex items-center border rounded-full px-2 py-0.5 text-xs">
                                            {wow.lead_temperature ?? "-"}
                                        </span>
                                    </div>
                                    <div className="text-sm">
                                        <b>Priority:</b>{" "}
                                        <span className="inline-flex items-center border rounded-full px-2 py-0.5 text-xs">
                                            {wow.priority ?? "-"}
                                        </span>
                                    </div>

                                    <div className="text-sm">
                                        <b>Score:</b> {wow.lead_score ?? "-"}
                                    </div>
                                    <div className="text-sm">
                                        <b>SLA:</b> {formatDatePe(wow.sla_due_at)}
                                        <div className={`text-xs ${isOverdue(wow.sla_due_at) ? "text-red-600" : "text-muted-foreground"}`}>
                                            {isOverdue(wow.sla_due_at) ? "Vencido" : "OK"}
                                        </div>
                                    </div>
                                </div>

                                <div className="text-sm">
                                    <b>Next best action (WOW):</b> {wow.next_best_action ?? "-"}
                                </div>

                                <details>
                                    <summary className="cursor-pointer select-none underline text-sm">
                                        Ver razones del score
                                    </summary>
                                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                                        {(wow.lead_score_reasons || []).slice(0, 80).map((r, idx) => (
                                            <li key={idx}>• {r}</li>
                                        ))}
                                    </ul>
                                </details>

                                <div className="text-xs text-muted-foreground">
                                    Fuente: v_leads_wow_queue
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className="p-3 flex items-center justify-between bg-muted/50 md:col-span-2">
                    <div className="font-medium">Llamadas generadas en la demo</div>
                    {calls?.[0]?.id && (
                        <Link className="underline text-sm" href={`/call?id=${encodeURIComponent(calls[0].id)}`}>
                            Ver última llamada →
                        </Link>
                    )}
                </div>

                <div className="rounded-xl border p-4 space-y-2 md:col-span-2">
                    <div className="font-medium">Actividad del lead (timeline MVP)</div>

                    {timelineLoading ? (
                        <div className="text-sm text-muted-foreground">Cargando timeline…</div>
                    ) : timelineError ? (
                        <div className="text-sm text-red-600">{timelineError}</div>
                    ) : !timeline.length ? (
                        <EmptyState
                            title="Aún no hay eventos en el timeline"
                            description="Este lead todavía no registra actividad de operación en el historial."
                        />
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
                                    <td className="p-6" colSpan={6}>
                                        <EmptyState
                                            title="No hay llamadas registradas todavía"
                                            description="Puedes iniciar una llamada humana o IA desde los botones superiores."
                                        />
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

export default function LeadViewPage() {
    return (
        <Suspense fallback={<div className="p-6">Cargando…</div>}>
            <LeadViewInner />
        </Suspense>
    );
}
