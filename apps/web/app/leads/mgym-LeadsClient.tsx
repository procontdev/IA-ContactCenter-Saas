"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";

import { apiGet, apiPost } from "@/lib/api";
import type { LeadRow, Paged } from "@/lib/types";
import { Topbar } from "@/components/topbar";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";

export default function LeadsClient() {
    function fmtDate(iso: string) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        return new Intl.DateTimeFormat("es-PE", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        }).format(d);
    }

    function safeStr(v: any) {
        return (v ?? "").toString().trim();
    }

    function toISODate(d: Date) {
        return d.toISOString().slice(0, 10); // yyyy-mm-dd
    }

    async function copyToClipboard(text: string) {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const el = document.createElement("textarea");
            el.value = text;
            document.body.appendChild(el);
            el.select();
            document.execCommand("copy");
            document.body.removeChild(el);
        }
    }

    // =======================
    // Export CSV helpers
    // =======================
    function csvEscape(v: any) {
        const s = (v ?? "").toString();
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    }
    function compactText(v: any) {
        return (v ?? "").toString().replace(/\s+/g, " ").trim();
    }
    function nowFileStamp() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        return `${y}-${m}-${day}_${hh}-${mm}`;
    }
    function downloadTextFile(
        filename: string,
        content: string,
        mime = "text/csv;charset=utf-8"
    ) {
        // BOM + "sep=," ayuda a Excel (locale ES) a abrir bien el CSV con comas
        const withBom = "\uFEFF" + "sep=,\n" + content;
        const blob = new Blob([withBom], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }
    function rowsToCsv(headers: string[], rows: any[], mapRow: (r: any) => any[]) {
        const lines: string[] = [];
        lines.push(headers.map(csvEscape).join(","));
        for (const r of rows) {
            lines.push(mapRow(r).map(csvEscape).join(","));
        }
        return lines.join("\n");
    }

    // =======================
    // Colores estilo Membresías
    // =======================
    function canalBadgeClass(canalRaw: string) {
        const c = (canalRaw || "").toLowerCase();

        if (c.includes("whatsapp"))
            return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300";
        if (c.includes("telegram"))
            return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-300";
        if (c.includes("web"))
            return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300";

        return "border-border bg-muted/30 text-foreground";
    }

    function celularBadgeClass(hasCel: boolean) {
        return hasCel
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
            : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300";
    }

    function rowHintClass(hasCel: boolean) {
        if (!hasCel)
            return "bg-amber-50/40 hover:bg-amber-50/60 dark:bg-amber-950/20 dark:hover:bg-amber-950/30";
        return "";
    }

    // Toque Membresías: WhatsApp verde cuando activo
    function whatsappBtnClass(enabled: boolean) {
        if (!enabled) return "";
        return "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60";
    }

    // =======================
    // Historial (Leads)
    // =======================
    function buildLeadHistory(r: any) {
        const events: Array<{
            at: string;
            title: string;
            detail?: string;
            tone?: "ok" | "warn" | "info";
        }> = [];

        const first = safeStr(r?.FechaHoraPrimerContacto);
        if (first) {
            events.push({
                at: first,
                title: "Primer contacto",
                detail: `Canal: ${compactText(r?.Canal) || "—"}`,
                tone: "info",
            });
        }

        const upd = safeStr(r?._updatedAt);
        if (upd) {
            events.push({
                at: upd,
                title: "Actualizado desde dashboard",
                detail: "Último cambio confirmado por API (updatedAt).",
                tone: "info",
            });
        }

        const lastMsg = safeStr(r?.UltimoMensaje);
        if (lastMsg) {
            events.push({
                at: upd || first || new Date().toISOString(),
                title: "Último mensaje",
                detail: lastMsg,
                tone: "info",
            });
        }

        const cel = safeStr(r?.Celular);
        events.push({
            at: upd || first || new Date().toISOString(),
            title: cel ? "Tiene celular" : "Sin celular",
            detail: cel ? `+51 ${cel}` : "No se registró un número.",
            tone: cel ? "ok" : "warn",
        });

        events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
        return events;
    }

    function leadHistoryDotClass(tone?: "ok" | "warn" | "info") {
        if (tone === "ok") return "bg-emerald-500/90";
        if (tone === "warn") return "bg-amber-500/90";
        return "bg-sky-500/90";
    }

    type UpdateLeadResp =
        | {
            ok: true;
            row_number: number;
            updated: any;
            meta?: { updatedAt?: string; timezone?: string };
        }
        | { ok: false; error?: string; message?: string; meta?: any };


    // filtros UI
    const [from, setFrom] = useState<string>(""); // YYYY-MM-DD
    const [to, setTo] = useState<string>(""); // YYYY-MM-DD
    const [canal, setCanal] = useState<string>("");

    // q real (aplicado) vs typingQ (input vivo)
    const [q, setQ] = useState<string>("");
    const [typingQ, setTypingQ] = useState<string>(""); // input “vivo”
    const debounceRef = useRef<any>(null);

    // ✅ filtro local (frontend) por celular
    const [celularOnly, setCelularOnly] = useState<"all" | "with" | "without">(
        "all"
    );

    const router = useRouter();

    // paginación
    const [page, setPage] = useState<number>(1);
    const pageSize = 50;

    // filtros aplicados (para que SWR no dispare en cada tecla)
    const [applied, setApplied] = useState({
        from: "",
        to: "",
        canal: "",
        q: "",
    });

    const appliedRef = useRef(applied);

    useEffect(() => {
        appliedRef.current = applied;
    }, [applied]);

    // ====== URL helper ======
    function pushUrl(
        next: typeof applied,
        nextCelular: "all" | "with" | "without"
    ) {
        const sp = new URLSearchParams();
        if (next.from) sp.set("from", next.from);
        if (next.to) sp.set("to", next.to);
        if (next.canal) sp.set("canal", next.canal);
        if (next.q) sp.set("q", next.q);

        // filtro local (frontend)
        if (nextCelular !== "all") sp.set("celular", nextCelular);

        const qs = sp.toString();
        router.replace(qs ? `/leads?${qs}` : "/leads");
    }

    const params = useMemo(() => {
        return {
            from: applied.from || undefined,
            to: applied.to || undefined,
            canal: applied.canal || undefined,
            q: applied.q || undefined,
            page,
            pageSize,
        };
    }, [applied, page, pageSize]);

    const swrKey = useMemo(() => ["leads", params], [params]);

    const { data, error, isLoading, mutate } = useSWR<Paged<LeadRow>>(
        swrKey,
        () => apiGet<Paged<LeadRow>>("/api/leads", params),
        { revalidateOnFocus: false }
    );

    const total = data?.meta.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // ✅ rows filtradas localmente (Con/Sin celular)
    const rows = useMemo(() => {
        const list = data?.data ?? [];

        if (celularOnly === "with") {
            return list.filter(
                (r: any) => r.hasCelular === true || safeStr(r.Celular) !== ""
            );
        }
        if (celularOnly === "without") {
            return list.filter(
                (r: any) => r.hasCelular === false || safeStr(r.Celular) === ""
            );
        }
        return list;
    }, [data?.data, celularOnly]);

    // ✅ Export CSV (lo que ves en pantalla)
    function exportLeadsCsv() {
        const headers = [
            "FechaHoraPrimerContacto",
            "Canal",
            "Nombre",
            "Celular",
            "ConversationId",
            "UltimoMensaje",
            "LeadKey",
            "hasCelular",
        ];

        const csv = rowsToCsv(headers, rows, (r: any) => [
            r.FechaHoraPrimerContacto ?? "",
            compactText(r.Canal ?? ""),
            compactText(r.Nombre ?? ""),
            compactText(r.Celular ?? ""),
            r.ConversationId ?? "",
            compactText(r.UltimoMensaje ?? ""),
            r.LeadKey ?? "",
            (r.hasCelular ?? "") as any,
        ]);

        const suffix =
            (applied.canal ? `_canal-${compactText(applied.canal)}` : "") +
            (celularOnly !== "all" ? `_cel-${celularOnly}` : "") +
            (applied.from ? `_from-${applied.from}` : "") +
            (applied.to ? `_to-${applied.to}` : "");

        downloadTextFile(`leads_${nowFileStamp()}${suffix}.csv`, csv);
    }

    // ✅ Mantener typingQ sincronizado cuando q cambie por presets / URL / clear, etc.
    useEffect(() => {
        setTypingQ(q);
    }, [q]);

    // Pre-cargar filtros desde URL (drill-down desde dashboard)
    const searchParams = useSearchParams();
    const appliedFromUrlOnce = useRef(false);

    useEffect(() => {
        if (appliedFromUrlOnce.current) return;

        const canalQ = searchParams.get("canal") || "";
        const qQ = searchParams.get("q") || "";
        const fromQ = searchParams.get("from") || "";
        const toQ = searchParams.get("to") || "";

        const celularQ = (searchParams.get("celular") || "").toLowerCase();
        let celState: "all" | "with" | "without" = "all";
        if (celularQ === "with") celState = "with";
        if (celularQ === "without") celState = "without";

        if (canalQ || qQ || fromQ || toQ || celularQ) {
            appliedFromUrlOnce.current = true;

            setCanal(canalQ);
            setFrom(fromQ);
            setTo(toQ);
            setCelularOnly(celState);

            // q + typingQ
            setQ(qQ);
            setTypingQ(qQ);

            setApplied({ canal: canalQ, q: qQ, from: fromQ, to: toQ });
            setPage(1);
        }
    }, [searchParams]);

    // ✅ Debounce: aplica la búsqueda automáticamente
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);

        debounceRef.current = setTimeout(() => {
            if (typingQ !== q) {
                const next = { ...appliedRef.current, q: typingQ };

                setQ(typingQ);
                setApplied(next);
                setPage(1);

                // ✅ router.replace fuera de setState
                pushUrl(next, celularOnly);
            }
        }, 400);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [typingQ, celularOnly, q]);

    // ====== Atajos de filtros (preset) ======
    type LeadPreset = Partial<typeof applied> & {
        celularOnly?: "all" | "with" | "without";
    };

    function applyPreset(preset: LeadPreset) {
        // IMPORTANTE: q debe salir del input vivo (typingQ) para "Aplicar"
        const next = {
            from,
            to,
            canal,
            q: typingQ,
            ...preset,
        };

        const nextCel = preset.celularOnly ?? celularOnly;

        // sincroniza inputs
        setFrom(next.from);
        setTo(next.to);
        setCanal(next.canal);

        // sincroniza q + typingQ
        setQ(next.q);
        setTypingQ(next.q);

        // aplica filtros reales (API)
        setApplied(next);
        setPage(1);

        // aplica filtro local
        setCelularOnly(nextCel);

        // URL
        pushUrl(next, nextCel);
    }

    function applyFilters() {
        applyPreset({}); // usa lo que esté en inputs (incluye typingQ)
    }

    function clearFilters() {
        applyPreset({
            from: "",
            to: "",
            canal: "",
            q: "",
            celularOnly: "all",
        });
    }
    // ====== /Atajos ======

    // -----------------------
    // Crear membresía (modal)
    // -----------------------
    const [openCreate, setOpenCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [selectedLead, setSelectedLead] = useState<any | null>(null);

    const [cInicio, setCInicio] = useState<string>("");
    const [cTipo, setCTipo] = useState<string>("");
    const [cNotas, setCNotas] = useState<string>("");

    const [msgCreate, setMsgCreate] = useState<{
        type: "ok" | "err";
        text: string;
    } | null>(null);

    function openCreateModal(lead: any) {
        setMsgCreate(null);
        setSelectedLead(lead);

        setCInicio("");
        setCTipo("");
        setCNotas(`Creada desde Leads (${new Date().toLocaleString("es-PE")})`);

        setOpenCreate(true);
    }

    async function saveCreate() {
        if (!selectedLead) return;

        if (!cTipo) {
            setMsgCreate({ type: "err", text: "Selecciona el tipo de membresía." });
            return;
        }
        if (!cInicio) {
            setMsgCreate({ type: "err", text: "Selecciona la fecha de inicio." });
            return;
        }

        setCreating(true);
        setMsgCreate(null);

        const payload = {
            leadKey: selectedLead.LeadKey,
            canal: selectedLead.Canal,
            nombre: selectedLead.Nombre,
            celular: selectedLead.Celular || "",
            conversationId: selectedLead.ConversationId,
            inicio: cInicio,
            membresia: cTipo,
            notas: cNotas || "",
            estado: "Registrada",
            pagado: "No",
        };

        try {
            const res = await apiPost<any>("/api/membresias/create", payload);

            if (res?.ok === false) {
                setMsgCreate({ type: "err", text: res.message || "No se pudo crear" });
                return;
            }

            setMsgCreate({ type: "ok", text: "Membresía creada ✅" });
            setOpenCreate(false);
            router.push(`/membresias?q=${encodeURIComponent(selectedLead.LeadKey)}`);
        } catch (e: any) {
            const text = e?.message || "Error creando membresía";

            if (text.includes("409") || text.toLowerCase().includes("alreadyexists")) {
                setMsgCreate({
                    type: "err",
                    text: "Ya existe una membresía para este lead. Puedes abrirla en la lista de membresías.",
                });
                return;
            }

            setMsgCreate({ type: "err", text });
        } finally {
            setCreating(false);
        }
    }

    // -----------------------
    // Editar lead (modal)
    // Solo Nombre + Celular
    // -----------------------
    const [openEdit, setOpenEdit] = useState(false);
    const [savingEdit, setSavingEdit] = useState(false);
    const [editingLead, setEditingLead] = useState<LeadRow | null>(null);

    const [eNombre, setENombre] = useState("");
    const [eCelular, setECelular] = useState("");

    const [msgEdit, setMsgEdit] = useState<{
        type: "ok" | "err";
        text: string;
    } | null>(null);

    function openEditModal(lead: LeadRow) {
        setMsgEdit(null);
        setEditingLead(lead);
        setENombre(safeStr((lead as any).Nombre));
        setECelular(safeStr((lead as any).Celular));
        setOpenEdit(true);
    }

    async function updateLead(leadKey: string, patch: Record<string, any>) {
        const resp = await apiPost<UpdateLeadResp>("/api/leads/update", { leadKey, patch });
        if (!resp.ok) throw new Error(resp.message || resp.error || "Error actualizando lead");
        return resp;
    }

    function applyLeadPatchToRow(row: any, patch: Record<string, any>) {
        const next = { ...row };

        if (patch.Nombre !== undefined) next.Nombre = patch.Nombre;
        if (patch.Celular !== undefined) next.Celular = patch.Celular;
        if (patch.ConversationId !== undefined) next.ConversationId = patch.ConversationId;

        // derivados
        if (patch.Celular !== undefined) next.hasCelular = !!String(patch.Celular || "").trim();

        // meta local para historial UI
        if (patch.__updatedAt) next._updatedAt = patch.__updatedAt;

        return next;
    }

    function applyLeadPatchToPaged(current: any, leadKey: string, patch: Record<string, any>) {
        if (!current?.data) return current;

        const nextData = current.data.map((r: any) => {
            if (String(r.LeadKey || "") !== String(leadKey)) return r;
            return applyLeadPatchToRow(r, patch);
        });

        return { ...current, data: nextData };
    }

    // optimistic update que también inyecta meta.updatedAt => _updatedAt
    async function optimisticLeadUpdate(
        leadKey: string,
        patch: Record<string, any>,
        apiCall: () => Promise<UpdateLeadResp>
    ) {
        let updatedAt: string | undefined;

        await mutate(
            async (current: any) => {
                const resp = await apiCall();
                updatedAt = resp?.meta?.updatedAt;

                const patchWithMeta = updatedAt ? { ...patch, __updatedAt: updatedAt } : patch;

                // sincroniza también el drawer si está abierto
                setDetailLead((prev: any) => {
                    if (!prev) return prev;
                    if (String(prev.LeadKey || "") !== String(leadKey)) return prev;
                    return applyLeadPatchToRow(prev, patchWithMeta);
                });

                return applyLeadPatchToPaged(current, leadKey, patchWithMeta);
            },
            {
                optimisticData: (current: any) => applyLeadPatchToPaged(current, leadKey, patch),
                rollbackOnError: true,
                populateCache: true,
                revalidate: false,
            }
        );

        return updatedAt;
    }

    async function saveEdit() {
        if (!editingLead) return;

        const leadKey = safeStr((editingLead as any).LeadKey);
        if (!leadKey) {
            setMsgEdit({ type: "err", text: "LeadKey vacío. No se puede actualizar." });
            return;
        }

        const patch = {
            Nombre: safeStr(eNombre),
            Celular: safeStr(eCelular),
        };

        setSavingEdit(true);
        setMsgEdit(null);

        try {
            await optimisticLeadUpdate(leadKey, patch, () => updateLead(leadKey, patch));

            setMsgEdit({ type: "ok", text: "Lead actualizado ✅" });
            setOpenEdit(false);
            setEditingLead(null);
        } catch (e: any) {
            setMsgEdit({ type: "err", text: e?.message || "Error actualizando lead" });
        } finally {
            setSavingEdit(false);
        }
    }

    // -----------------------
    // Drawer Detalle (Opción A)
    // -----------------------
    const [openDetail, setOpenDetail] = useState(false);
    const [detailLead, setDetailLead] = useState<any | null>(null);

    function openLeadDetail(lead: any) {
        setDetailLead(lead);
        setOpenDetail(true);
    }

    function leadSummaryText(lead: any) {
        const nombre = safeStr(lead?.Nombre);
        const celular = safeStr(lead?.Celular);
        const canalTxt = compactText(lead?.Canal);
        const conv = safeStr(lead?.ConversationId);
        const lk = safeStr(lead?.LeadKey);
        const msg = safeStr(lead?.UltimoMensaje);
        const fecha = safeStr(lead?.FechaHoraPrimerContacto);

        return [
            `LEAD MGym`,
            nombre ? `Nombre: ${nombre}` : null,
            canalTxt ? `Canal: ${canalTxt}` : null,
            celular ? `Celular: ${celular}` : `Celular: (vacío)`,
            conv ? `ConversationId: ${conv}` : null,
            lk ? `LeadKey: ${lk}` : null,
            fecha ? `Fecha: ${fecha}` : null,
            msg ? `Último mensaje: ${msg}` : null,
        ]
            .filter(Boolean)
            .join("\n");
    }

    return (
        <div>
            <Topbar title="Leads" onRefresh={() => mutate()} />

            <div className="p-6 space-y-4">
                {/* Filtros */}
                <div className="rounded-lg border bg-card p-4">
                    <div className="grid gap-3 md:grid-cols-5">
                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Desde</div>
                            <Input
                                type="date"
                                value={from}
                                onChange={(e) => setFrom(e.target.value)}
                            />
                        </div>

                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Hasta</div>
                            <Input
                                type="date"
                                value={to}
                                onChange={(e) => setTo(e.target.value)}
                            />
                        </div>

                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Canal</div>
                            <Input
                                placeholder="Telegram / Web / WhatsApp…"
                                value={canal}
                                onChange={(e) => setCanal(e.target.value)}
                            />
                        </div>

                        <div className="space-y-1 md:col-span-2">
                            <div className="text-xs text-muted-foreground">Buscar</div>
                            <Input
                                placeholder="Nombre, celular, mensaje, LeadKey…"
                                value={typingQ}
                                onChange={(e) => setTypingQ(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        if (debounceRef.current) clearTimeout(debounceRef.current);

                                        const next = { ...appliedRef.current, q: typingQ };

                                        setQ(typingQ);
                                        setApplied(next);
                                        setPage(1);

                                        pushUrl(next, celularOnly);
                                    }
                                }}
                            />
                        </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button onClick={applyFilters}>Aplicar</Button>
                        <Button variant="secondary" onClick={clearFilters}>
                            Limpiar
                        </Button>
                        <Button variant="outline" onClick={() => mutate()}>
                            Refrescar
                        </Button>

                        {/* ✅ Export CSV */}
                        <Button
                            variant="outline"
                            onClick={exportLeadsCsv}
                            disabled={rows.length === 0}
                            title="Exporta lo que estás viendo en pantalla"
                        >
                            Exportar CSV
                        </Button>

                        {/* ✅ Contadores */}
                        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                            {isLoading ? (
                                <span>Cargando…</span>
                            ) : (
                                <>
                                    <span>Total (API): {total}</span>
                                    <span className="text-muted-foreground/60">•</span>
                                    <span>En pantalla: {rows.length}</span>

                                    {celularOnly !== "all" && (
                                        <>
                                            <span className="text-muted-foreground/60">•</span>
                                            <span className="inline-flex items-center rounded-md border bg-muted/20 px-2 py-0.5 text-[11px]">
                                                {celularOnly === "with" ? "Con celular" : "Sin celular"}
                                            </span>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    {/* ✅ Atajos */}
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => applyPreset({ celularOnly: "all" })}
                        >
                            Todos
                        </Button>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => applyPreset({ celularOnly: "with" })}
                        >
                            Con celular
                        </Button>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => applyPreset({ celularOnly: "without" })}
                        >
                            Sin celular
                        </Button>

                        <div className="mx-1 w-px bg-border" />

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                const today = new Date();
                                const iso = toISODate(today);
                                applyPreset({ from: iso, to: iso });
                            }}
                        >
                            Hoy
                        </Button>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                const today = new Date();
                                const from7 = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
                                applyPreset({ from: toISODate(from7), to: toISODate(today) });
                            }}
                        >
                            7 días
                        </Button>

                        <div className="mx-1 w-px bg-border" />

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => applyPreset({ canal: "Telegram" })}
                        >
                            Canal: Telegram
                        </Button>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => applyPreset({ canal: "Web" })}
                        >
                            Canal: Web
                        </Button>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => applyPreset({ canal: "WhatsApp" })}
                        >
                            Canal: WhatsApp
                        </Button>
                    </div>
                </div>

                {/* Estado */}
                {error && (
                    <div className="rounded-lg border p-4 text-sm">
                        Error cargando leads.{" "}
                        <Button variant="link" onClick={() => mutate()}>
                            Reintentar
                        </Button>
                    </div>
                )}

                {/* Tabla */}
                <div className="rounded-lg border bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Canal</TableHead>
                                <TableHead>Nombre</TableHead>
                                <TableHead>Celular</TableHead>
                                <TableHead>Último mensaje</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>

                        <TableBody>
                            {isLoading && (
                                <>
                                    {Array.from({ length: 8 }).map((_, i) => (
                                        <TableRow key={`sk-${i}`}>
                                            <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                                            <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                                            <TableCell><Skeleton className="h-4 w-44" /></TableCell>
                                            <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                                            <TableCell><Skeleton className="h-4 w-full max-w-[520px]" /></TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Skeleton className="h-8 w-20" />
                                                    <Skeleton className="h-8 w-20" />
                                                    <Skeleton className="h-8 w-24" />
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </>
                            )}

                            {!isLoading && rows.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} className="py-10">
                                        <div className="flex flex-col items-center gap-2 text-center">
                                            <div className="text-sm font-medium">Sin resultados</div>
                                            <div className="text-sm text-muted-foreground">
                                                Prueba ajustar filtros o limpiar la búsqueda.
                                            </div>
                                            <div className="mt-2 flex gap-2">
                                                <Button variant="outline" onClick={clearFilters}>
                                                    Limpiar filtros
                                                </Button>
                                                <Button variant="outline" onClick={() => mutate()}>
                                                    Refrescar
                                                </Button>
                                            </div>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}

                            {rows.map((r: any) => {
                                const celular = safeStr(r.Celular);
                                const hasCel = !!celular;

                                const leadKey = safeStr(r.LeadKey);
                                const convId = safeStr(r.ConversationId);
                                const canalTxt = compactText(r.Canal) || "—";

                                return (
                                    <TableRow
                                        key={leadKey || `${r.row_number}-${convId}`}
                                        className={rowHintClass(hasCel)}
                                        title={!hasCel ? "Falta celular" : undefined}
                                    >
                                        <TableCell className="whitespace-nowrap">
                                            {fmtDate(r.FechaHoraPrimerContacto)}
                                        </TableCell>

                                        <TableCell className="whitespace-nowrap">
                                            <Badge variant="outline" className={canalBadgeClass(canalTxt)}>
                                                {canalTxt}
                                            </Badge>
                                        </TableCell>

                                        <TableCell className="font-medium">
                                            {safeStr(r.Nombre) || "—"}
                                        </TableCell>

                                        <TableCell className="whitespace-nowrap">
                                            {hasCel ? (
                                                <span className="inline-flex items-center gap-2">
                                                    <span>{celular}</span>
                                                    <Badge
                                                        variant="outline"
                                                        className={celularBadgeClass(true) + " text-[11px]"}
                                                    >
                                                        Con celular
                                                    </Badge>
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-2 text-muted-foreground">
                                                    <span>—</span>
                                                    <Badge
                                                        variant="outline"
                                                        className={celularBadgeClass(false) + " text-[11px]"}
                                                    >
                                                        Sin celular
                                                    </Badge>
                                                </span>
                                            )}
                                        </TableCell>

                                        <TableCell className="max-w-[520px] truncate" title={safeStr(r.UltimoMensaje)}>
                                            {safeStr(r.UltimoMensaje) || (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </TableCell>

                                        <TableCell className="text-right space-x-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => openLeadDetail(r)}
                                                title="Ver detalle"
                                            >
                                                Detalle
                                            </Button>

                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => copyToClipboard(leadKey || convId)}
                                                disabled={!leadKey && !convId}
                                                title="Copiar LeadKey/ConversationId"
                                            >
                                                Copiar
                                            </Button>

                                            {hasCel ? (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    asChild
                                                    className={whatsappBtnClass(true)}
                                                    title="Abrir WhatsApp"
                                                >
                                                    <a
                                                        href={`https://wa.me/51${celular}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                    >
                                                        WhatsApp
                                                    </a>
                                                </Button>
                                            ) : (
                                                <Button variant="outline" size="sm" disabled title="Sin celular">
                                                    WhatsApp
                                                </Button>
                                            )}

                                            <Button size="sm" variant="outline" onClick={() => openEditModal(r)}>
                                                Editar
                                            </Button>

                                            <Button size="sm" variant="secondary" onClick={() => openCreateModal(r)}>
                                                Crear Membresía
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>

                    {/* Paginación */}
                    <div className="flex items-center justify-between p-4 border-t">
                        <div className="text-sm text-muted-foreground">
                            Página {page} de {totalPages}
                        </div>

                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page <= 1}
                            >
                                Anterior
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={page >= totalPages}
                            >
                                Siguiente
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ---------------- Drawer: Detalle Lead ---------------- */}
            <Sheet open={openDetail} onOpenChange={setOpenDetail}>
                <SheetContent side="right" className="w-full sm:max-w-[560px]">
                    <SheetHeader>
                        <SheetTitle>Detalle del lead</SheetTitle>
                        <SheetDescription>Acciones rápidas para el counter</SheetDescription>
                    </SheetHeader>

                    {!detailLead ? (
                        <div className="mt-6 text-sm text-muted-foreground">Sin selección</div>
                    ) : (
                        <div className="mt-6 space-y-4">
                            <div className="rounded-lg border bg-card p-4 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-base font-semibold">
                                        {safeStr(detailLead.Nombre) || "—"}
                                    </div>
                                    <Badge
                                        variant="outline"
                                        className={canalBadgeClass(compactText(detailLead.Canal))}
                                    >
                                        {compactText(detailLead.Canal) || "—"}
                                    </Badge>
                                    <Badge
                                        variant="outline"
                                        className={celularBadgeClass(!!safeStr(detailLead.Celular)) + " text-[11px]"}
                                    >
                                        {!!safeStr(detailLead.Celular) ? "Con celular" : "Sin celular"}
                                    </Badge>
                                </div>

                                <div className="text-sm">
                                    <span className="text-muted-foreground">Celular: </span>
                                    <span className="font-medium">{safeStr(detailLead.Celular) || "—"}</span>
                                </div>

                                <div className="text-sm">
                                    <span className="text-muted-foreground">ConversationId: </span>
                                    <span className="font-medium">{safeStr(detailLead.ConversationId) || "—"}</span>
                                </div>

                                <div className="text-sm">
                                    <span className="text-muted-foreground">LeadKey: </span>
                                    <span className="font-mono text-xs break-all">
                                        {safeStr(detailLead.LeadKey) || "—"}
                                    </span>
                                </div>

                                <div className="text-sm">
                                    <span className="text-muted-foreground">Fecha: </span>
                                    <span className="font-medium">
                                        {safeStr(detailLead.FechaHoraPrimerContacto)
                                            ? fmtDate(detailLead.FechaHoraPrimerContacto)
                                            : "—"}
                                    </span>
                                </div>
                            </div>

                            <div className="rounded-lg border bg-card p-4">
                                <div className="text-xs text-muted-foreground mb-2">Último mensaje</div>
                                <div className="text-sm whitespace-pre-wrap break-words">
                                    {safeStr(detailLead.UltimoMensaje) || "—"}
                                </div>
                            </div>

                            {/* ===== Historial ===== */}
                            <div className="rounded-lg border bg-card p-4">
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-semibold">Historial</div>
                                    <div className="text-xs text-muted-foreground">
                                        (incluye updatedAt real)
                                    </div>
                                </div>

                                <div className="mt-3 space-y-3">
                                    {buildLeadHistory(detailLead).map((ev, idx) => (
                                        <div key={idx} className="flex gap-3">
                                            <div className="mt-1.5">
                                                <div className={`h-2.5 w-2.5 rounded-full ${leadHistoryDotClass(ev.tone)}`} />
                                            </div>

                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <div className="text-sm font-medium">{ev.title}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {fmtDate(ev.at)}
                                                    </div>
                                                </div>
                                                {ev.detail && (
                                                    <div className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                                                        {ev.detail}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {!safeStr(detailLead._updatedAt) && (
                                    <div className="mt-3 text-xs text-muted-foreground">
                                        Aún no hay “updatedAt” (aparecerá luego del primer update desde dashboard).
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => copyToClipboard(leadSummaryText(detailLead))}
                                >
                                    Copiar resumen
                                </Button>

                                <Button
                                    variant="outline"
                                    onClick={() =>
                                        copyToClipboard(
                                            safeStr(detailLead.LeadKey) || safeStr(detailLead.ConversationId)
                                        )
                                    }
                                    disabled={!safeStr(detailLead.LeadKey) && !safeStr(detailLead.ConversationId)}
                                >
                                    Copiar ID
                                </Button>

                                {safeStr(detailLead.Celular) ? (
                                    <Button
                                        variant="outline"
                                        asChild
                                        className={whatsappBtnClass(true)}
                                        title="Abrir WhatsApp"
                                    >
                                        <a
                                            href={`https://wa.me/51${safeStr(detailLead.Celular)}`}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            WhatsApp
                                        </a>
                                    </Button>
                                ) : (
                                    <Button variant="outline" disabled title="Sin celular">
                                        WhatsApp
                                    </Button>
                                )}

                                <Button
                                    variant="secondary"
                                    onClick={() => {
                                        setOpenDetail(false);
                                        openCreateModal(detailLead);
                                    }}
                                >
                                    Crear Membresía
                                </Button>

                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setOpenDetail(false);
                                        openEditModal(detailLead);
                                    }}
                                >
                                    Editar
                                </Button>
                            </div>
                        </div>
                    )}
                </SheetContent>
            </Sheet>

            {/* ---------------- Modal: Crear Membresía ---------------- */}
            <Dialog open={openCreate} onOpenChange={setOpenCreate}>
                <DialogContent className="sm:max-w-[560px]">
                    <DialogHeader>
                        <DialogTitle>Crear membresía</DialogTitle>
                        <DialogDescription>
                            Se creará una nueva fila en Google Sheets para este lead.
                        </DialogDescription>
                    </DialogHeader>

                    {selectedLead && (
                        <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                            <div>
                                <span className="text-muted-foreground">Lead:</span>{" "}
                                <b>{selectedLead.Nombre || "—"}</b>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Canal:</span>{" "}
                                {selectedLead.Canal || "—"}
                            </div>
                            <div className="truncate">
                                <span className="text-muted-foreground">LeadKey:</span>{" "}
                                {selectedLead.LeadKey}
                            </div>
                        </div>
                    )}

                    {msgCreate && (
                        <div
                            className={`rounded-lg border p-3 text-sm ${msgCreate.type === "ok" ? "bg-muted/30" : "bg-destructive/10"
                                }`}
                        >
                            {msgCreate.text}
                        </div>
                    )}

                    <div className="grid gap-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                                <div className="text-xs text-muted-foreground">Tipo de membresía</div>
                                <Select value={cTipo} onValueChange={setCTipo}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecciona" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1 mes">1 mes</SelectItem>
                                        <SelectItem value="2 meses">2 meses</SelectItem>
                                        <SelectItem value="3 meses">3 meses</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <div className="text-xs text-muted-foreground">Inicio</div>
                                <Input
                                    type="date"
                                    value={cInicio}
                                    onChange={(e) => setCInicio(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Notas (opcional)</div>
                            <Textarea value={cNotas} onChange={(e) => setCNotas(e.target.value)} />
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        {msgCreate?.type === "err" && selectedLead?.LeadKey && (
                            <Button
                                variant="outline"
                                onClick={() =>
                                    router.push(`/membresias?q=${encodeURIComponent(selectedLead.LeadKey)}`)
                                }
                                disabled={creating}
                            >
                                Ver membresía
                            </Button>
                        )}

                        <Button
                            variant="secondary"
                            onClick={() => setOpenCreate(false)}
                            disabled={creating}
                        >
                            Cerrar
                        </Button>

                        <Button onClick={saveCreate} disabled={creating}>
                            {creating ? "Creando…" : "Crear"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ---------------- Modal: Editar Lead ---------------- */}
            <Dialog open={openEdit} onOpenChange={setOpenEdit}>
                <DialogContent className="sm:max-w-[560px]">
                    <DialogHeader>
                        <DialogTitle>Editar lead</DialogTitle>
                        <DialogDescription>
                            Actualiza Nombre y Celular. ConversationId no se modifica.
                        </DialogDescription>
                    </DialogHeader>

                    {editingLead && (
                        <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                            <div className="truncate">
                                <span className="text-muted-foreground">LeadKey:</span>{" "}
                                <b>{safeStr((editingLead as any).LeadKey) || "—"}</b>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Canal:</span>{" "}
                                {safeStr((editingLead as any).Canal) || "—"}
                            </div>
                        </div>
                    )}

                    {msgEdit && (
                        <div
                            className={`rounded-lg border p-3 text-sm ${msgEdit.type === "ok" ? "bg-muted/30" : "bg-destructive/10"
                                }`}
                        >
                            {msgEdit.text}
                        </div>
                    )}

                    <div className="grid gap-3">
                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Nombre</div>
                            <Input
                                value={eNombre}
                                onChange={(e) => setENombre(e.target.value)}
                                placeholder="Nombre del lead"
                            />
                        </div>

                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Celular</div>
                            <Input
                                value={eCelular}
                                onChange={(e) => setECelular(e.target.value)}
                                placeholder="Ej: 978656325"
                                inputMode="numeric"
                            />
                            <div className="text-xs text-muted-foreground">
                                Tip: puedes dejarlo vacío si aún no lo tienes.
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button
                            variant="secondary"
                            onClick={() => setOpenEdit(false)}
                            disabled={savingEdit}
                        >
                            Cerrar
                        </Button>
                        <Button onClick={saveEdit} disabled={savingEdit}>
                            {savingEdit ? "Guardando…" : "Guardar"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

