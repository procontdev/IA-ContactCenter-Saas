"use client";

import React, { useEffect, useMemo, useState } from "react";

type Temp = "" | "caliente" | "tibio" | "frio";
type Priority = "" | "P1" | "P2" | "P3";

type CampaignOption = {
    id: string;
    code: string | null;
    name: string | null;
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
    quality_flags: any[];
    spam_flags: any[];
    lead_score_reasons: string[];
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
    q?: string;
}) {
    const p = new URLSearchParams();
    p.set("limit", String(args.limit));
    p.set("offset", String(args.offset));

    const campaignId = (args.campaign_id || "").trim();
    const temperature = (args.temperature || "").trim().toLowerCase() as Temp;
    const priority = (args.priority || "").trim().toUpperCase() as Priority;
    const q = (args.q || "").trim();

    if (campaignId) p.set("campaign_id", campaignId);
    if (temperature) p.set("temperature", temperature);
    if (priority) p.set("priority", priority);
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

// ======================================================
// ✅ CONFIG: comportamiento de botones en cola
// ======================================================

// HUMANO: si true => se ve siempre (si hay teléfono)
const SHOW_HUMAN_CALL_ALWAYS = false;
// IA: si true => se ve siempre (si hay teléfono)
const SHOW_IA_CALL_ALWAYS = false;

// Regla HUMANO (cuando ALWAYS = false):
// Mostrar solo si: P1 OR SLA vencido OR Caliente
function shouldShowHumanCall(it: WowItem) {
    if (SHOW_HUMAN_CALL_ALWAYS) return true;

    const isP1 = (it.priority || "").toUpperCase() === "P1";
    const overdue = isOverdue(it.sla_due_at);
    const isHot = (it.lead_temperature || "").toLowerCase() === "caliente";

    return isP1 || overdue || isHot;
}

// Regla IA (cuando ALWAYS = false):
// Por defecto: Caliente OR Tibio (ajústalo a tu gusto)
function shouldShowIaCall(it: WowItem) {
    if (SHOW_IA_CALL_ALWAYS) return true;

    const t = (it.lead_temperature || "").toLowerCase();
    const isHot = t === "caliente";
    const isWarm = t === "tibio";

    return isHot || isWarm;
}

export default function LeadsWowQueueClient() {
    const [campaignId, setCampaignId] = useState("");
    const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
    const [campaignsLoading, setCampaignsLoading] = useState(false);

    const [temperature, setTemperature] = useState<Temp>("");
    const [priority, setPriority] = useState<Priority>("");
    const [q, setQ] = useState("");

    const qDebounced = useDebouncedValue(q, 350);

    const [pageSize, setPageSize] = useState(50);
    const [offset, setOffset] = useState(0);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [items, setItems] = useState<WowItem[]>([]);
    const [total, setTotal] = useState<number>(0);

    const [stats, setStats] = useState<WowStatsResp>({
        total: 0,
        calientes: 0,
        tibios: 0,
        frios: 0,
        sla_vencido: 0,
    });

    // ✅ estado para llamadas por fila
    const [callingLeadId, setCallingLeadId] = useState<string | null>(null);
    const [callingMode, setCallingMode] = useState<null | "human" | "llm">(null);

    const page = useMemo(() => Math.floor(offset / Math.max(1, pageSize)) + 1, [offset, pageSize]);
    const totalPages = useMemo(
        () => Math.max(1, Math.ceil((total || 0) / Math.max(1, pageSize))),
        [total, pageSize]
    );

    const campaignsSorted = useMemo(() => {
        const arr = Array.isArray(campaigns) ? [...campaigns] : [];
        arr.sort((a, b) => campaignLabel(a).toLowerCase().localeCompare(campaignLabel(b).toLowerCase()));
        return arr;
    }, [campaigns]);

    useEffect(() => {
        let alive = true;

        async function fetchCampaigns() {
            setCampaignsLoading(true);
            try {
                const r = await fetch("/api/aap/leads/wow-campaigns", { cache: "no-store" });
                const j = await r.json().catch(() => null);

                if (!alive) return;

                const list =
                    (Array.isArray(j) ? j : null) ||
                    (Array.isArray(j?.items) ? j.items : null) ||
                    (Array.isArray(j?.data) ? j.data : null) ||
                    [];

                setCampaigns(list);
            } catch {
                if (!alive) return;
                setCampaigns([]);
            } finally {
                if (!alive) return;
                setCampaignsLoading(false);
            }
        }

        fetchCampaigns();
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        setOffset(0);
    }, [campaignId, temperature, priority, qDebounced, pageSize]);

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
                q: qDebounced,
            });

            const r = await fetch(`/api/aap/leads/wow-queue?${params.toString()}`, { cache: "no-store" });
            const j = (await r.json()) as WowQueueResp;

            if (!r.ok) throw new Error((j as any)?.error || "Error cargando cola");

            setItems(Array.isArray(j.items) ? j.items : []);
            setTotal(typeof j.total === "number" ? j.total : 0);
        } catch (e: any) {
            setItems([]);
            setTotal(0);
            setError(e?.message || "Error inesperado");
        } finally {
            setLoading(false);
        }
    }

    async function fetchStats() {
        try {
            const p = new URLSearchParams();
            const cid = campaignId.trim();
            if (cid) p.set("campaign_id", cid);

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
    }, [offset, pageSize, campaignId, temperature, priority, qDebounced]);

    useEffect(() => {
        fetchStats();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [campaignId]);

    function getN8nBase() {
        return process.env.NEXT_PUBLIC_N8N_BASE_URL || "https://elastica-n8n.3haody.easypanel.host";
    }

    async function startCallFromRow(it: WowItem, mode: "human" | "llm") {
        if (callingLeadId) return;

        const phone = (it.phone || "").trim();
        if (!phone) {
            alert("❌ Este lead no tiene teléfono.");
            return;
        }

        const N8N_BASE = getN8nBase();
        const url =
            mode === "human"
                ? `${N8N_BASE}/webhook/api/calls/start-human`
                : `${N8N_BASE}/webhook/api/calls/start-llm`;

        try {
            setCallingLeadId(it.id);
            setCallingMode(mode);

            const r = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    lead_id: it.id,
                    phone,
                    source: mode === "human" ? "demo-ui-wow-queue-human" : "demo-ui-wow-queue-llm",

                    // contexto (mínimo)
                    campaign: it.campaign || "",
                    campaign_name: it.campaign || "",
                    campaign_objective: "",
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
                window.location.href = `/call?id=${encodeURIComponent(cleanCallId)}`;
                return;
            }

            alert(`✅ Llamada ${mode === "human" ? "Humano" : "IA"} iniciada (sin call_id retornado).`);
        } catch (e: any) {
            alert(`❌ Error iniciando llamada ${mode === "human" ? "humana" : "IA"}: ${e?.message ?? e}`);
        } finally {
            setCallingLeadId(null);
            setCallingMode(null);
        }
    }

    const showing = items.length;

    return (
        <div className="space-y-4">
            {/* Filtros */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                    <div className="text-xs text-muted-foreground mb-1">Campaña</div>
                    <select
                        className="w-full border rounded-md px-3 py-2 text-sm"
                        value={campaignId}
                        onChange={(e) => setCampaignId(e.target.value)}
                        disabled={campaignsLoading}
                    >
                        <option value="">Todas</option>
                        {campaignsSorted.map((c) => (
                            <option key={c.id} value={c.id}>
                                {campaignLabel(c)}
                            </option>
                        ))}
                    </select>

                    {campaignsLoading ? (
                        <div className="text-xs text-muted-foreground mt-1">Cargando campañas...</div>
                    ) : campaignsSorted.length === 0 ? (
                        <div className="text-xs text-muted-foreground mt-1">
                            No hay campañas para mostrar (revisa /api/aap/leads/wow-campaigns)
                        </div>
                    ) : null}
                </div>

                <div>
                    <div className="text-xs text-muted-foreground mb-1">Temperatura</div>
                    <select
                        className="w-full border rounded-md px-3 py-2 text-sm"
                        value={temperature}
                        onChange={(e) => setTemperature((e.target.value || "") as Temp)}
                    >
                        <option value="">Todas</option>
                        <option value="caliente">Caliente</option>
                        <option value="tibio">Tibio</option>
                        <option value="frio">Frío</option>
                    </select>
                </div>

                <div>
                    <div className="text-xs text-muted-foreground mb-1">Prioridad</div>
                    <select
                        className="w-full border rounded-md px-3 py-2 text-sm"
                        value={priority}
                        onChange={(e) => setPriority((e.target.value || "") as Priority)}
                    >
                        <option value="">Todas</option>
                        <option value="P1">P1</option>
                        <option value="P2">P2</option>
                        <option value="P3">P3</option>
                    </select>
                </div>

                <div>
                    <div className="text-xs text-muted-foreground mb-1">Buscar (teléfono / form_id)</div>
                    <input
                        className="w-full border rounded-md px-3 py-2 text-sm"
                        placeholder="Ej: 9766. o form."
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                    />
                </div>
            </div>

            {/* Cards */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div className="border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">Total</div>
                    <div className="text-2xl font-semibold">{stats.total || total || 0}</div>
                </div>
                <div className="border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">🔥 Calientes</div>
                    <div className="text-2xl font-semibold">{stats.calientes || 0}</div>
                </div>
                <div className="border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">🟡 Tibios</div>
                    <div className="text-2xl font-semibold">{stats.tibios || 0}</div>
                </div>
                <div className="border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">🧊 Fríos</div>
                    <div className="text-2xl font-semibold">{stats.frios || 0}</div>
                </div>
                <div className="border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">⏱️ SLA vencido</div>
                    <div className="text-2xl font-semibold">{stats.sla_vencido || 0}</div>
                </div>
            </div>

            {/* Header tabla */}
            <div className="flex items-center justify-between gap-3">
                <div className="text-sm">
                    Mostrando {showing} de {total}
                    {loading ? <span className="ml-2 text-muted-foreground">(cargando...)</span> : null}
                </div>

                <div className="flex items-center gap-2">
                    <select
                        className="border rounded-md px-2 py-2 text-sm"
                        value={pageSize}
                        onChange={(e) => setPageSize(Number(e.target.value))}
                    >
                        <option value={25}>25/pág</option>
                        <option value={50}>50/pág</option>
                        <option value={100}>100/pág</option>
                    </select>

                    <button className="border rounded-md px-3 py-2 text-sm" onClick={() => fetchQueue()} disabled={loading}>
                        Refrescar
                    </button>
                </div>
            </div>

            {error ? (
                <div className="border border-red-300 bg-red-50 text-red-800 rounded-md p-3 text-sm">{error}</div>
            ) : null}

            {/* Tabla */}
            <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                        <tr className="text-left">
                            <th className="px-3 py-2">Lead</th>
                            <th className="px-3 py-2">Campaña</th>
                            <th className="px-3 py-2">Teléfono</th>
                            <th className="px-3 py-2">Temp</th>
                            <th className="px-3 py-2">Score</th>
                            <th className="px-3 py-2">P</th>
                            <th className="px-3 py-2">SLA</th>
                            <th className="px-3 py-2">Next Best Action</th>
                            <th className="px-3 py-2">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 ? (
                            <tr>
                                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                                    Sin resultados con esos filtros.
                                </td>
                            </tr>
                        ) : (
                            items.map((it) => {
                                const rowCalling = callingLeadId === it.id;

                                const hasPhone = !!(it.phone && it.phone.trim().length);

                                const canHuman = hasPhone && shouldShowHumanCall(it);
                                const canIA = hasPhone && shouldShowIaCall(it);

                                return (
                                    <tr key={it.id} className="border-t">
                                        <td className="px-3 py-2">
                                            <a className="underline" href={`/leads/wow/view?id=${encodeURIComponent(it.id)}`}>
                                                {it.id.slice(0, 8)}.
                                            </a>
                                            <div className="text-xs text-muted-foreground">{formatDatePe(it.created_at)}</div>
                                        </td>

                                        <td className="px-3 py-2">
                                            <div className="font-medium">{it.campaign || "-"}</div>
                                            {it.campaign_id ? (
                                                <div className="text-xs text-muted-foreground">{it.campaign_id.slice(0, 8)}.</div>
                                            ) : null}
                                        </td>

                                        <td className="px-3 py-2">
                                            <div>{it.phone || "-"}</div>
                                            <div className="text-xs text-muted-foreground">{it.phone_norm || "-"}</div>
                                        </td>

                                        <td className="px-3 py-2">
                                            <span className="inline-flex items-center border rounded-full px-2 py-0.5 text-xs">
                                                {it.lead_temperature || "-"}
                                            </span>
                                        </td>

                                        <td className="px-3 py-2 font-semibold">{it.lead_score ?? "-"}</td>

                                        <td className="px-3 py-2">
                                            <span className="inline-flex items-center border rounded-full px-2 py-0.5 text-xs">
                                                {it.priority || "-"}
                                            </span>
                                        </td>

                                        <td className="px-3 py-2">
                                            <div>{formatDatePe(it.sla_due_at)}</div>
                                            <div className={`text-xs ${isOverdue(it.sla_due_at) ? "text-red-600" : "text-muted-foreground"}`}>
                                                {isOverdue(it.sla_due_at) ? "Vencido" : "OK"}
                                            </div>
                                        </td>

                                        <td className="px-3 py-2">{it.next_best_action || "-"}</td>

                                        <td className="px-3 py-2">
                                            <div className="flex flex-wrap gap-2">
                                                <a className="underline" href={`/leads/wow/view?id=${encodeURIComponent(it.id)}#wow-insights`}>
                                                    Ver
                                                </a>

                                                {canHuman ? (
                                                    <button
                                                        className="border rounded-md px-2 py-1 text-xs disabled:opacity-50"
                                                        disabled={rowCalling}
                                                        onClick={() => startCallFromRow(it, "human")}
                                                        title="Inicia llamada con agente humano"
                                                    >
                                                        {rowCalling && callingMode === "human" ? "Llamando..." : "Llamar (Humano)"}
                                                    </button>
                                                ) : null}

                                                {canIA ? (
                                                    <button
                                                        className="border rounded-md px-2 py-1 text-xs disabled:opacity-50"
                                                        disabled={rowCalling}
                                                        onClick={() => startCallFromRow(it, "llm")}
                                                        title="Inicia llamada con agente IA"
                                                    >
                                                        {rowCalling && callingMode === "llm" ? "Llamando..." : "Llamar (IA)"}
                                                    </button>
                                                ) : null}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>

                {/* Footer paginación */}
                <div className="flex items-center justify-between p-3 border-t">
                    <div className="text-xs text-muted-foreground">
                        Página {page} de {totalPages}
                    </div>
                    <div className="flex gap-2">
                        <button
                            className="border rounded-md px-3 py-2 text-sm disabled:opacity-50"
                            disabled={loading || offset <= 0}
                            onClick={() => setOffset(Math.max(0, offset - pageSize))}
                        >
                            Anterior
                        </button>
                        <button
                            className="border rounded-md px-3 py-2 text-sm disabled:opacity-50"
                            disabled={loading || offset + pageSize >= total}
                            onClick={() => setOffset(offset + pageSize)}
                        >
                            Siguiente
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
