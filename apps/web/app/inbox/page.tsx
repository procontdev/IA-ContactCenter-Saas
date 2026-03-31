"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { sbFetch } from "@/lib/supabaseRest";
import { useTenant } from "@/lib/tenant/use-tenant";

type Campaign = {
    id: string;
    code: string | null;
    name: string | null;
};

type Thread = {
    call_id: string;
    lead_id: string | null;
    campaign_id: string | null;
    campaign_code: string | null;
    campaign_name: string | null;

    channel: string | null;
    mode: string | null;
    status: string | null;

    created_at: string | null;
    updated_at: string | null;

    human_status: string | null;

    customer_phone: string | null;
    customer_whatsapp_phone: string | null;
    customer_whatsapp_waid: string | null;

    last_message_at: string | null;
    last_message_text: string | null;
    last_message_role: string | null;

    unread_count: number | null;
    message_count: number | null;
};

function fmtTime(iso?: string | null) {
    if (!iso) return "";
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

function shortId(id?: string | null) {
    if (!id) return "";
    return id.replace(/-/g, "").slice(0, 6);
}

function normalizePhone(s?: string | null) {
    return String(s ?? "").replace(/\s+/g, "").trim();
}

function statusPill(t: Thread) {
    const mode = (t.mode ?? "").toLowerCase();
    const hs = (t.human_status ?? "").toLowerCase();

    if (hs === "closed") return { label: "closed", cls: "bg-muted text-muted-foreground" };
    if (hs === "active") return { label: "human", cls: "bg-foreground text-background" };
    if (hs === "pending") return { label: "pending", cls: "bg-yellow-100 text-yellow-900" };
    if (mode === "human") return { label: "human", cls: "bg-foreground text-background" };
    if (mode === "llm") return { label: "llm", cls: "bg-muted text-muted-foreground" };
    return { label: "—", cls: "bg-muted text-muted-foreground" };
}

function matchesSearch(t: Thread, qRaw: string) {
    const q = qRaw.trim().toLowerCase();
    if (!q) return true;

    const phone = normalizePhone(
        t.customer_phone ?? t.customer_whatsapp_phone ?? t.customer_whatsapp_waid ?? ""
    ).toLowerCase();

    const code = String(t.campaign_code ?? "").toLowerCase();
    const name = String(t.campaign_name ?? "").toLowerCase();
    const callId = String(t.call_id ?? "").toLowerCase();
    const last = String(t.last_message_text ?? "").toLowerCase();

    return phone.includes(q) || code.includes(q) || name.includes(q) || callId.includes(q) || last.includes(q);
}

export default function InboxPage() {
    const { context, loading: tenantLoading } = useTenant();
    const tenantId = context?.tenantId || undefined;
    const [loading, setLoading] = useState(true);
    const [loadingCampaigns, setLoadingCampaigns] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [threads, setThreads] = useState<Thread[]>([]);

    const [campaignId, setCampaignId] = useState<string>("all");
    const [state, setState] = useState<string>("all"); // all | pending | active | closed | llm | human
    const [q, setQ] = useState<string>("");

    // Evita hydration mismatch: esto solo se setea en cliente
    const [nowLabel, setNowLabel] = useState<string>("");

    useEffect(() => {
        setNowLabel(new Date().toLocaleString());
    }, []);

    async function loadCampaigns() {
        setLoadingCampaigns(true);
        try {
            const rows = await sbFetch<Campaign[]>("/rest/v1/campaigns", {
                tenantId,
                query: { select: "id,code,name", order: "name.asc", limit: 500 },
            });
            setCampaigns(rows ?? []);
        } finally {
            setLoadingCampaigns(false);
        }
    }

    async function loadThreads() {
        setLoading(true);
        setError(null);
        try {
            const query: Record<string, any> = {
                select:
                    "call_id,lead_id,campaign_id,campaign_code,campaign_name,channel,mode,status,created_at,updated_at," +
                    "human_status,customer_phone,customer_whatsapp_phone,customer_whatsapp_waid," +
                    "last_message_at,last_message_text,last_message_role,unread_count,message_count",
                order: "last_message_at.desc.nullslast,updated_at.desc",
                limit: 2000,
            };

            if (campaignId !== "all") query.campaign_id = `eq.${campaignId}`;

            if (state === "active") query.human_status = "eq.active";
            else if (state === "closed") query.human_status = "eq.closed";
            else if (state === "llm") query.mode = "eq.llm";
            else if (state === "human") query.mode = "eq.human";
            else if (state === "pending") query.or = "(human_status.eq.pending,unread_count.gt.0)";

            const safeRows = await sbFetch<Thread[]>("/rest/v1/v_inbox_threads", { tenantId, query });
            setThreads(safeRows ?? []);
        } catch (e: any) {
            setError(e?.message ?? String(e));
            setThreads([]);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (tenantLoading || !tenantId) return;
        loadCampaigns().catch(() => { });
    }, [tenantLoading, tenantId]);

    useEffect(() => {
        if (tenantLoading || !tenantId) return;
        loadThreads().catch(() => { });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [campaignId, state, tenantLoading, tenantId]);

    const filtered = useMemo(() => (threads ?? []).filter((t) => matchesSearch(t, q)), [threads, q]);

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <div className="text-sm text-muted-foreground">Inbox</div>
                    <h1 className="text-2xl font-semibold">Conversaciones</h1>
                </div>

                <div className="flex gap-2 items-center">
                    <button onClick={() => loadThreads()} className="rounded-lg border px-3 py-2 text-sm hover:bg-muted">
                        Recargar
                    </button>
                </div>
            </div>

            {error && (
                <div className="rounded-xl border p-4 text-sm text-red-600 whitespace-pre-wrap">{error}</div>
            )}

            <div className="rounded-xl border p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Campaña</div>
                        <select
                            className="w-full rounded-md border px-3 py-2 text-sm"
                            value={campaignId}
                            onChange={(e) => setCampaignId(e.target.value)}
                            disabled={loadingCampaigns}
                        >
                            <option value="all">Todas</option>
                            {campaigns.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {(c.code ? `${c.code} · ` : "") + (c.name ?? c.id)}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Estado</div>
                        <select className="w-full rounded-md border px-3 py-2 text-sm" value={state} onChange={(e) => setState(e.target.value)}>
                            <option value="all">Todos</option>
                            <option value="pending">Pendientes</option>
                            <option value="active">Human active</option>
                            <option value="closed">Cerrados</option>
                            <option value="llm">Bot (LLM)</option>
                            <option value="human">Human (cualquier)</option>
                        </select>
                    </div>

                    <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Buscar</div>
                        <input
                            className="w-full rounded-md border px-3 py-2 text-sm"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Teléfono, campaña, call_id, texto..."
                        />
                    </div>
                </div>

                <div className="pt-2 text-xs text-muted-foreground">
                    Mostrando {filtered.length} de {threads.length}
                </div>
            </div>

            <div className="rounded-xl border">
                <div className="p-4 border-b flex items-center justify-between">
                    <div className="font-semibold">Listado</div>
                    {/* render solo cliente */}
                    <div className="text-xs text-muted-foreground">{nowLabel || ""}</div>
                </div>

                <div className="divide-y">
                    {loading ? (
                        <div className="p-4 text-sm text-muted-foreground">Cargando…</div>
                    ) : filtered.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground">Sin resultados.</div>
                    ) : (
                        filtered.map((t) => {
                            const phone = t.customer_phone ?? t.customer_whatsapp_phone ?? t.customer_whatsapp_waid ?? "—";
                            const lastText = String(t.last_message_text ?? "").trim();
                            const lastRole = String(t.last_message_role ?? "").trim();
                            const snippet = lastText ? `${lastRole ? `[${lastRole}] ` : ""}${lastText}` : "—";

                            const unread = Number(t.unread_count ?? 0);
                            const pill = statusPill(t);
                            const rightTime = t.last_message_at ?? t.updated_at ?? t.created_at ?? null;

                            return (
                                <Link key={t.call_id} href={`/inbox/${t.call_id}`} className="block hover:bg-muted/40">
                                    <div className="p-4 flex items-start justify-between gap-4">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <div className="font-semibold truncate">{phone}</div>

                                                <span className={`text-[11px] px-2 py-0.5 rounded-full ${pill.cls}`}>{pill.label}</span>

                                                {unread > 0 && (
                                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-600 text-white">
                                                        {unread} new
                                                    </span>
                                                )}

                                                {typeof t.message_count === "number" && (
                                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                                        {t.message_count} msgs
                                                    </span>
                                                )}
                                            </div>

                                            <div className="text-xs text-muted-foreground truncate">
                                                {t.campaign_code ? `${t.campaign_code} · ` : ""}
                                                {t.campaign_name ?? "—"} · {t.channel ?? "—"} · {t.mode ?? "—"}
                                            </div>

                                            <div className="text-sm text-muted-foreground truncate">{snippet}</div>
                                        </div>

                                        <div className="text-right shrink-0">
                                            <div className="text-xs text-muted-foreground">{fmtTime(rightTime)}</div>
                                            <div className="text-xs text-muted-foreground font-mono">{shortId(t.call_id)}</div>
                                        </div>
                                    </div>
                                </Link>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
