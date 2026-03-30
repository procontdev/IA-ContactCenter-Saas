"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { sbFetch } from "@/lib/supabaseRest";

/** =======================
 *  Types
 *  ======================= */
type CallRow = {
    id: string;
    lead_id: string | null;
    mode: string | null;
    status: string | null;
    started_at: string | null;
    ended_at: string | null;
    duration_sec: number | null;
    created_at: string | null;

    phone: string | null;
    agent_phone: string | null;
    twilio_call_sid: string | null;

    metadata: any; // jsonb

    // handoff/human
    handoff_reason?: string | null;
    handoff_at?: string | null;
    assigned_channel?: string | null;
    assigned_to?: string | null;

    human_status?: string | null;
    human_taken_by?: string | null;
    human_taken_at?: string | null;
    human_first_response_at?: string | null;
    human_response_count?: number | null;
    human_closed_at?: string | null;
    human_last_message_text?: string | null;
    human_last_message_at?: string | null;
};

type RecordingRow = {
    id: string;
    call_id: string;
    recording_url: string | null;
    storage_path: string | null;
    duration_sec: number | null;
    created_at: string | null;
};

type AnalysisRow = {
    call_id: string;
    transcript: string | null;
    summary: string | null;
    intent: string | null;
    sentiment: string | null;
    next_best_action: string | null;
    lead_score: number | null;
    tags: any;
    created_at: string | null;
};

type HumanMsgRow = {
    id: string;
    call_id: string;
    from_chat_id: string;
    from_name: string | null;
    from_role: "advisor" | "customer" | "system";
    message_text: string;
    created_at: string | null;
};

type UnifiedMsg = {
    kind: "llm" | "human" | "event";
    who: "customer" | "ai" | "advisor" | "system";
    ts: string | null; // ISO
    text: string;
    meta?: {
        from_name?: string | null;
        from_chat_id?: string | null;
    };
};

function safeTime(ts?: string | null) {
    if (!ts) return Number.MAX_SAFE_INTEGER;
    const t = new Date(ts).getTime();
    return isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

function fmtTs(ts?: string | null) {
    if (!ts) return "—";
    const d = new Date(ts);
    if (!isFinite(d.getTime())) return "—";
    return d.toLocaleString();
}

/** =======================
 *  Helpers UI
 *  ======================= */
function Badge({ children }: { children: React.ReactNode }) {
    return (
        <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full border">
            {children}
        </span>
    );
}

function guessMimeFromPath(urlOrPath: string | null, fallback: string = "audio/mpeg") {
    if (!urlOrPath) return fallback;
    const clean = urlOrPath.split("?")[0].toLowerCase();
    if (clean.endsWith(".wav")) return "audio/wav";
    if (clean.endsWith(".mp3")) return "audio/mpeg";
    if (clean.endsWith(".m4a")) return "audio/mp4";
    if (clean.endsWith(".ogg")) return "audio/ogg";
    return fallback;
}

function buildPublicStorageUrl(bucket: string, storagePath: string | null) {
    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
    if (!base || !storagePath) return null;

    const normalized = storagePath.startsWith(bucket + "/")
        ? storagePath.slice(bucket.length + 1)
        : storagePath.replace(/^\/+/, "");

    return `${base}/storage/v1/object/public/${bucket}/${normalized}`;
}

function minsBetween(a?: string | null, b?: string | null) {
    if (!a || !b) return null;
    const da = new Date(a).getTime();
    const db = new Date(b).getTime();
    if (!isFinite(da) || !isFinite(db)) return null;
    const diffSec = Math.max(0, Math.floor((da - db) / 1000));
    return Math.round(diffSec / 60);
}

function fmtMins(m: number | null) {
    if (m === null) return "—";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m`;
}

/** =======================
 *  Metadata helpers (jsonb)
 *  ======================= */
function setHumanMeta(meta: any, patch: Record<string, any>) {
    const base = meta && typeof meta === "object" ? meta : {};
    return {
        ...base,
        human: {
            ...(base.human ?? {}),
            ...patch,
        },
    };
}

function setLastSeenInMetadata(meta: any, advisor: string, tsIso: string) {
    const base = meta && typeof meta === "object" ? meta : {};
    const human = base.human && typeof base.human === "object" ? base.human : {};
    const lastSeen =
        human.last_seen_at && typeof human.last_seen_at === "object" ? human.last_seen_at : {};
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

function getCloseReason(call: CallRow) {
    return (call?.metadata?.human?.close_reason || "").toString().trim();
}

function getCloseNotes(call: CallRow) {
    return (call?.metadata?.human?.close_notes || "").toString();
}

/** =======================
 *  n8n notify (close) - opcional
 *  ======================= */
const CLOSE_WEBHOOK_URL =
    process.env.NEXT_PUBLIC_N8N_CLOSE_WEBHOOK ||
    "https://elastica-n8n.3haody.easypanel.host/webhook/notify-close";
const AI_SUGGEST_WEBHOOK_URL =
    process.env.NEXT_PUBLIC_N8N_AI_SUGGEST_WEBHOOK ||
    "https://elastica-n8n.3haody.easypanel.host/webhook/ai-suggest";
const NBA_RECOMPUTE_WEBHOOK_URL =
    process.env.NEXT_PUBLIC_N8N_NBA_RECOMPUTE_WEBHOOK ||
    "https://elastica-n8n.3haody.easypanel.host/webhook/recompute-nba";
const CHECKLIST_RECOMPUTE_WEBHOOK_URL = process.env.NEXT_PUBLIC_CHECKLIST_RECOMPUTE_WEBHOOK_URL ||
    "https://elastica-n8n.3haody.easypanel.host/webhook/recompute-checklist";


/**
 * ✅ (opcional) Webhook para “mensaje desde web -> Telegram”
 * - Define en .env.local: NEXT_PUBLIC_N8N_WEBMSG_WEBHOOK="https://.../webhook/notify-webmsg"
 */
const WEBMSG_WEBHOOK_URL = process.env.NEXT_PUBLIC_N8N_WEBMSG_WEBHOOK || "https://elastica-n8n.3haody.easypanel.host/webhook/webmsg-to-telegram";

const appBaseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL || "http://localhost:3001/";

function getApiKeyOrWarn() {
    const apiKey = process.env.NEXT_PUBLIC_API_KEY || "";
    if (!apiKey) console.warn("NEXT_PUBLIC_API_KEY no está definido; no se puede autenticar el webhook.");
    return apiKey;
}

const DEFAULT_TELEGRAM_CHAT_ID =
    process.env.NEXT_PUBLIC_DEFAULT_TELEGRAM_CHAT_ID || "1376481410"; // 👈 tu chat id demo

async function notifyCloseToTelegram(
    call: CallRow,
    closedBy: string,
    close_reason: string,
    close_notes: string
) {
    const apiKey = getApiKeyOrWarn();
    if (!apiKey) throw new Error("Falta NEXT_PUBLIC_API_KEY (no se puede llamar a n8n)");

    const assignee =
        (call as any)?.assigned_to ||
        (call as any)?.metadata?.human?.assignee_chat_id ||
        (call as any)?.metadata?.assignee_chat_id ||
        DEFAULT_TELEGRAM_CHAT_ID;

    const res = await fetch(CLOSE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
            call_id: call.id,
            lead_id: call.lead_id,
            phone: call.phone,
            closed_by: closedBy,
            close_reason,
            close_notes,
            assignee_chat_id: assignee,
            app_base_url: appBaseUrl,
        }),
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Close webhook error ${res.status}: ${txt}`.trim());
    }
}

