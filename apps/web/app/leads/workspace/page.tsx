"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback-state";
import { useTenantPlan } from "@/lib/packaging/use-tenant-plan";
import { hasTenantFeatureAccess } from "@/lib/packaging/tenant-plan";
import { canPerform } from "@/lib/permissions/access-control";
import { resolveLeadPlaybook } from "@/lib/leads/playbooks";
import { sbFetch } from "@/lib/supabaseRest";
import { useTenant } from "@/lib/tenant/use-tenant";
import type { UserRole } from "@/lib/tenant/tenant-types";

type Lead = {
    id: string;
    phone: string | null;
    campaign: string | null;
    campaign_name?: string | null;
    campaign_objective?: string | null;
    estado_cliente: string | null;
    estado_usuario: string | null;
    created_at: string;
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
    sla_status?: "no_sla" | "on_time" | "due_soon" | "overdue" | null;
    sla_is_escalated?: boolean | null;
    sla_escalation_level?: "none" | "warning" | "critical" | null;
    work_status?: "queued" | "assigned" | "in_progress" | "done" | null;
    work_assignee_user_id?: string | null;
    work_assignee_label?: string | null;
    human_takeover_status?: "none" | "taken" | "released" | "closed" | null;
    human_takeover_by_label?: string | null;
    next_best_action: string | null;
    lead_score_reasons: string[];
};

type Call = {
    id: string;
    lead_id: string | null;
    mode: string | null;
    status: string | null;
    created_at: string | null;
    started_at: string | null;
    duration_sec: number | null;
    phone: string | null;
    assigned_channel?: string | null;
    human_status?: string | null;
    human_taken_by?: string | null;
    human_taken_at?: string | null;
    human_closed_at?: string | null;
};

type Thread = {
    call_id: string;
    lead_id: string | null;
    campaign_code: string | null;
    campaign_name: string | null;
    channel: string | null;
    mode: string | null;
    human_status: string | null;
    customer_phone: string | null;
    customer_whatsapp_phone: string | null;
    customer_whatsapp_waid: string | null;
    campaign_wa_instance: string | null;
    campaign_wa_business_phone: string | null;
};

