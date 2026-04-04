"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { sbFetch } from "@/lib/supabaseRest";
import { useTenant } from "@/lib/tenant/use-tenant";

type Thread = {
  call_id: string;
  lead_id: string | null;
  campaign_id: string | null;
  campaign_code: string | null;
  campaign_name: string | null;

  channel: string | null;
  mode: string | null; // "llm" | "human" | null
  human_status: string | null; // "pending" | "active" | "closed" | null

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
  external_id: string | null;
  instance: string | null;
};

function fmtTime(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function normalizeParam(v: string | string[] | undefined): string {
  if (!v) return "";
  return Array.isArray(v) ? String(v[0] ?? "") : String(v);
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function TimeText({ iso }: { iso?: string | null }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <span suppressHydrationWarning>{mounted ? fmtTime(iso) : ""}</span>;
}

export default function InboxDetailPage() {
  const params = useParams();
  const { context, loading: tenantLoading } = useTenant();
  const tenantId = context?.tenantId || undefined;
  const callId = normalizeParam((params as any)?.callid);

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  // ✅ evita marcar leído en loop (1 vez por callId)
  const didMarkReadRef = useRef(false);

  async function loadAll(id?: string) {
    const cid = (id ?? callId ?? "").trim();
    if (!cid) {
      setError("callId vacío");
      return null;
    }
    if (!isUuid(cid)) {
      setError("callId inválido (no es UUID).");
      return null;
    }

    setError(null);
    setLoading(true);
    try {
      const t = await sbFetch<Thread[]>("/rest/v1/v_inbox_threads", {
        tenantId,
        query: {
          select:
            "call_id,lead_id,campaign_id,campaign_code,campaign_name,channel,mode,human_status," +
            "customer_phone,customer_whatsapp_phone,customer_whatsapp_waid," +
            "campaign_wa_instance,campaign_wa_business_phone",
          call_id: `eq.${cid}`,
          limit: 1,
        },
      });

      const threadRow = t?.[0] ?? null;
      setThread(threadRow);

      const ms = await sbFetch<Msg[]>("/rest/v1/call_messages", {
        tenantId,
        query: {
          select: "id,call_id,role,channel,from_id,from_name,message_text,created_at,external_id,instance",
          call_id: `eq.${cid}`,
          order: "created_at.asc",
          limit: 2000,
        },
      });
      setMessages(ms ?? []);

      return threadRow;
    } catch (e: any) {
      setError(e?.message ?? String(e));
      return null;
    } finally {
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  async function patchCall(cid: string, patch: any) {
    const id = (cid ?? "").trim();
    if (!id) throw new Error("callId vacío");
    if (!isUuid(id)) throw new Error("callId inválido (no es UUID).");
    if (tenantLoading || !tenantId) throw new Error("tenantId no disponible");

    await sbFetch("/rest/v1/calls", {
      method: "PATCH",
      tenantId,
      query: { id: `eq.${id}` },
      headers: { Prefer: "return=representation" },
      body: patch,
    });
  }

  async function markRead(cid?: string) {
    const id = (cid ?? callId ?? "").trim();
    if (!id || !isUuid(id)) return;
    await patchCall(id, { human_last_seen_at: new Date().toISOString() });
  }

  useEffect(() => {
    if (tenantLoading || !tenantId) return;
    // reset por cada callId
    didMarkReadRef.current = false;

    (async () => {
      const cid = (callId ?? "").trim();
      const t = await loadAll(cid);

      // ✅ FIX: marcar leído al abrir el detalle (pending/active/llm igual)
      // (solo 1 vez por apertura)
      if (!didMarkReadRef.current) {
        try {
          didMarkReadRef.current = true;
          await markRead(cid);
        } catch (e: any) {
          // no tragar silencioso
          console.error("[inbox] markRead failed:", e);
          setError((prev) => prev ?? (e?.message ?? String(e)));
        }
      }

      // refresca datos para que la vista/listado refleje el cambio
      await loadAll(cid);
    })().catch((e) => {
      console.error("[inbox] load failed:", e);
      setError((prev) => prev ?? (e?.message ?? String(e)));
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, tenantLoading, tenantId]);

  const toPhone = useMemo(() => {
    return (
      thread?.customer_phone ??
      thread?.customer_whatsapp_phone ??
      thread?.customer_whatsapp_waid ??
      ""
    );
  }, [thread]);

  const instance = useMemo(() => {
    return thread?.campaign_wa_instance ?? "";
  }, [thread]);

  const humanStatus = useMemo(() => String(thread?.human_status ?? ""), [thread]);
  const mode = useMemo(() => String(thread?.mode ?? ""), [thread]);

  const isTaken = useMemo(() => mode === "human" && humanStatus === "active", [mode, humanStatus]);
  const isHandoffPending = useMemo(() => humanStatus === "pending", [humanStatus]);

  const showTake = useMemo(() => !isTaken, [isTaken]);
  const showReturnToBot = useMemo(() => isTaken, [isTaken]);
  const showClose = useMemo(() => isTaken, [isTaken]);
  const canCompose = useMemo(() => isTaken, [isTaken]);

  async function sendText() {
    const msg = text.trim();
    if (!msg) return;

    const cid = (callId ?? "").trim();
    if (!cid) {
      setError("callId vacío");
      return;
    }
    if (!isUuid(cid)) {
      setError("callId inválido (no es UUID).");
      return;
    }

    if (!canCompose) {
      setError("Para responder manualmente primero debes presionar “Tomar”.");
      return;
    }

    if (!instance.trim()) {
      setError("No hay wa_instance configurado en la campaña.");
      return;
    }
    if (!toPhone.trim() || toPhone.trim() === "—") {
      setError("No hay teléfono destino (to) para esta conversación.");
      return;
    }

    setError(null);
    setSending(true);
    try {
      const resp = await fetch("/api/aap/wa/outbound", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          call_id: cid,
          agent_id: "web",
          instance,
          to: toPhone,
          text: msg,
          raw: { source: "web_inbox" },
        }),
      });

      if (!resp.ok) {
        const contentType = resp.headers.get("content-type") || "";
        const payload = contentType.includes("application/json") ? await resp.json() : await resp.text();
        const msgErr = typeof payload === "string" ? payload : (payload?.message ?? JSON.stringify(payload));
        throw new Error(msgErr);
      }

      await patchCall(cid, {
        mode: "human",
        human_status: "active",
        human_last_message_at: new Date().toISOString(),
      });

      setText("");

      // ✅ al enviar, también marcamos visto “hasta ahora”
      await markRead(cid);

      await loadAll(cid);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSending(false);
    }
  }

  async function takeConversation() {
    setError(null);
    const cid = (callId ?? "").trim();
    if (!cid || !isUuid(cid)) {
      setError("callId inválido (no es UUID).");
      return;
    }

    try {
      setThread((t) => (t ? { ...t, mode: "human", human_status: "active" } : t));

      await patchCall(cid, {
        mode: "human",
        human_status: "active",
        assigned_channel: "whatsapp",
        assigned_to: "web",
        handoff_at: new Date().toISOString(),
        human_last_message_at: new Date().toISOString(),
      });

      // ✅ si la estás tomando, ya la estás viendo → marcar leído
      await markRead(cid);

      await loadAll(cid);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function closeConversation() {
    setError(null);
    const cid = (callId ?? "").trim();
    if (!cid || !isUuid(cid)) {
      setError("callId inválido (no es UUID).");
      return;
    }

    try {
      await patchCall(cid, {
        human_status: "closed",
        ended_at: new Date().toISOString(),
      });
      await loadAll(cid);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function returnToBot() {
    setError(null);
    const cid = (callId ?? "").trim();
    if (!cid || !isUuid(cid)) {
      setError("callId inválido (no es UUID).");
      return;
    }

    try {
      setThread((t) => (t ? { ...t, mode: "llm", human_status: null } : t));

      await patchCall(cid, {
        mode: "llm",
        human_status: null,
        assigned_to: null,
        assigned_user_id: null,
      });

      await loadAll(cid);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm text-muted-foreground">
            <Link href="/inbox" className="hover:underline">Inbox</Link> / {callId || "—"}
          </div>

          <h1 className="text-2xl font-semibold">
            {thread?.customer_phone ?? thread?.customer_whatsapp_phone ?? thread?.customer_whatsapp_waid ?? "Conversación"}
          </h1>

          <div className="text-sm text-muted-foreground">
            {thread?.campaign_code ? `${thread.campaign_code} · ` : ""}{thread?.campaign_name ?? "—"} · {thread?.channel ?? "—"}
          </div>

          {thread?.lead_id ? (
            <div className="text-xs pt-1">
              <Link className="underline" href={`/leads/workspace?leadId=${encodeURIComponent(thread.lead_id)}&callId=${encodeURIComponent(callId || "")}`}>
                Abrir Omnichannel Workspace
              </Link>
            </div>
          ) : null}

          <div className="text-xs text-muted-foreground pt-1">
            modo: <span className="font-mono">{thread?.mode ?? "—"}</span>{" · "}
            human_status: <span className="font-mono">{thread?.human_status ?? "—"}</span>
            {isHandoffPending ? <span className="ml-2 rounded-md border px-2 py-0.5 text-[11px]">handoff</span> : null}
            {isTaken ? <span className="ml-2 rounded-md border px-2 py-0.5 text-[11px]">tomada</span> : null}
          </div>

          <div className="text-xs text-muted-foreground pt-1">
            instance: <span className="font-mono">{instance || "—"}</span> · to: <span className="font-mono">{toPhone || "—"}</span>
          </div>
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          <button onClick={() => loadAll(callId)} className="rounded-lg border px-3 py-2 text-sm hover:bg-muted">
            Recargar
          </button>

          {showTake && (
            <button onClick={takeConversation} className="rounded-lg border px-3 py-2 text-sm hover:bg-muted">
              Tomar
            </button>
          )}

          {showClose && (
            <button onClick={closeConversation} className="rounded-lg border px-3 py-2 text-sm hover:bg-muted">
              Cerrar
            </button>
          )}

          {showReturnToBot && (
            <button onClick={returnToBot} className="rounded-lg border px-3 py-2 text-sm hover:bg-muted">
              Volver a bot
            </button>
          )}

          <Link href="/inbox" className="rounded-lg border px-3 py-2 text-sm hover:bg-muted">
            ← Volver
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border p-4 text-sm text-red-600 whitespace-pre-wrap">{error}</div>
      )}

      <div className="rounded-xl border p-4 space-y-3">
        {loading ? (
          <div className="text-sm text-muted-foreground">Cargando…</div>
        ) : (
          <div className="space-y-2">
            {messages.map((m) => (
              <div key={m.id} className="flex gap-3">
                <div className="w-20 text-xs text-muted-foreground pt-1">{m.role}</div>
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground">
                    <TimeText iso={m.created_at} />
                    {m.from_id ? ` · ${m.from_id}` : ""}
                    {m.instance ? ` · ${m.instance}` : ""}
                  </div>
                  <div className="whitespace-pre-wrap text-sm">{m.message_text ?? "—"}</div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {canCompose && (
        <div className="rounded-xl border p-4 space-y-2">
          <div className="text-sm text-muted-foreground">Responder</div>
          <textarea
            className="w-full rounded-md border px-3 py-2 text-sm min-h-[90px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe tu respuesta…"
          />
          <div className="flex gap-2 items-center">
            <button
              onClick={sendText}
              disabled={sending || !text.trim()}
              className="rounded-lg border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              {sending ? "Enviando…" : "Enviar"}
            </button>
            <div className="text-xs text-muted-foreground">
              Envío real vía <span className="font-mono">/api/aap/wa/outbound</span>.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