async function resolveLeadTelegramChatId(call: CallRow): Promise<string | null> {
    // 1) Si ya lo guardas en la call (recomendado)
    const direct =
        (call as any)?.customer_telegram_chat_id ??
        (call as any)?.customer_telegram_user_id ??
        (call as any)?.metadata?.customer_telegram_chat_id ??
        (call as any)?.metadata?.customer_telegram_user_id ??
        null;

    if (direct) return String(direct);

    // 2) Si viene embebido en metadata
    const metaChat =
        (call as any)?.metadata?.lead?.telegram_chat_id ??
        (call as any)?.metadata?.lead?.telegram_user_id ??
        (call as any)?.metadata?.telegram_chat_id ??
        (call as any)?.metadata?.telegram_user_id ??
        null;

    if (metaChat) return String(metaChat);

    // 3) Fallback: consultar el lead en la BD
    if (!call.lead_id) return null;

    try {
        const rows = await sbFetch<any[]>("/rest/v1/leads", {
            query: {
                select: "telegram_chat_id,telegram_user_id",
                id: `eq.${call.lead_id}`,
                limit: 1,
            },
        });

        const r = rows?.[0];
        const v = r?.telegram_chat_id ?? r?.telegram_user_id ?? null;
        return v ? String(v) : null;
    } catch {
        return null;
    }
}