type Msg = {
    id: string;
    call_id: string;
    role: string;
    channel: string;
    from_id: string | null;
    from_name: string | null;
    message_text: string | null;
    created_at: string;
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

type MemberOption = {
    user_id: string;
    email: string | null;
    role: string | null;
};

type WorkStatus = "queued" | "assigned" | "in_progress" | "done";

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

function resolveChannel(call: Call | null, thread: Thread | null) {
    return (
        (thread?.channel && String(thread.channel)) ||
        (call?.assigned_channel && String(call.assigned_channel)) ||
        "unknown"
    );
}

export default function OmnichannelWorkspacePage() {
    const sp = useSearchParams();
    const { context, loading: tenantLoading } = useTenant();
    const { plan, loading: planLoading } = useTenantPlan();
    const tenantId = context?.tenantId || undefined;
    const role = (context?.role || null) as UserRole | null;

    const leadIdParam = (sp.get("leadId") || sp.get("id") || "").trim();
    const callIdParam = (sp.get("callId") || "").trim();
    const missingCaseParams = !leadIdParam && !callIdParam;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [token, setToken] = useState<string | null>(null);

    const [lead, setLead] = useState<Lead | null>(null);
    const [wow, setWow] = useState<WowInsight | null>(null);
    const [calls, setCalls] = useState<Call[]>([]);
    const [activeCallId, setActiveCallId] = useState<string | null>(null);

    const [thread, setThread] = useState<Thread | null>(null);
    const [messages, setMessages] = useState<Msg[]>([]);
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);

    const [timeline, setTimeline] = useState<TimelineItem[]>([]);
    const [timelineLoading, setTimelineLoading] = useState(false);
    const [timelineError, setTimelineError] = useState<string | null>(null);

    const [members, setMembers] = useState<MemberOption[]>([]);
    const [selectedAssignee, setSelectedAssignee] = useState("");
    const [mutating, setMutating] = useState(false);

    const canReadLeads = canPerform(role, "leads", "read");
    const canUpdateLeads = canPerform(role, "leads", "update");
    const canUpdateCalls = canPerform(role, "calls", "update");
    const workspaceFeatureIncluded = Boolean(plan?.features?.omnichannel_workspace);
    const workspaceFeatureEnabled = Boolean(plan && hasTenantFeatureAccess(plan, "omnichannel_workspace"));
    const playbooksEnabled = Boolean(plan?.features?.playbooks_nba);
    const subscriptionStatus = plan?.subscription?.status || "active";

    useEffect(() => {
        setToken(readAccessTokenFromStorage());
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

    useEffect(() => {
        let alive = true;

        async function run() {
            if (tenantLoading) return;
            if (!tenantId) {
                setLoading(false);
                setError("No se pudo resolver el tenant activo.");
                return;
            }
            if (!canReadLeads) {
                setLoading(false);
                setError("No tienes permisos para abrir este workspace.");
                return;
            }
            if (missingCaseParams) {
                setLoading(false);
                setError(null);
                setLead(null);
                return;
            }

            setLoading(true);
            setError(null);

            try {
                let resolvedLeadId = leadIdParam || "";

                if (callIdParam) {
                    const byCall = await sbFetch<Call[]>("/rest/v1/calls", {
                        tenantId,
                        query: {
                            select:
                                "id,lead_id,mode,status,created_at,started_at,duration_sec,phone,assigned_channel,human_status,human_taken_by,human_taken_at,human_closed_at",
                            id: `eq.${callIdParam}`,
                            limit: 1,
                        },
                    });
                    const c = byCall?.[0] ?? null;
                    if (c?.lead_id) resolvedLeadId = String(c.lead_id);
                }

                if (!resolvedLeadId) {
                    throw new Error("No se pudo resolver leadId para este caso.");
                }

                const [leadRows, wowRows, callRows] = await Promise.all([
                    sbFetch<Lead[]>("/rest/v1/v_leads_with_campaign", {
                        tenantId,
                        query: { select: "*", id: `eq.${resolvedLeadId}`, limit: 1 },
                    }),
                    sbFetch<WowInsight[]>("/rest/v1/v_leads_wow_queue", {
                        tenantId,
                        query: {
                            select:
                                "id,campaign_id,campaign,phone,phone_norm,lead_score,lead_temperature,priority,sla_due_at,sla_status,sla_is_escalated,sla_escalation_level,work_status,work_assignee_user_id,work_assignee_label,human_takeover_status,human_takeover_by_label,next_best_action,lead_score_reasons",
                            id: `eq.${resolvedLeadId}`,
                            limit: 1,
                        },
                    }).catch(() => []),
                    sbFetch<Call[]>("/rest/v1/calls", {
                        tenantId,
                        query: {
                            select:
                                "id,lead_id,mode,status,created_at,started_at,duration_sec,phone,assigned_channel,human_status,human_taken_by,human_taken_at,human_closed_at",
                            lead_id: `eq.${resolvedLeadId}`,
                            order: "created_at.desc",
                            limit: 15,
                        },
                    }),
                ]);

                if (!alive) return;

                const resolvedLead = leadRows?.[0] ?? null;
                if (!resolvedLead) throw new Error("Lead no encontrado en tenant activo.");

                const resolvedWow = wowRows?.[0] ?? null;
                const resolvedCalls = callRows ?? [];
                const resolvedActiveCallId = callIdParam || resolvedCalls?.[0]?.id || null;

                setLead(resolvedLead);
                setWow(resolvedWow);
                setCalls(resolvedCalls);
                setActiveCallId(resolvedActiveCallId);
                setSelectedAssignee(String(resolvedWow?.work_assignee_user_id || ""));
            } catch (e: unknown) {
                if (!alive) return;
                setError(e instanceof Error ? e.message : "Error inesperado");
            } finally {
                if (!alive) return;
                setLoading(false);
            }
        }

        run();
        return () => {
            alive = false;
        };
    }, [tenantLoading, tenantId, leadIdParam, callIdParam, canReadLeads, missingCaseParams]);

    useEffect(() => {
        let alive = true;

        async function loadConversation() {
            if (!tenantId || !activeCallId) {
                setThread(null);
                setMessages([]);
                return;
            }

            try {
                const [threads, msgs] = await Promise.all([
                    sbFetch<Thread[]>("/rest/v1/v_inbox_threads", {
                        tenantId,
                        query: {
                            select:
                                "call_id,lead_id,campaign_code,campaign_name,channel,mode,human_status,customer_phone,customer_whatsapp_phone,customer_whatsapp_waid,campaign_wa_instance,campaign_wa_business_phone",
                            call_id: `eq.${activeCallId}`,
                            limit: 1,
                        },
                    }).catch(() => []),
                    sbFetch<Msg[]>("/rest/v1/call_messages", {
                        tenantId,
                        query: {
                            select: "id,call_id,role,channel,from_id,from_name,message_text,created_at",
                            call_id: `eq.${activeCallId}`,
                            order: "created_at.asc",
                            limit: 2000,
                        },
                    }).catch(() => []),
                ]);

                if (!alive) return;
                setThread(threads?.[0] ?? null);
                setMessages(msgs ?? []);
            } catch {
                if (!alive) return;
                setThread(null);
                setMessages([]);
            }
        }

        loadConversation();
        return () => {
            alive = false;
        };
    }, [tenantId, activeCallId]);

    useEffect(() => {
        let alive = true;

        async function loadTimeline() {
            if (!lead?.id || !token) {
                setTimeline([]);
                if (lead?.id && !token) setTimelineError("No se detectó sesión para cargar timeline.");
                return;
            }

            setTimelineLoading(true);
            setTimelineError(null);
            try {
                const res = await fetch(`/api/aap/leads/${encodeURIComponent(lead.id)}/timeline?limit=80`, {
                    method: "GET",
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
        }

        loadTimeline();
        return () => {
            alive = false;
        };
    }, [lead?.id, token]);

    const activeCall = useMemo(() => {
        if (!activeCallId) return null;
        return calls.find((c) => c.id === activeCallId) ?? null;
    }, [activeCallId, calls]);

    const playbook = useMemo(() => {
        if (!wow) return null;
        return resolveLeadPlaybook({
            next_best_action: wow.next_best_action,
            priority: wow.priority,
            sla_status: wow.sla_status,
            sla_is_escalated: wow.sla_is_escalated,
            sla_escalation_level: wow.sla_escalation_level,
            work_status: wow.work_status,
            human_takeover_status: wow.human_takeover_status,
            lead_temperature: wow.lead_temperature,
            work_assignee_user_id: wow.work_assignee_user_id,
            work_assignee_label: wow.work_assignee_label,
        });
    }, [wow]);

    const toPhone =
        thread?.customer_phone ||
        thread?.customer_whatsapp_phone ||
        thread?.customer_whatsapp_waid ||
        activeCall?.phone ||
        lead?.phone ||
        "";

    const instance = thread?.campaign_wa_instance || "";
    const isTaken = (thread?.mode || activeCall?.mode || "").toLowerCase() === "human" &&
        (thread?.human_status || activeCall?.human_status || "").toLowerCase() === "active";

    async function refreshLeadSignals() {
        if (!tenantId || !lead?.id) return;
        const [wowRows, callRows] = await Promise.all([
            sbFetch<WowInsight[]>("/rest/v1/v_leads_wow_queue", {
                tenantId,
                query: {
                    select:
                        "id,campaign_id,campaign,phone,phone_norm,lead_score,lead_temperature,priority,sla_due_at,sla_status,sla_is_escalated,sla_escalation_level,work_status,work_assignee_user_id,work_assignee_label,human_takeover_status,human_takeover_by_label,next_best_action,lead_score_reasons",
                    id: `eq.${lead.id}`,
                    limit: 1,
                },
            }).catch(() => []),
            sbFetch<Call[]>("/rest/v1/calls", {
                tenantId,
                query: {
                    select:
                        "id,lead_id,mode,status,created_at,started_at,duration_sec,phone,assigned_channel,human_status,human_taken_by,human_taken_at,human_closed_at",
                    lead_id: `eq.${lead.id}`,
                    order: "created_at.desc",
                    limit: 15,
                },
            }).catch(() => []),
        ]);

        setWow(wowRows?.[0] ?? null);
        setCalls(callRows ?? []);
        if (!activeCallId && callRows?.[0]?.id) {
            setActiveCallId(callRows[0].id);
        }
    }

    async function mutateLead(operation: "assign" | "release" | "set_status" | "takeover_take" | "takeover_release" | "takeover_close", args?: { assignee_user_id?: string; work_status?: WorkStatus; }) {
        if (!lead?.id || !token) return;
        try {
            setMutating(true);
            const res = await fetch("/api/aap/leads/work-queue/assign", {
                method: "POST",
                cache: "no-store",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ lead_id: lead.id, operation, ...args }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(String(body?.error || `HTTP ${res.status}`));
            await refreshLeadSignals();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Error en operación de ownership/takeover");
        } finally {
            setMutating(false);
        }
    }

    async function patchActiveCall(patch: Record<string, unknown>) {
        if (!activeCallId || !tenantId) return;
        await sbFetch("/rest/v1/calls", {
            method: "PATCH",
            tenantId,
            query: { id: `eq.${activeCallId}` },
            body: patch,
            headers: { Prefer: "return=representation" },
        });
        await refreshLeadSignals();
    }

    async function takeConversation() {
        if (!activeCallId) return;
        try {
            await patchActiveCall({
                mode: "human",
                human_status: "active",
                assigned_channel: resolveChannel(activeCall, thread),
                assigned_to: "web",
                handoff_at: new Date().toISOString(),
                human_last_message_at: new Date().toISOString(),
            });
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "No se pudo tomar conversación");
        }
    }

    async function returnToBot() {
        try {
            await patchActiveCall({
                mode: "llm",
                human_status: null,
                assigned_to: null,
                assigned_user_id: null,
            });
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "No se pudo devolver a bot");
        }
    }

    async function closeConversation() {
        try {
            await patchActiveCall({
                human_status: "closed",
                ended_at: new Date().toISOString(),
            });
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "No se pudo cerrar conversación");
        }
    }

    async function sendText() {
        const msg = text.trim();
        if (!msg || !activeCallId) return;
        if (!instance.trim()) {
            setError("No hay wa_instance configurado en campaña para este caso.");
            return;
        }
        if (!toPhone.trim()) {
            setError("No hay teléfono destino para esta conversación.");
            return;
        }

        setSending(true);
        setError(null);
        try {
            const resp = await fetch("/api/aap/wa/outbound", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    call_id: activeCallId,
                    agent_id: "workspace",
                    instance,
                    to: toPhone,
                    text: msg,
                    raw: { source: "omnichannel_workspace" },
                }),
            });
            if (!resp.ok) {
                const payload = await resp.text().catch(() => "");
                throw new Error(payload || `HTTP ${resp.status}`);
            }

            await patchActiveCall({
                mode: "human",
                human_status: "active",
                human_last_message_at: new Date().toISOString(),
            });
            setText("");

            const msgs = await sbFetch<Msg[]>("/rest/v1/call_messages", {
                tenantId,
                query: {
                    select: "id,call_id,role,channel,from_id,from_name,message_text,created_at",
                    call_id: `eq.${activeCallId}`,
                    order: "created_at.asc",
                    limit: 2000,
                },
            }).catch(() => []);
            setMessages(msgs || []);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "No se pudo enviar mensaje");
        } finally {
            setSending(false);
        }
    }

    if (loading || tenantLoading || planLoading) {
        return <LoadingState className="m-6" label="Cargando Omnichannel Workspace..." />;
    }

    if (!workspaceFeatureIncluded) {
        return (
            <div className="m-6 space-y-3">
                <ErrorState
                    title="Omnichannel Workspace no disponible"
                    description={`Tu plan actual (${plan?.plan_name || "Basic"}) no incluye esta feature.`}
                />
                <div className="text-sm flex gap-3 flex-wrap">
                    <Link className="underline" href="/leads/desk">Ir a Human Desk</Link>
                    <Link className="underline" href="/inbox">Ir a Inbox</Link>
                </div>
            </div>
        );
    }

    if (!workspaceFeatureEnabled) {
        return (
            <div className="m-6 space-y-3">
                <ErrorState
                    title="Omnichannel Workspace temporalmente restringido"
                    description={`Estado de suscripción actual: ${subscriptionStatus}. Actualiza el tenant en Configuración de organización.`}
                />
                <div className="text-sm flex gap-3 flex-wrap">
                    <Link className="underline" href="/tenant-settings">Ir a Configuración de organización</Link>
                    <Link className="underline" href="/leads/desk">Ir a Human Desk</Link>
                </div>
            </div>
        );
    }

    if (missingCaseParams) {
        return (
            <div className="m-6 space-y-3">
                <EmptyState
                    title="Selecciona un caso para abrir el workspace"
                    description="Abre un lead desde Human Desk, WOW Detail o Inbox para cargar contexto unificado por caso."
                />
                <div className="text-sm flex gap-3 flex-wrap">
                    <Link className="underline" href="/leads/desk">Ir a Human Desk</Link>
                    <Link className="underline" href="/leads/manager">Ir a Manager View</Link>
                    <Link className="underline" href="/inbox">Ir a Inbox</Link>
                </div>
            </div>
        );
    }
    if (error && !lead) return <ErrorState title="No pudimos abrir el workspace" description={error} className="m-6" />;
    if (!lead) {
        return (
            <EmptyState
                title="Caso no disponible"
                description="No encontramos el lead en el tenant activo o faltan parámetros del caso."
                className="m-6"
            />
        );
    }

    const campaignLabel =
        (lead.campaign_name && lead.campaign_name.trim()) ||
        (lead.campaign && lead.campaign.trim()) ||
        "-";

    const ownerLabel = wow?.work_assignee_label || wow?.work_assignee_user_id || "Sin owner";
    const takeoverLabel = wow?.human_takeover_status || "none";
    const workspaceChannel = resolveChannel(activeCall, thread);

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <div className="text-sm text-muted-foreground">Leads / Omnichannel Conversation Workspace</div>
                    <h1 className="text-2xl font-semibold">Caso · {lead.phone || "Sin teléfono"}</h1>
                    <div className="text-sm text-muted-foreground">
                        {campaignLabel} · canal: {workspaceChannel} · owner: {ownerLabel}
                    </div>
                </div>

                <div className="flex gap-2 flex-wrap text-sm">
                    <Link className="underline" href="/leads/desk">Human Desk</Link>
                    <Link className="underline" href="/inbox">Inbox</Link>
                    <Link className="underline" href={`/leads/wow/view?id=${encodeURIComponent(lead.id)}#wow-insights`}>WOW Detail</Link>
                    {activeCall?.id ? <Link className="underline" href={`/call?id=${encodeURIComponent(activeCall.id)}`}>Call Detail</Link> : null}
                </div>
            </div>

            {error ? <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

            {!canUpdateLeads ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                    Perfil en modo lectura para ownership/takeover. Se mantiene acceso al contexto conversacional.
                </div>
            ) : null}

            <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4">
                <div className="space-y-4">
                    <div className="rounded-xl border p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="font-medium">Conversación / Interacciones</div>
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-muted-foreground">Caso (call)</label>
                                <select
                                    className="border rounded-md px-2 py-1 text-xs"
                                    value={activeCallId || ""}
                                    onChange={(e) => setActiveCallId(e.target.value || null)}
                                >
                                    {calls.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.id.slice(0, 8)} · {formatDatePe(c.created_at)} · {(c.mode || "-").toLowerCase()}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {!activeCall ? (
                            <div className="text-sm text-muted-foreground">Este lead aún no tiene conversación/call vinculada.</div>
                        ) : (
                            <>
                                <div className="text-xs text-muted-foreground">
                                    mode:{" "}<span className="font-mono">{activeCall.mode || "-"}</span> · human_status:{" "}
                                    <span className="font-mono">{thread?.human_status || activeCall.human_status || "-"}</span> · duration: {activeCall.duration_sec ?? "-"}s
                                </div>

                                <div className="flex gap-2 flex-wrap">
                                    <button
                                        className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-50"
                                        disabled={!canUpdateCalls}
                                        onClick={takeConversation}
                                    >
                                        Tomar conversación
                                    </button>
                                    <button
                                        className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-50"
                                        disabled={!canUpdateCalls}
                                        onClick={returnToBot}
                                    >
                                        Volver a bot
                                    </button>
                                    <button
                                        className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-50"
                                        disabled={!canUpdateCalls}
                                        onClick={closeConversation}
                                    >
                                        Cerrar conversación
                                    </button>
                                    <Link className="rounded-md border px-3 py-1.5 text-xs" href={`/inbox/${encodeURIComponent(activeCall.id)}`}>
                                        Abrir en Inbox Detail
                                    </Link>
                                </div>

                                <div className="max-h-[420px] overflow-auto rounded-md border p-3 space-y-2 bg-muted/10">
                                    {!messages.length ? (
                                        <div className="text-sm text-muted-foreground">No hay mensajes persistidos para este call.</div>
                                    ) : (
                                        messages.map((m) => (
                                            <div key={m.id} className="rounded-md border bg-background p-2">
                                                <div className="text-[11px] text-muted-foreground">
                                                    {formatDatePe(m.created_at)} · {m.role} · {m.channel}
                                                    {m.from_id ? ` · ${m.from_id}` : ""}
                                                </div>
                                                <div className="text-sm whitespace-pre-wrap">{m.message_text || "—"}</div>
                                            </div>
                                        ))
                                    )}
                                </div>

                                <div className="rounded-md border p-3 space-y-2">
                                    <div className="text-xs text-muted-foreground">Respuesta rápida (canal actual)</div>
                                    <textarea
                                        className="w-full min-h-[84px] rounded-md border px-3 py-2 text-sm"
                                        value={text}
                                        onChange={(e) => setText(e.target.value)}
                                        placeholder="Escribe una respuesta operativa..."
                                        disabled={!isTaken || !canUpdateCalls}
                                    />
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="text-[11px] text-muted-foreground">
                                            to: <span className="font-mono">{toPhone || "-"}</span> · instance:{" "}
                                            <span className="font-mono">{instance || "-"}</span>
                                        </div>
                                        <button
                                            className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-50"
                                            onClick={sendText}
                                            disabled={sending || !text.trim() || !isTaken || !canUpdateCalls}
                                        >
                                            {sending ? "Enviando..." : "Enviar"}
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="rounded-xl border p-4 space-y-2">
                        <div className="font-medium">Contexto unificado</div>
                        <div className="text-sm"><b>Lead:</b> {lead.id}</div>
                        <div className="text-sm"><b>Campaña:</b> {campaignLabel}</div>
                        <div className="text-sm"><b>Objetivo:</b> {lead.campaign_objective || "-"}</div>
                        <div className="text-sm"><b>Canal:</b> {workspaceChannel}</div>
                        <div className="text-sm"><b>Owner:</b> {ownerLabel}</div>
                        <div className="text-sm"><b>Takeover:</b> {takeoverLabel}</div>
                        <div className="text-sm"><b>Estado trabajo:</b> {wow?.work_status || "queued"}</div>
                        <div className="text-sm"><b>NBA:</b> {wow?.next_best_action || "-"}</div>
                        <div className="text-sm"><b>Prioridad:</b> {wow?.priority || "-"}</div>
                        <div className="text-sm"><b>SLA:</b> {formatDatePe(wow?.sla_due_at)}</div>
                    </div>

                    <div className="rounded-xl border p-4 space-y-3">
                        <div className="font-medium">Ownership / Takeover</div>
                        <select
                            className="w-full rounded-md border px-2 py-2 text-sm"
                            value={selectedAssignee}
                            onChange={(e) => setSelectedAssignee(e.target.value)}
                            disabled={!canUpdateLeads || mutating}
                        >
                            <option value="">Seleccionar owner</option>
                            {members.map((m) => (
                                <option key={m.user_id} value={m.user_id}>
                                    {(m.email || m.user_id) + (m.role ? ` · ${m.role}` : "")}
                                </option>
                            ))}
                        </select>

                        <div className="flex flex-wrap gap-2">
                            <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={!canUpdateLeads || !selectedAssignee || mutating} onClick={() => mutateLead("assign", { assignee_user_id: selectedAssignee })}>Asignar</button>
                            <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={!canUpdateLeads || mutating} onClick={() => mutateLead("release")}>Liberar</button>
                            <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={!canUpdateLeads || mutating} onClick={() => mutateLead("set_status", { work_status: "in_progress" })}>En curso</button>
                            <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={!canUpdateLeads || mutating} onClick={() => mutateLead("set_status", { work_status: "done" })}>Done</button>
                            <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={!canUpdateLeads || mutating} onClick={() => mutateLead("takeover_take")}>Tomar</button>
                            <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={!canUpdateLeads || mutating} onClick={() => mutateLead("takeover_release")}>Soltar</button>
                            <button className="border rounded-md px-2 py-1 text-xs disabled:opacity-50" disabled={!canUpdateLeads || mutating} onClick={() => mutateLead("takeover_close")}>Cerrar takeover</button>
                        </div>
                    </div>

                    <div className="rounded-xl border p-4 space-y-2">
                        <div className="font-medium">Next Best Action</div>
                        {!playbooksEnabled ? (
                            <div className="text-sm text-muted-foreground">Feature NBA/Playbooks disponible en plan superior.</div>
                        ) : !playbook ? (
                            <div className="text-sm text-muted-foreground">Sin recomendación activa para este lead.</div>
                        ) : (
                            <>
                                <div className="flex items-center justify-between gap-2">
                                    <div className="text-sm font-semibold">{playbook.title}</div>
                                    <span className="inline-flex items-center border rounded-full px-2 py-0.5 text-xs">{playbook.severity}</span>
                                </div>
                                <div className="text-xs text-muted-foreground">{playbook.summary}</div>
                            </>
                        )}
                    </div>

                    <div className="rounded-xl border p-4 space-y-2">
                        <div className="font-medium">Timeline</div>
                        {timelineLoading ? <div className="text-sm text-muted-foreground">Cargando timeline...</div> : null}
                        {timelineError ? <div className="text-sm text-red-600">{timelineError}</div> : null}
                        {!timelineLoading && !timelineError && !timeline.length ? (
                            <div className="text-sm text-muted-foreground">Sin eventos en timeline.</div>
                        ) : null}
                        <div className="max-h-80 overflow-auto space-y-2">
                            {timeline.map((ev) => (
                                <div key={ev.id} className="rounded-md border p-2">
                                    <div className="text-xs font-medium">{ev.event_type}</div>
                                    <div className="text-[11px] text-muted-foreground">
                                        {formatDatePe(ev.event_at)} · {ev.actor_label || "system"} · {ev.source}
                                        {ev.derived ? " · derived" : ""}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