async function notifyWebMessageToTelegram(args: { call: CallRow; from: string; text: string }) {
    const url = (WEBMSG_WEBHOOK_URL || "").trim();
    if (!url) return; // opcional

    const apiKey = getApiKeyOrWarn();
    if (!apiKey) return;

    // ✅ destino: LEAD (no asesor)
    const lead_chat_id = await resolveLeadTelegramChatId(args.call);
    if (!lead_chat_id) {
        console.warn("No se pudo resolver telegram_chat_id del lead para enviar mensaje al cliente.", {
            call_id: args.call.id,
            lead_id: args.call.lead_id,
        });
        return;
    }

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
            call_id: args.call.id,
            lead_id: args.call.lead_id,
            phone: args.call.phone,

            // ✅ usa este campo como destino (ideal)
            lead_chat_id,

            // 🔁 compatibilidad si tu n8n aún usa assignee_chat_id:
            assignee_chat_id: lead_chat_id,

            from_name: args.from,
            message_text: args.text,
            app_base_url: appBaseUrl,
        }),
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Webhook error ${res.status}: ${txt}`.trim());
    }
}



/** =======================
 *  Templates (Paso A)
 *  ======================= */
const QUICK_TEMPLATES: { label: string; text: (ctx: { phone?: string | null }) => string }[] = [
    {
        label: "✅ Ya te atiendo",
        text: () => "Hola 👋 Soy tu asesor. Ya te estoy atendiendo. ¿Me confirmas tu distrito?",
    },
    {
        label: "📍 Confirmar distrito",
        text: () => "Para ayudarte mejor, ¿me confirmas tu distrito/ciudad?",
    },
    {
        label: "🕒 Llamo en 10 min",
        text: () => "Perfecto. Te llamo en 10 minutos. ¿Te parece bien?",
    },
    {
        label: "📞 Confirmar número",
        text: ({ phone }) => `¿Me confirmas si este es tu número correcto: ${phone || "—"} ?`,
    },
];

/** =======================
 *  Page
 *  ======================= */
function CallPageInner() {
    const sp = useSearchParams();
    const rawId = sp.get("id") || "";
    const id = rawId.replace(/^=+/, "").trim(); // quita "=" iniciales


    const [call, setCall] = useState<CallRow | null>(null);
    const [recordings, setRecordings] = useState<RecordingRow[]>([]);
    const [analysis, setAnalysis] = useState<AnalysisRow | null>(null);

    const [humanMsgs, setHumanMsgs] = useState<HumanMsgRow[]>([]);
    const [newHumanMsg, setNewHumanMsg] = useState("");
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const [aiSuggestions, setAiSuggestions] = useState<
        { title: string; text: string; goal?: string; tags?: string[] }[]
    >([]);
    // ✅ Live refresh solo de mensajes Telegram/web (sin recargar todo)
    const [liveMsgs, setLiveMsgs] = useState(true); // ON por defecto


    // ✅ asesor activo (sin login)
    const ADVISORS = ["asesor_demo", "Ramiro", "Carla"] as const;
    const [activeAdvisor, setActiveAdvisor] = useState<string>(() => {
        if (typeof window === "undefined") return "asesor_demo";
        return localStorage.getItem("activeAdvisor") || "asesor_demo";
    });

    useEffect(() => {
        if (typeof window === "undefined") return;
        localStorage.setItem("activeAdvisor", activeAdvisor);
    }, [activeAdvisor]);

    // ✅ “enviar y marcar visto”
    const [markSeenOnSend, setMarkSeenOnSend] = useState(true);

    // cierre
    const [closeReason, setCloseReason] = useState<string>("Contactado");
    const [closeNotes, setCloseNotes] = useState<string>("");

    const [savingHumanMsg, setSavingHumanMsg] = useState(false);
    const [closing, setClosing] = useState(false);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const convoEndRef = useRef<HTMLDivElement | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(false); // OFF por defecto

    const audioBucket = "recordings";

    // 👇 Intent + NBA desde calls.metadata.assistant
    const assistantNBA = useMemo(() => {
        const a = call?.metadata?.assistant;
        return a && typeof a === "object" ? a : null;
    }, [call?.metadata]);

    // 👇 Wrap-Up + QA desde calls.metadata
    const aiWrapUp = useMemo(() => {
        const w = call?.metadata?.ai_wrapup;
        return w && typeof w === "object" ? w : null;
    }, [call?.metadata]);

    const aiQuality = useMemo(() => {
        const q = call?.metadata?.ai_quality;
        return q && typeof q === "object" ? q : null;
    }, [call?.metadata]);

    const aiChecklist = useMemo(() => {
        const c = call?.metadata?.ai_checklist;
        return c && typeof c === "object" ? c : null;
    }, [call?.metadata]);

    const [checklistLoading, setChecklistLoading] = useState(false);
    const [checklistError, setChecklistError] = useState<string | null>(null);


    const [nbaLoading, setNbaLoading] = useState(false);
    const [nbaError, setNbaError] = useState<string | null>(null);

    function prettyIntent(v: string) {
        const x = (v || "").toString().toLowerCase();
        if (x === "ventas") return "Ventas";
        if (x === "soporte") return "Soporte";
        if (x === "reclamo") return "Reclamo";
        if (x === "info") return "Info";
        return v || "—";
    }

    async function refreshAll() {
        if (!id) return;

        const callRes = await sbFetch<CallRow[]>("/rest/v1/calls", {
            query: {
                select:
                    "id,lead_id,mode,status,started_at,ended_at,duration_sec,created_at,phone,agent_phone,twilio_call_sid,metadata,handoff_reason,handoff_at,assigned_channel,assigned_to,human_status,human_taken_by,human_taken_at,human_first_response_at,human_response_count,human_closed_at,human_last_message_text,human_last_message_at",
                id: `eq.${id}`,
                limit: 1,
            },
        });

        const recRes = await sbFetch<RecordingRow[]>("/rest/v1/recordings", {
            query: { select: "*", call_id: `eq.${id}`, order: "created_at.desc", limit: 10 },
        });

        const anaRes = await sbFetch<AnalysisRow[]>("/rest/v1/call_analysis", {
            query: {
                select: "call_id,transcript,summary,intent,sentiment,next_best_action,lead_score,tags,created_at",
                call_id: `eq.${id}`,
                order: "created_at.desc",
                limit: 1,
            },
        });

        const hmRes = await sbFetch<HumanMsgRow[]>("/rest/v1/call_human_messages", {
            query: {
                select: "id,call_id,from_chat_id,from_name,message_text,from_role,created_at",
                call_id: `eq.${id}`,
                order: "created_at.asc",
                limit: 200,
            },
        });

        const c = callRes?.[0] ?? null;
        setCall(c);
        setRecordings(recRes ?? []);
        setAnalysis(anaRes?.[0] ?? null);
        setHumanMsgs(hmRes ?? []);

        // precargar close reason/notes desde metadata si existe
        if (c) {
            const cr = getCloseReason(c);
            const cn = getCloseNotes(c);
            if (cr) setCloseReason(cr);
            if (cn) setCloseNotes(cn);
        }
    }
    async function recomputeNBA() {
        if (!call) return;

        setNbaLoading(true);
        setNbaError(null);

        try {
            const apiKey = process.env.NEXT_PUBLIC_API_KEY || "";
            if (!apiKey) throw new Error("Falta NEXT_PUBLIC_API_KEY");

            const campaignCode = call?.metadata?.assistant?.campaign?.code || "";

            const lastCustomer = [...(unified || [])]
                .reverse()
                .find((m) => m.who === "customer" && (m.text || "").trim());

            const payload = {
                call_id: call.id,
                lead_id: call.lead_id,
                phone: call.phone,
                advisor: activeAdvisor,
                app_base_url: appBaseUrl,
                context: {
                    stage: call?.metadata?.llm?.stage || "",
                    interest: call?.metadata?.llm?.service_interest || "",
                    campaign_code: campaignCode,
                },
                last_customer_text: lastCustomer?.text || "",
                conversation: (unified || []).slice(-24).map((m) => ({
                    who: m.who,
                    text: m.text,
                    ts: m.ts,
                })),
            };

            const res = await fetch(NBA_RECOMPUTE_WEBHOOK_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const txt = await res.text().catch(() => "");
                throw new Error(`NBA HTTP ${res.status}: ${txt}`.trim());
            }

            // ✅ solo refrescamos assistant (sin recargar todo)
            await refreshAssistantOnly(call.id);
        } catch (e: any) {
            setNbaError(e?.message || "Error recalculando NBA");
        } finally {
            setNbaLoading(false);
        }
    }

    async function recomputeChecklist() {
        if (!call) return;

        setChecklistLoading(true);
        setChecklistError(null);

        try {
            const apiKey = process.env.NEXT_PUBLIC_API_KEY || "";
            if (!apiKey) throw new Error("Falta NEXT_PUBLIC_API_KEY");
            if (!CHECKLIST_RECOMPUTE_WEBHOOK_URL) throw new Error("Falta NEXT_PUBLIC_CHECKLIST_RECOMPUTE_WEBHOOK_URL");

            const payload = {
                call_id: call.id,
                lead_id: call.lead_id,
                phone: call.phone,
                advisor: activeAdvisor,
                app_base_url: appBaseUrl,
                context: {
                    stage: call?.metadata?.llm?.stage || "",
                    interest: call?.metadata?.llm?.service_interest || "",
                },
                conversation: (unified || []).slice(-30).map(m => ({
                    who: m.who,
                    text: m.text,
                    ts: m.ts,
                })),
            };

            const res = await fetch(CHECKLIST_RECOMPUTE_WEBHOOK_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const txt = await res.text().catch(() => "");
                throw new Error(`Checklist HTTP ${res.status}: ${txt}`.trim());
            }

            // refrescar SOLO call (sin recargar toda la página)
            const updated = await sbFetch<CallRow[]>("/rest/v1/calls", {
                query: { select: "*", id: `eq.${call.id}`, limit: 1 },
            });
            setCall(updated?.[0] ?? call);

        } catch (e: any) {
            setChecklistError(e?.message || "Error recalculando checklist");
        } finally {
            setChecklistLoading(false);
        }
    }


    async function refreshHumanMsgsOnly(callId: string) {
        const rows = await sbFetch<HumanMsgRow[]>("/rest/v1/call_human_messages", {
            query: {
                select: "*",
                call_id: `eq.${callId}`,
                order: "created_at.asc",
                limit: 200,
            },
        });
        setHumanMsgs(rows ?? []);
    }

    async function refreshCallHumanLastOnly(callId: string) {
        const rows = await sbFetch<Pick<CallRow, "human_last_message_text" | "human_last_message_at" | "human_status">[]>(
            "/rest/v1/calls",
            { query: { select: "human_last_message_text,human_last_message_at,human_status", id: `eq.${callId}`, limit: 1 } }
        );

        const patch = rows?.[0];
        if (!patch) return;

        setCall((prev) => (prev ? { ...prev, ...patch } : prev));
    }
    useEffect(() => {
        if (!id) return;
        if (!liveMsgs) return;

        let t: any = null;

        const tick = async () => {
            try {
                if (document.visibilityState !== "visible") return;
                // Solo refresca mensajes y “último mensaje humano” (barato y suficiente)
                await Promise.all([
                    refreshHumanMsgsOnly(id),
                    refreshCallHumanLastOnly(id),
                ]);
            } catch {
                // no-op
            }
        };

        // refresco inmediato al activar
        tick();

        t = setInterval(tick, 2500); // cada 2.5s (ajústalo si quieres)

        const onVis = () => {
            if (document.visibilityState === "visible") tick();
        };
        document.addEventListener("visibilitychange", onVis);

        return () => {
            if (t) clearInterval(t);
            document.removeEventListener("visibilitychange", onVis);
        };
    }, [id, liveMsgs]); // eslint-disable-line react-hooks/exhaustive-deps


    async function refreshAssistantOnly(callId: string) {
        const rows = await sbFetch<{ metadata: any }[]>("/rest/v1/calls", {
            query: { select: "metadata", id: `eq.${callId}`, limit: 1 },
        });

        const meta = rows?.[0]?.metadata ?? null;

        // Solo actualizamos metadata del call (no recargamos todo)
        setCall((prev) => (prev ? { ...prev, metadata: meta } : prev));
    }


    async function load() {
        if (!id) return;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
        if (!id || !isUuid) {
            setError("ID de llamada inválido.");
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            await refreshAll();
        } catch (e: any) {
            setError(e?.message || "Error cargando detalle");
        } finally {
            setLoading(false);
        }
    }

    // ✅ Auto-refresh ligero: 15s, solo pestaña visible + refresh inmediato al volver
    useEffect(() => {
        if (!id) return;

        load();

        if (!autoRefresh) return;

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
    }, [id, autoRefresh]);

    const primaryRecording = useMemo(() => recordings?.[0] ?? null, [recordings]);

    const audioUrl = useMemo(() => {
        if (!primaryRecording) return null;
        return buildPublicStorageUrl(audioBucket, primaryRecording.storage_path) || primaryRecording.recording_url;
    }, [primaryRecording]);

    const audioMime = useMemo(() => {
        return guessMimeFromPath(primaryRecording?.storage_path || audioUrl);
    }, [primaryRecording, audioUrl]);

    const kpi = useMemo(() => {
        if (!call) return null;
        const msgCount = typeof call.human_response_count === "number" ? call.human_response_count : null;
        const slaMin = minsBetween(call.human_first_response_at, call.human_taken_at);
        const resolutionMin = call.human_closed_at ? minsBetween(call.human_closed_at, call.human_taken_at) : null;
        return { msgCount, slaMin, resolutionMin };
    }, [call]);

    const replyRef = useRef<HTMLTextAreaElement | null>(null);


    // ✅ Conversación unificada (arreglada: sin duplicar humanMsgs)
    const unified = useMemo<UnifiedMsg[]>(() => {
        const out: UnifiedMsg[] = [];

        const pushEvent = (ts: string | null | undefined, text: string) => {
            if (!ts) return;
            out.push({ kind: "event", who: "system", ts: String(ts), text });
        };

        // 0) Eventos del caso
        if (call) {
            const hr = (call.handoff_reason || "").trim();
            const takenBy = (call.human_taken_by || "").trim();
            const closeReason = (call?.metadata?.human?.close_reason || "").toString().trim();

            pushEvent(
                call.handoff_at,
                `🧑‍💼 Handoff creado${hr ? ` · motivo: ${hr}` : ""}${call.assigned_channel || call.assigned_to
                    ? ` · asignado: ${(call.assigned_channel || "").trim() || "—"}:${(call.assigned_to || "").trim() || "—"
                    }`
                    : ""
                }`,
            );

            pushEvent(call.human_taken_at, `✅ Caso tomado${takenBy ? ` · por: ${takenBy}` : ""}`);

            pushEvent(call.human_closed_at, `🏁 Caso cerrado${closeReason ? ` · motivo: ${closeReason}` : ""}`);
        }

        // 1) LLM turns (Cliente/IA)
        const turns = (call?.metadata?.llm?.turns ?? []) as any[];
        for (const t of turns) {
            const role = (t?.role || "").toString();
            const text = (t?.text || "").toString();
            const ts = t?.ts ? String(t.ts) : null;
            if (!text.trim()) continue;

            out.push({
                kind: "llm",
                who: role === "user" ? "customer" : "ai",
                ts,
                text,
            });
        }

        // 2) Mensajes humanos (tabla: web/telegram)
        for (const m of humanMsgs ?? []) {
            const text = (m?.message_text || "").toString();
            if (!text.trim()) continue;

            const fromChat = String(m?.from_chat_id || "").trim();
            const fromName = String(m?.from_name || "").trim();

            const isSystem = fromChat === "system";

            const assignedTo = String(call?.assigned_to || "").trim(); // chat id del asesor asignado
            const isWeb = fromChat === "web";
            const isAssignedAdvisor = !!assignedTo && fromChat === assignedTo;

            // fallback si el asesor escribe con nombre conocido
            const isKnownAdvisor = (ADVISORS as readonly string[]).includes(fromName);

            const isAdvisorMsg = isWeb || isAssignedAdvisor || isKnownAdvisor;
            const role = (m?.from_role || "advisor").toString();
            const who =
                role === "customer" ? "customer" :
                    role === "system" ? "system" :
                        "advisor";

            out.push({
                kind: role === "system" ? "event" : "human",
                who,
                ts: m?.created_at ? String(m.created_at) : null,
                text,
                meta: { from_name: m?.from_name ?? null, from_chat_id: m?.from_chat_id ?? null },
            });

            // out.push({
            //     kind: isSystem ? "event" : "human",
            //     who: isSystem ? "system" : isAdvisorMsg ? "advisor" : "customer",
            //     ts: m?.created_at ? String(m.created_at) : null,
            //     text,
            //     meta: { from_name: m?.from_name ?? null, from_chat_id: m?.from_chat_id ?? null },
            // });
        }


        out.sort((a, b) => safeTime(a.ts) - safeTime(b.ts));
        return out;
    }, [call, humanMsgs]);

    useEffect(() => {
        convoEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [unified.length]);

    async function copyTelegramCmd() {
        if (!id) return;
        const cmd = `/call ${id} `;
        try {
            await navigator.clipboard.writeText(cmd);
            alert("Copiado ✅ Pégalo en Telegram y escribe tu respuesta después del ID.");
        } catch {
            alert(cmd);
        }
    }

    async function sendHumanMessage(textOverride?: string) {
        if (!id || !call) return;

        const text = (textOverride ?? newHumanMsg).trim();
        if (!text) return;

        setSavingHumanMsg(true);
        try {
            const nowIso = new Date().toISOString();

            // 1) insert msg
            await sbFetch("/rest/v1/call_human_messages", {
                method: "POST",
                query: { select: "id" },
                body: {
                    call_id: id,
                    from_chat_id: "web",
                    from_name: activeAdvisor,
                    from_role: "advisor",
                    message_text: text,
                },
            });

            // 2) update call metrics (+ mark seen)
            const prevCount = typeof call.human_response_count === "number" ? call.human_response_count : 0;
            const firstResp = call.human_first_response_at || nowIso;

            const nextMeta = markSeenOnSend
                ? setLastSeenInMetadata(call.metadata, activeAdvisor, nowIso)
                : call.metadata;

            await sbFetch("/rest/v1/calls?id=eq." + encodeURIComponent(id), {
                method: "PATCH",
                body: {
                    human_last_message_text: text,
                    human_last_message_at: nowIso,
                    human_status: call.human_status === "closed" ? "in_progress" : call.human_status || "in_progress",
                    human_first_response_at: firstResp,
                    human_response_count: prevCount + 1,
                    metadata: nextMeta,
                },
            });

            // 3) opcional: avisar por Telegram (n8n)
            try {
                await notifyWebMessageToTelegram({ call, from: activeAdvisor, text });
            } catch (err: any) {
                console.warn("No se pudo notificar Telegram (webmsg):", err?.message || err);
            }

            setNewHumanMsg("");
            await Promise.all([
                refreshHumanMsgsOnly(call.id),
                refreshCallHumanLastOnly(call.id),
            ]);

        } catch (e: any) {
            alert(e?.message || "Error registrando mensaje");
        } finally {
            setSavingHumanMsg(false);
        }
    }

    async function closeCase() {
        if (!id || !call) return;

        const reason = (closeReason || "").trim();
        if (!reason) {
            alert("Selecciona un motivo de cierre.");
            return;
        }

        setClosing(true);
        try {
            const nowIso = new Date().toISOString();
            const closedBy = activeAdvisor || "asesor_demo";

            const nextMeta = setHumanMeta(call.metadata, {
                close_reason: reason,
                close_notes: (closeNotes || "").trim(),
                closed_by: closedBy,
                closed_at: nowIso,
            });

            await sbFetch("/rest/v1/calls?id=eq." + encodeURIComponent(id), {
                method: "PATCH",
                body: {
                    human_status: "closed",
                    human_closed_at: nowIso,
                    metadata: nextMeta,
                },
            });

            try {
                await notifyCloseToTelegram(
                    { ...call, metadata: nextMeta },
                    closedBy,
                    reason,
                    (closeNotes || "").trim()
                );
            } catch (err: any) {
                console.warn("No se pudo notificar a Telegram (close):", err?.message || err);
            }

            await load();
        } catch (e: any) {
            alert(e?.message || "Error cerrando caso");
        } finally {
            setClosing(false);
        }
    }


    async function fetchAiSuggestions() {
        if (!call) return;

        setAiLoading(true);
        setAiError(null);

        try {
            const apiKey = process.env.NEXT_PUBLIC_API_KEY || "";
            if (!apiKey) throw new Error("Falta NEXT_PUBLIC_API_KEY");

            const payload = {
                call_id: call.id,
                lead_id: call.lead_id,
                phone: call.phone,
                advisor: activeAdvisor,
                context: {
                    stage: call?.metadata?.llm?.stage || "",
                    interest: call?.metadata?.llm?.service_interest || "",
                },
                // mandamos lo último de la conversación unificada
                conversation: (unified || []).slice(-24).map((m) => ({
                    who: m.who,
                    text: m.text,
                    ts: m.ts,
                })),
            };

            const res = await fetch(AI_SUGGEST_WEBHOOK_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const txt = await res.text().catch(() => "");
                throw new Error(`AI suggest HTTP ${res.status}: ${txt}`.trim());
            }

            const data = await res.json();
            setAiSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
        } catch (e: any) {
            setAiError(e?.message || "Error pidiendo sugerencias");
            setAiSuggestions([]);
        } finally {
            setAiLoading(false);
        }
    }

    if (loading) return <div className="p-6">Cargando…</div>;
    if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
    if (!call) return <div className="p-6">Llamada no encontrada.</div>;

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <Link
                        href={call.lead_id ? `/leads/view?id=${encodeURIComponent(call.lead_id)}` : "/leads"}
                        className="text-sm underline"
                    >
                        ← Volver
                    </Link>

                    <h1 className="text-2xl font-semibold mt-2">Detalle de Llamada</h1>

                    <div className="flex flex-wrap gap-2 mt-2">
                        <Badge>Modo: {call.mode ?? "-"}</Badge>
                        <Badge>Estado: {(call.status || "").trim() || "-"}</Badge>
                        <Badge>Duración: {call.duration_sec ?? "-"}s</Badge>
                        {call.twilio_call_sid && <Badge>Twilio: {call.twilio_call_sid}</Badge>}
                        {call.human_status && <Badge>Human: {call.human_status}</Badge>}
                    </div>

                    <div className="text-sm text-muted-foreground mt-2">
                        {call.phone ?? "-"} {call.agent_phone ? `→ ${call.agent_phone}` : ""}
                    </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
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
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                        />
                        Auto-refresh (15s)
                    </label>

                    <button
                        type="button"
                        className="border rounded-md px-3 py-1 text-sm"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            load();
                        }}
                        disabled={loading}
                    >
                        Refrescar
                    </button>
                </div>
            </div>

            {/* KPI mini */}
            <div className="rounded-xl border p-4">
                <div className="font-medium mb-2">Resumen del caso</div>
                <div className="flex flex-wrap gap-2">
                    <Badge>Mensajes asesor: {kpi?.msgCount ?? "—"}</Badge>
                    <Badge>SLA: {fmtMins(kpi?.slaMin ?? null)}</Badge>
                    <Badge>Resolución: {fmtMins(kpi?.resolutionMin ?? null)}</Badge>
                </div>
            </div>

            {/* ✅ Next Best Action + Intent (metadata.assistant) */}
            <div className="rounded-xl border p-4 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="font-medium">Next Best Action (IA)</div>

                    <button
                        type="button"
                        className="border rounded-md px-3 py-1 text-sm"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            recomputeNBA();
                        }}
                        disabled={nbaLoading}
                    >
                        {nbaLoading ? "Recalculando…" : "Recalcular NBA"}
                    </button>

                    <div className="flex flex-wrap gap-2">
                        <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full border">
                            Intent: {assistantNBA?.intent ? prettyIntent(assistantNBA.intent) : "—"}
                        </span>
                        <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full border">
                            NBA: {assistantNBA?.next_best_action || "—"}
                        </span>
                    </div>
                </div>

                {nbaError && <div className="text-sm text-red-600">{nbaError}</div>}

                {assistantNBA?.suggested_reply ? (
                    <div className="text-sm">
                        <div className="text-xs text-muted-foreground mb-1">Respuesta sugerida</div>
                        <div className="whitespace-pre-wrap border rounded-lg p-3 bg-muted/10">
                            {assistantNBA.suggested_reply}
                        </div>

                        <div className="flex gap-2 flex-wrap mt-2">
                            <button
                                type="button"
                                className="border rounded-md px-3 py-1 text-sm"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();

                                    const txt = String(assistantNBA?.suggested_reply || "");
                                    if (!txt.trim()) return;

                                    try {
                                        setNewHumanMsg(txt);
                                    } catch { }

                                    if (replyRef.current) {
                                        replyRef.current.value = txt;
                                        replyRef.current.dispatchEvent(new Event("input", { bubbles: true }));
                                        replyRef.current.focus();
                                    }
                                }}
                            >
                                Insertar
                            </button>

                            <button
                                type="button"
                                className="border rounded-md px-3 py-1 text-sm"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    sendHumanMessage(String(assistantNBA.suggested_reply || ""));
                                }}
                                disabled={!String(assistantNBA.suggested_reply || "").trim()}
                            >
                                Usar y enviar
                            </button>
                        </div>

                        {assistantNBA.computed_at && (
                            <div className="text-xs text-muted-foreground mt-1">
                                Actualizado: {fmtTs(assistantNBA.computed_at)}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-sm text-muted-foreground">
                        Aún no hay NBA calculado. Presiona <b>Recalcular NBA</b>.
                    </div>
                )}
            </div>
            <div className="rounded-xl border overflow-hidden">
                <div className="p-3 font-medium bg-muted/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span>✅</span>
                        <span>Checklist IA (datos faltantes)</span>
                    </div>

                    <button
                        type="button"
                        onClick={recomputeChecklist}
                        disabled={checklistLoading || !call}
                        className="text-xs underline disabled:opacity-50"
                    >
                        {checklistLoading ? "Recalculando..." : "Recalcular checklist"}
                    </button>
                </div>

                <div className="p-4 space-y-3 text-sm">
                    {checklistError && (
                        <div className="text-sm text-red-600">{checklistError}</div>
                    )}

                    {!aiChecklist ? (
                        <div className="text-muted-foreground">
                            Aún no hay checklist. Haz click en “Recalcular checklist”.
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {[
                                    ["telefono_confirmado", "Teléfono confirmado"],
                                    ["distrito", "Distrito"],
                                    ["direccion", "Dirección"],
                                    ["velocidad", "Velocidad"],
                                    ["horario", "Horario"],
                                    ["operador", "Operador"],
                                    ["tipo_plan", "Tipo de plan"],
                                ].map(([k, label]) => {
                                    const ex = aiChecklist.extracted || {};
                                    const v =
                                        k === "telefono_confirmado"
                                            ? (ex.telefono_confirmado ? "Sí" : "")
                                            : String(ex[k] || "").trim();

                                    const ok = k === "telefono_confirmado" ? !!ex.telefono_confirmado : !!v;

                                    return (
                                        <div key={k} className="rounded-lg border p-2">
                                            <div className="flex items-center justify-between">
                                                <div className="text-xs text-muted-foreground">{label}</div>
                                                <div className="text-xs">{ok ? "✅" : "⬜"}</div>
                                            </div>
                                            <div className="mt-1">{ok ? v || "Sí" : <span className="text-muted-foreground">—</span>}</div>
                                        </div>
                                    );
                                })}
                            </div>

                            {aiChecklist.next_question && (
                                <div className="rounded-lg border p-3">
                                    <div className="font-medium mb-1">Siguiente pregunta sugerida</div>
                                    <div className="text-muted-foreground whitespace-pre-wrap">{aiChecklist.next_question}</div>

                                    <div className="mt-2 flex gap-2">
                                        <button
                                            type="button"
                                            className="text-xs underline"
                                            onClick={() => navigator.clipboard.writeText(String(aiChecklist.next_question))}
                                        >
                                            Copiar
                                        </button>
                                        <button
                                            type="button"
                                            className="text-xs underline"
                                            onClick={() => setNewHumanMsg(String(aiChecklist.next_question))}
                                        >
                                            Usar como borrador
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="text-xs text-muted-foreground">
                                Conf: {Number(aiChecklist.confidence ?? 0).toFixed(2)} ·{" "}
                                {aiChecklist.computed_at ? new Date(String(aiChecklist.computed_at)).toLocaleString() : ""}
                            </div>
                        </>
                    )}
                </div>
            </div>
            {/* Conversación unificada */}
            <div className="rounded-xl border p-4 space-y-3">
                <div className="font-medium">Conversación (Cliente · IA · Asesor)</div>

                {unified.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Aún no hay mensajes para mostrar.</div>
                ) : (
                    <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                        {unified.map((m, idx) => {
                            const isCustomer = m.who === "customer";
                            const isAI = m.who === "ai";
                            const isAdvisor = m.who === "advisor";

                            const align = isCustomer ? "justify-end" : "justify-start";
                            if (m.kind === "event") {
                                return (
                                    <div key={`event-${idx}-${m.ts || idx}`} className="flex justify-center">
                                        <div className="text-xs text-muted-foreground border rounded-full px-3 py-1 bg-muted/20">
                                            {m.text} {" · "} {fmtTs(m.ts)}
                                        </div>
                                    </div>
                                );
                            }

                            const bubble = isCustomer
                                ? "border rounded-2xl px-3 py-2 max-w-[80%] bg-muted/20"
                                : isAI
                                    ? "border rounded-2xl px-3 py-2 max-w-[80%] bg-muted/10"
                                    : "border rounded-2xl px-3 py-2 max-w-[80%]";

                            const label = isCustomer ? "Cliente" : isAI ? "IA" : m.meta?.from_name || "Asesor";
                            const sub = isAdvisor && m.meta?.from_chat_id ? ` · chat:${m.meta.from_chat_id}` : "";

                            const keyBase =
                                (m.kind === "human" ? m.meta?.from_chat_id || "human" : m.who) + "|" + (m.ts || "") + "|" + idx;

                            return (
                                <div key={keyBase} className={`flex ${align}`}>
                                    <div className={bubble}>
                                        <div className="text-xs text-muted-foreground mb-1">
                                            {label}
                                            {sub}
                                            {" · "}
                                            {fmtTs(m.ts)}
                                        </div>
                                        <div className="text-sm whitespace-pre-wrap">{m.text}</div>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={convoEndRef} />
                    </div>
                )}

                <div className="text-xs text-muted-foreground">
                    Fuente: <span className="font-mono">metadata.llm.turns</span> +{" "}
                    <span className="font-mono">call_human_messages</span>
                </div>
            </div>

            {/* Plantillas rápidas */}
            <div className="rounded-xl border p-4 space-y-3">
                <div className="font-medium">Plantillas rápidas</div>
                <div className="flex flex-wrap gap-2">
                    {QUICK_TEMPLATES.map((t) => (
                        <button
                            key={t.label}
                            type="button"
                            className="border rounded-md px-3 py-1 text-sm"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setNewHumanMsg(t.text({ phone: call.phone }));
                            }}
                        >
                            {t.label}
                        </button>
                    ))}
                    <button
                        type="button"
                        className="border rounded-md px-3 py-1 text-sm"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            sendHumanMessage(QUICK_TEMPLATES[0].text({ phone: call.phone }));
                        }}
                        disabled={savingHumanMsg}
                        title="Envía inmediatamente 'Ya te atiendo'"
                    >
                        Enviar “Ya te atiendo”
                    </button>
                </div>
                <div className="text-xs text-muted-foreground">
                    Tip: puedes clickear una plantilla para cargarla en el textarea y editarla antes de enviar.
                </div>
            </div>

            {/* Copiloto IA */}
            <div className="rounded-xl border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="font-medium">Copiloto IA</div>
                    <button
                        type="button"
                        className="border rounded-md px-3 py-1 text-sm"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            fetchAiSuggestions();
                        }}
                        disabled={aiLoading}
                        title="Genera 3 sugerencias en base a la conversación"
                    >
                        {aiLoading ? "Generando…" : "Sugerir respuesta IA"}
                    </button>
                </div>

                {aiError && <div className="text-sm text-red-600">{aiError}</div>}

                {aiSuggestions.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                        {aiLoading ? "Procesando sugerencias…" : "Sin sugerencias aún. Presiona “Sugerir respuesta IA”."}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {aiSuggestions.map((s, idx) => (
                            <div key={idx} className="border rounded-lg p-3">
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <div className="font-medium text-sm">{s.title || `Sugerencia ${idx + 1}`}</div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            className="border rounded-md px-3 py-1 text-sm"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setNewHumanMsg(s.text);
                                                if (replyRef.current) replyRef.current.focus();
                                            }}
                                            title="Insertar en el textarea"
                                        >
                                            Insertar
                                        </button>
                                        <button
                                            type="button"
                                            className="border rounded-md px-3 py-1 text-sm"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                sendHumanMessage(s.text);
                                            }}
                                            title="Enviar directamente"
                                        >
                                            Usar y enviar
                                        </button>
                                    </div>
                                </div>

                                <div className="text-sm whitespace-pre-wrap mt-2">{s.text}</div>

                                {(s.tags?.length || 0) > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        {s.tags!.slice(0, 6).map((t, j) => (
                                            <span key={j} className="text-xs px-2 py-0.5 rounded-full border">
                                                {t}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Mensajes del asesor */}
            <div className="rounded-xl border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="font-medium">Mensajes del asesor (Telegram)</div>
                    <button
                        type="button"
                        className="border rounded-md px-3 py-1 text-sm"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            copyTelegramCmd();
                        }}
                    >
                        Copiar /call
                    </button>
                </div>

                <div className="text-sm text-muted-foreground">
                    Formato: <span className="font-mono">/call {call.id} &lt;mensaje&gt;</span>
                </div>

                {humanMsgs.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Aún no hay mensajes del asesor registrados.</div>
                ) : (
                    <div className="space-y-3">
                        {humanMsgs.map((m) => (
                            <div key={m.id} className="rounded-lg border p-3">
                                <div className="text-xs text-muted-foreground mb-1">
                                    {(m.from_name || "asesor") + " · "}
                                    {m.created_at ? new Date(m.created_at).toLocaleString() : "-"}
                                    {" · chat:"}
                                    {m.from_chat_id}
                                </div>
                                <div className="text-sm whitespace-pre-wrap">{m.message_text}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Registrar nota desde la web */}
            <div className="rounded-xl border p-4 space-y-2">
                <div className="font-medium">Registrar mensaje (desde la web)</div>

                <div className="flex items-center gap-3 flex-wrap">
                    <label className="text-sm flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={markSeenOnSend}
                            onChange={(e) => setMarkSeenOnSend(e.target.checked)}
                        />
                        Marcar visto al enviar
                    </label>

                    {WEBMSG_WEBHOOK_URL ? (
                        <span className="text-xs text-muted-foreground">Webhook web→Telegram: activo</span>
                    ) : (
                        <span className="text-xs text-muted-foreground">Webhook web→Telegram: no configurado</span>
                    )}
                </div>

                <textarea
                    ref={replyRef}
                    className="w-full border rounded-md p-2 text-sm bg-background"
                    rows={3}
                    value={newHumanMsg}
                    onChange={(e) => setNewHumanMsg(e.target.value)}
                    placeholder="Escribe una respuesta del asesor…"
                />

                <div className="flex gap-2 flex-wrap">
                    <button
                        type="button"
                        className="border rounded-md px-3 py-1 text-sm"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            sendHumanMessage();
                        }}
                        disabled={savingHumanMsg || !newHumanMsg.trim()}
                    >
                        {savingHumanMsg ? "Enviando…" : "Enviar"}
                    </button>
                </div>
            </div>

            {/* Cerrar con motivo */}
            <div className="rounded-xl border p-4 space-y-2">
                <div className="font-medium">Cierre del caso</div>

                <div className="flex gap-3 flex-wrap items-center">
                    <label className="text-sm">
                        Motivo:&nbsp;
                        <select
                            className="border rounded-md px-2 py-1 bg-background"
                            value={closeReason}
                            onChange={(e) => setCloseReason(e.target.value)}
                        >
                            <option value="Contactado">Contactado</option>
                            <option value="No contesta">No contesta</option>
                            <option value="Fuera de cobertura">Fuera de cobertura</option>
                            <option value="Venta cerrada">Venta cerrada</option>
                            <option value="Derivar a soporte">Derivar a soporte</option>
                            <option value="Otro">Otro</option>
                        </select>
                    </label>

                    <Badge>Estado: {call.human_status || "—"}</Badge>
                    {call.human_closed_at && <Badge>Cerrado: {new Date(call.human_closed_at).toLocaleString()}</Badge>}
                </div>

                <textarea
                    className="w-full border rounded-md p-2 text-sm bg-background"
                    rows={2}
                    value={closeNotes}
                    onChange={(e) => setCloseNotes(e.target.value)}
                    placeholder="Nota de cierre (opcional)…"
                />

                <div className="flex gap-2 flex-wrap">
                    <button
                        type="button"
                        className="border rounded-md px-3 py-1 text-sm"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            closeCase();
                        }}
                        disabled={closing}
                    >
                        {closing ? "Cerrando…" : "Cerrar caso"}
                    </button>
                </div>

                <div className="text-xs text-muted-foreground">
                    Se guarda en <span className="font-mono">calls.metadata.human.close_reason / close_notes</span>.
                </div>
            </div>

            {/* Audio */}
            <div className="rounded-xl border p-4 space-y-3">
                <div className="font-medium">Grabación</div>

                {audioUrl ? (
                    <div className="space-y-2">
                        <audio key={audioUrl} controls preload="metadata" className="w-full">
                            <source src={audioUrl} type={audioMime} />
                            Tu navegador no soporta audio HTML5.
                        </audio>

                        <div className="flex items-center justify-between gap-3">
                            <div className="text-xs text-muted-foreground break-all">Fuente: {audioUrl}</div>
                            <a className="text-xs underline" href={audioUrl} target="_blank" rel="noreferrer">
                                Abrir
                            </a>
                        </div>
                    </div>
                ) : (
                    <div className="text-sm text-muted-foreground">Aún no hay grabación asociada a esta llamada.</div>
                )}
            </div>

            {/* IA Analysis */}
            <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-xl border p-4 space-y-2">
                    <div className="font-medium">Análisis IA</div>

                    {analysis ? (
                        <>
                            <div className="flex flex-wrap gap-2">
                                {analysis.sentiment && <Badge>Sentiment: {analysis.sentiment}</Badge>}
                                {typeof analysis.lead_score === "number" && <Badge>Score: {analysis.lead_score}</Badge>}
                                {analysis.intent && <Badge>Intent: {analysis.intent}</Badge>}
                            </div>

                            {analysis.summary && (
                                <div className="text-sm">
                                    <div className="font-medium mt-2">Resumen</div>
                                    <p className="text-muted-foreground">{analysis.summary}</p>
                                </div>
                            )}

                            {analysis.next_best_action && (
                                <div className="text-sm">
                                    <div className="font-medium mt-2">Siguiente mejor acción</div>
                                    <p className="text-muted-foreground">{analysis.next_best_action}</p>
                                </div>
                            )}

                            {analysis.tags && Array.isArray(analysis.tags) && analysis.tags.length > 0 && (
                                <div className="text-sm">
                                    <div className="font-medium mt-2">Tags</div>
                                    <div className="flex flex-wrap gap-2 mt-1">
                                        {analysis.tags.map((t: string, idx: number) => (
                                            <Badge key={`${t}-${idx}`}>{t}</Badge>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="text-sm text-muted-foreground">Aún no hay análisis para esta llamada (o está en proceso).</div>
                    )}
                </div>
                {/* =========================
                    🧠 AI Wrap-Up + 🎧 QA Asesor
                    ========================= */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* AI WRAP-UP */}
                    <div className="rounded-xl border overflow-hidden">
                        <div className="p-3 font-medium bg-muted/50 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span>🧠</span>
                                <span>AI Wrap-Up (cierre)</span>
                            </div>

                            {/* Si luego agregas botón recalcular, aquí queda perfecto */}
                            {/* <button type="button" className="text-xs underline">Recalcular</button> */}
                        </div>

                        {!aiWrapUp ? (
                            <div className="p-4 text-sm text-muted-foreground">
                                Aún no hay wrap-up IA para este caso. Se genera al cerrar el caso (workflow de Close).
                            </div>
                        ) : (
                            <div className="p-4 space-y-3 text-sm">
                                {aiWrapUp.summary && (
                                    <div>
                                        <div className="font-medium">Resumen</div>
                                        <div className="text-muted-foreground whitespace-pre-wrap">{String(aiWrapUp.summary)}</div>
                                    </div>
                                )}

                                <div className="flex flex-wrap gap-2">
                                    {aiWrapUp.intent && (
                                        <span className="px-2 py-1 rounded-full border text-xs">🎯 Intent: {String(aiWrapUp.intent)}</span>
                                    )}
                                    {aiWrapUp.stage && (
                                        <span className="px-2 py-1 rounded-full border text-xs">🧭 Etapa: {String(aiWrapUp.stage)}</span>
                                    )}
                                    {aiWrapUp.sentiment && (
                                        <span className="px-2 py-1 rounded-full border text-xs">🙂 {String(aiWrapUp.sentiment)}</span>
                                    )}
                                    {typeof aiWrapUp.confidence !== "undefined" && (
                                        <span className="px-2 py-1 rounded-full border text-xs">
                                            ✅ Conf: {Number(aiWrapUp.confidence).toFixed(2)}
                                        </span>
                                    )}
                                </div>

                                {/* Entities */}
                                {aiWrapUp.entities && typeof aiWrapUp.entities === "object" && (
                                    <div>
                                        <div className="font-medium">Datos detectados</div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                                            {Object.entries(aiWrapUp.entities).map(([k, v]) => {
                                                const val = String(v ?? "").trim();
                                                if (!val) return null;
                                                return (
                                                    <div key={k} className="rounded-lg border p-2">
                                                        <div className="text-xs text-muted-foreground">{k}</div>
                                                        <div className="text-sm">{val}</div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Objections */}
                                {Array.isArray(aiWrapUp.objections) && aiWrapUp.objections.length > 0 && (
                                    <div>
                                        <div className="font-medium">Objeciones</div>
                                        <div className="flex flex-wrap gap-2 mt-2">
                                            {aiWrapUp.objections.slice(0, 10).map((o: any, idx: number) => (
                                                <span key={idx} className="px-2 py-1 rounded-full bg-muted text-xs">
                                                    {String(o)}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Next step */}
                                {aiWrapUp.next_step && (
                                    <div>
                                        <div className="font-medium">Siguiente paso</div>
                                        <div className="text-muted-foreground whitespace-pre-wrap">{String(aiWrapUp.next_step)}</div>
                                    </div>
                                )}

                                {/* Tags */}
                                {Array.isArray(aiWrapUp.tags) && aiWrapUp.tags.length > 0 && (
                                    <div>
                                        <div className="font-medium">Tags</div>
                                        <div className="flex flex-wrap gap-2 mt-2">
                                            {aiWrapUp.tags.slice(0, 12).map((t: any, idx: number) => (
                                                <span key={idx} className="px-2 py-1 rounded-full border text-xs">
                                                    #{String(t)}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {aiWrapUp.computed_at && (
                                    <div className="text-xs text-muted-foreground">
                                        Calculado: {new Date(String(aiWrapUp.computed_at)).toLocaleString()}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* QA ASESOR */}
                    <div className="rounded-xl border overflow-hidden">
                        <div className="p-3 font-medium bg-muted/50 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span>🎧</span>
                                <span>QA del asesor</span>
                            </div>
                        </div>

                        {!aiQuality ? (
                            <div className="p-4 text-sm text-muted-foreground">
                                Aún no hay QA IA para este caso. Se genera al cerrar el caso (workflow de Close).
                            </div>
                        ) : (
                            <div className="p-4 space-y-3 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="font-medium">Score</div>
                                    <div className="text-lg font-semibold">{Number(aiQuality.score ?? 0)}</div>
                                </div>

                                <div className="w-full h-2 rounded bg-muted overflow-hidden">
                                    <div
                                        className="h-2 rounded bg-foreground"
                                        style={{ width: `${Math.max(0, Math.min(100, Number(aiQuality.score ?? 0)))}%` }}
                                    />
                                </div>

                                {aiQuality.summary && (
                                    <div>
                                        <div className="font-medium">Resumen QA</div>
                                        <div className="text-muted-foreground whitespace-pre-wrap">{String(aiQuality.summary)}</div>
                                    </div>
                                )}

                                {Array.isArray(aiQuality.strengths) && aiQuality.strengths.length > 0 && (
                                    <div>
                                        <div className="font-medium">Fortalezas</div>
                                        <ul className="list-disc pl-5 mt-2 text-muted-foreground space-y-1">
                                            {aiQuality.strengths.slice(0, 5).map((s: any, idx: number) => (
                                                <li key={idx}>{String(s)}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {Array.isArray(aiQuality.improvements) && aiQuality.improvements.length > 0 && (
                                    <div>
                                        <div className="font-medium">Mejoras</div>
                                        <ul className="list-disc pl-5 mt-2 text-muted-foreground space-y-1">
                                            {aiQuality.improvements.slice(0, 5).map((s: any, idx: number) => (
                                                <li key={idx}>{String(s)}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {Array.isArray(aiQuality.compliance_flags) && aiQuality.compliance_flags.length > 0 && (
                                    <div>
                                        <div className="font-medium">Flags</div>
                                        <div className="flex flex-wrap gap-2 mt-2">
                                            {aiQuality.compliance_flags.slice(0, 10).map((f: any, idx: number) => (
                                                <span key={idx} className="px-2 py-1 rounded-full bg-muted text-xs">
                                                    {String(f)}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="flex flex-wrap gap-2">
                                    {typeof aiQuality.confidence !== "undefined" && (
                                        <span className="px-2 py-1 rounded-full border text-xs">
                                            ✅ Conf: {Number(aiQuality.confidence).toFixed(2)}
                                        </span>
                                    )}
                                </div>

                                {aiQuality.computed_at && (
                                    <div className="text-xs text-muted-foreground">
                                        Calculado: {new Date(String(aiQuality.computed_at)).toLocaleString()}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>



                <div className="rounded-xl border p-4 space-y-2">
                    <div className="font-medium">Transcripción</div>
                    {analysis?.transcript ? (
                        <pre className="text-sm whitespace-pre-wrap text-muted-foreground">{analysis.transcript}</pre>
                    ) : (
                        <div className="text-sm text-muted-foreground">Aún no hay transcripción asociada (o está en proceso).</div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function CallPage() {
    return (
        <Suspense fallback={<div className="p-6">Cargando…</div>}>
            <CallPageInner />
        </Suspense>
    );
}
