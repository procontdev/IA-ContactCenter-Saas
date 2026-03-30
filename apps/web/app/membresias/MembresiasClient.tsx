"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import type { MembresiaRow, Paged } from "@/lib/types";

import { Topbar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";

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

function normLower(v: any) {
    return safeStr(v).toLowerCase();
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
// UI helpers (estilo “pro”)
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

function whatsappBtnClass(enabled: boolean) {
    if (!enabled) return "";
    return "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60";
}

function estadoBadge(estado: string) {
    const e = normLower(estado);
    if (e.startsWith("conf")) {
        return (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-900 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900/40">
                Confirmada
            </span>
        );
    }
    if (e.startsWith("reg")) {
        return (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-900 border border-slate-200 dark:bg-slate-950/40 dark:text-slate-200 dark:border-slate-800">
                Registrada
            </span>
        );
    }
    return (
        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-muted text-foreground border">
            {safeStr(estado) || "—"}
        </span>
    );
}

function pagadoBadge(pagado: string) {
    const p = normLower(pagado);
    if (p === "si" || p === "sí") {
        return (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-900 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900/40">
                Pagado
            </span>
        );
    }
    if (p === "no") {
        return (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-900 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900/40">
                Pendiente
            </span>
        );
    }
    return (
        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-muted text-foreground border">
            {safeStr(pagado) || "—"}
        </span>
    );
}

function metodoChip(metodo: string) {
    const m = safeStr(metodo);
    if (!m) return null;
    return (
        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-950/40 dark:text-slate-200 dark:border-slate-800">
            {m}
        </span>
    );
}

function rowHighlightClass(estado: string, pagado: string) {
    const e = normLower(estado);
    const p = normLower(pagado);

    if (e.startsWith("conf") && p === "no") return "bg-amber-50/40 dark:bg-amber-950/20";
    if (e.startsWith("conf") && (p === "si" || p === "sí"))
        return "bg-emerald-50/30 dark:bg-emerald-950/15";

    return "";
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
// Historial (inferido)
// =======================
function buildHistoryFromRow(r: any) {
    const events: Array<{
        at: string;
        title: string;
        detail?: string;
        tone?: "ok" | "warn" | "info";
    }> = [];

    const fh = safeStr(r?.FechaHora);
    if (fh) {
        events.push({
            at: fh,
            title: "Registro creado",
            detail: `Se registró la pre-reserva/membresía.`,
            tone: "info",
        });
    }

    const estado = safeStr(r?.Estado);
    if (estado) {
        events.push({
            at: fh || new Date().toISOString(),
            title: `Estado: ${estado}`,
            detail: "Estado actual de la membresía.",
            tone: estado.toLowerCase().startsWith("conf") ? "ok" : "info",
        });
    }

    const pagado = safeStr(r?.Pagado);
    if (pagado) {
        events.push({
            at: fh || new Date().toISOString(),
            title: `Pago: ${pagado}`,
            detail: "Situación de pago actual.",
            tone:
                pagado.toLowerCase() === "si" || pagado.toLowerCase() === "sí"
                    ? "ok"
                    : "warn",
        });
    }

    const fp = safeStr(r?.FechaPago || r?.["Fecha Pago"]);
    const mp = safeStr(r?.MetodoPago || r?.["Metodo Pago"]);
    if (fp || mp) {
        events.push({
            at: fp || fh || new Date().toISOString(),
            title: "Detalle de pago",
            detail: [mp ? `Método: ${mp}` : null, fp ? `Fecha pago: ${fp}` : null]
                .filter(Boolean)
                .join(" · "),
            tone: "ok",
        });
    }

    const upd = safeStr(r?._updatedAt);
    if (upd) {
        events.push({
            at: upd,
            title: "Actualizado desde dashboard",
            detail: "Último cambio registrado por API (updatedAt).",
            tone: "info",
        });
    }

    // Ordena por fecha desc (más reciente primero)
    events.sort((a, b) => {
        const da = new Date(a.at).getTime();
        const db = new Date(b.at).getTime();
        return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da);
    });

    return events;
}

function historyDotClass(tone?: "ok" | "warn" | "info") {
    if (tone === "ok") return "bg-emerald-500/90";
    if (tone === "warn") return "bg-amber-500/90";
    return "bg-sky-500/90";
}

type UpdateResp =
    | {
        ok: true;
        row_number: number;
        updated: any;
        meta?: { updatedAt?: string; timezone?: string };
    }
    | { ok: false; error?: string; message?: string; leadKey?: string; meta?: any };

async function updateMembresia(leadKey: string, patch: Record<string, any>) {
    const res = await apiPost<UpdateResp>("/api/membresias/update", { leadKey, patch });
    if (!res.ok) throw new Error((res as any).message || (res as any).error || "Error actualizando membresía");
    return res;
}

function toISODate(d: Date) {
    return d.toISOString().slice(0, 10);
}

// =======================
// Normalización row from API
// - Soporta claves: "Membresía", "Metodo Pago", "Fecha Pago"
// - Limpia saltos de línea en Canal
// =======================
function normalizeRowFromApiUpdated(u: any, updatedAt?: string) {
    const next: any = { ...(u || {}) };

    // Canal sin \n
    if (next.Canal !== undefined) next.Canal = compactText(next.Canal);

    // Membresía
    if (next.Membresia === undefined && next["Membresía"] !== undefined) {
        next.Membresia = next["Membresía"];
    }
    if (next["Membresía"] === undefined && next.Membresia !== undefined) {
        next["Membresía"] = next.Membresia;
    }

    // Método pago
    if (next.MetodoPago === undefined && next["Metodo Pago"] !== undefined) {
        next.MetodoPago = next["Metodo Pago"];
    }
    if (next["Metodo Pago"] === undefined && next.MetodoPago !== undefined) {
        next["Metodo Pago"] = next.MetodoPago;
    }

    // Fecha pago
    if (next.FechaPago === undefined && next["Fecha Pago"] !== undefined) {
        next.FechaPago = next["Fecha Pago"];
    }
    if (next["Fecha Pago"] === undefined && next.FechaPago !== undefined) {
        next["Fecha Pago"] = next.FechaPago;
    }

    // Celular como string para evitar issues en UI
    if (next.Celular !== undefined && next.Celular !== null) {
        next.Celular = String(next.Celular).trim();
    }

    // marcador para historial UI
    if (updatedAt) next._updatedAt = updatedAt;

    return next;
}

function replaceRowInPaged(current: any, leadKey: string, newRow: any) {
    if (!current?.data) return current;

    const nextData = current.data.map((r: any) => {
        if (String(r.LeadKey || "") !== String(leadKey)) return r;
        // merge: conserva props locales si existieran, pero prioriza API
        return { ...r, ...newRow };
    });

    return { ...current, data: nextData };
}

export default function MembresiasClient() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // filtros UI
    const [from, setFrom] = useState<string>("");
    const [to, setTo] = useState<string>("");
    const [canal, setCanal] = useState<string>("");
    const [estado, setEstado] = useState<string>("");
    const [pagado, setPagado] = useState<string>("");
    const [membresia, setMembresia] = useState<string>("");

    // búsqueda: q aplicado vs typingQ (input vivo)
    const [q, setQ] = useState<string>("");
    const [typingQ, setTypingQ] = useState<string>("");

    const debounceRef = useRef<any>(null);

    // paginación
    const [page, setPage] = useState<number>(1);
    const pageSize = 50;

    // aplicar filtros
    const [applied, setApplied] = useState({
        from: "",
        to: "",
        canal: "",
        estado: "",
        pagado: "",
        membresia: "",
        q: "",
    });

    // evitar warning Router-in-render: ref al último applied
    const appliedRef = useRef(applied);
    useEffect(() => {
        appliedRef.current = applied;
    }, [applied]);

    // mensajes
    const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

    // ======== Sheet detalle (derecha→izq) ========
    const [openDetail, setOpenDetail] = useState(false);
    const [detailRow, setDetailRow] = useState<MembresiaRow | null>(null);

    function openMembresiaDetail(row: MembresiaRow) {
        setDetailRow(row);
        setOpenDetail(true);
    }

    function membresiaSummaryText(r: any) {
        const nombre = safeStr(r?.Nombre);
        const celular = safeStr(r?.Celular);
        const canalTxt = compactText(r?.Canal);
        const conv = safeStr(r?.ConversationId);
        const lk = safeStr(r?.LeadKey);

        const tipo = safeStr((r as any)?.Membresia || (r as any)?.["Membresía"]);
        const ini = safeStr(r?.Inicio);
        const est = safeStr(r?.Estado);
        const pag = safeStr(r?.Pagado);
        const met = safeStr((r as any)?.MetodoPago || (r as any)?.["Metodo Pago"]);
        const fp = safeStr((r as any)?.FechaPago || (r as any)?.["Fecha Pago"]);
        const fh = safeStr(r?.FechaHora);
        const notas = safeStr(r?.Notas);

        return [
            `MEMBRESÍA MGym`,
            nombre ? `Nombre: ${nombre}` : null,
            canalTxt ? `Canal: ${canalTxt}` : null,
            celular ? `Celular: ${celular}` : `Celular: (vacío)`,
            conv ? `ConversationId: ${conv}` : null,
            lk ? `LeadKey: ${lk}` : null,
            tipo ? `Membresía: ${tipo}` : null,
            ini ? `Inicio: ${ini}` : null,
            est ? `Estado: ${est}` : null,
            pag ? `Pagado: ${pag}` : null,
            met ? `Método: ${met}` : null,
            fp ? `Fecha pago: ${fp}` : null,
            fh ? `Fecha registro: ${fh}` : null,
            notas ? `Notas: ${notas}` : null,
        ]
            .filter(Boolean)
            .join("\n");
    }

    // Modal edición
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<MembresiaRow | null>(null);

    const [eEstado, setEEstado] = useState<string>("");
    const [ePagado, setEPagado] = useState<string>("");
    const [eMetodoPago, setEMetodoPago] = useState<string>("");
    const [eFechaPago, setEFechaPago] = useState<string>("");
    const [eNotas, setENotas] = useState<string>("");
    const [saving, setSaving] = useState(false);

    // preload desde URL (drill-down)
    const appliedFromUrlOnce = useRef(false);
    useEffect(() => {
        if (appliedFromUrlOnce.current) return;

        const canalQ = searchParams.get("canal") || "";
        const estadoQ = searchParams.get("estado") || "";
        const pagadoQ = searchParams.get("pagado") || "";
        const membresiaQ = searchParams.get("membresia") || "";
        const qQ = searchParams.get("q") || "";
        const fromQ = searchParams.get("from") || "";
        const toQ = searchParams.get("to") || "";

        if (canalQ || estadoQ || pagadoQ || membresiaQ || qQ || fromQ || toQ) {
            appliedFromUrlOnce.current = true;

            setCanal(canalQ);
            setEstado(estadoQ);
            setPagado(pagadoQ);
            setMembresia(membresiaQ);

            setQ(qQ);
            setTypingQ(qQ);

            setFrom(fromQ);
            setTo(toQ);

            const next = {
                canal: canalQ,
                estado: estadoQ,
                pagado: pagadoQ,
                membresia: membresiaQ,
                q: qQ,
                from: fromQ,
                to: toQ,
            };

            setApplied(next);
            setPage(1);
        }
    }, [searchParams]);

    // mantener typingQ sincronizado cuando q cambia por presets
    useEffect(() => {
        setTypingQ(q);
    }, [q]);

    // construir params
    const params = useMemo(() => {
        return {
            from: applied.from || undefined,
            to: applied.to || undefined,
            canal: applied.canal || undefined,
            estado: applied.estado || undefined,
            pagado: applied.pagado || undefined,
            membresia: applied.membresia || undefined,
            q: applied.q || undefined,
            page,
            pageSize,
        };
    }, [applied, page, pageSize]);

    const swrKey = useMemo(() => ["membresias", params], [params]);

    const { data, error, isLoading, mutate } = useSWR<Paged<MembresiaRow>>(
        swrKey,
        () => apiGet<Paged<MembresiaRow>>("/api/membresias", params),
        { revalidateOnFocus: false }
    );

    const total = data?.meta.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // ===== URL helpers =====
    function pushUrl(next: typeof applied) {
        const sp = new URLSearchParams();
        if (next.from) sp.set("from", next.from);
        if (next.to) sp.set("to", next.to);
        if (next.canal) sp.set("canal", next.canal);
        if (next.estado) sp.set("estado", next.estado);
        if (next.pagado) sp.set("pagado", next.pagado);
        if (next.membresia) sp.set("membresia", next.membresia);
        if (next.q) sp.set("q", next.q);

        const qs = sp.toString();
        router.replace(qs ? `/membresias?${qs}` : "/membresias");
    }

    type Preset = Partial<typeof applied>;

    function applyPreset(partial: Preset) {
        const next = {
            from,
            to,
            canal,
            estado,
            pagado,
            membresia,
            q: typingQ, // 👈 usa lo que el usuario está escribiendo
            ...partial,
        };

        // sincroniza inputs (UI)
        setFrom(next.from);
        setTo(next.to);
        setCanal(next.canal);
        setEstado(next.estado);
        setPagado(next.pagado);
        setMembresia(next.membresia);

        setQ(next.q);
        setTypingQ(next.q);

        // aplica filtros reales
        setApplied(next);
        setPage(1);

        // URL
        pushUrl(next);
    }

    function applyFilters() {
        applyPreset({});
    }

    function clearFilters() {
        applyPreset({
            from: "",
            to: "",
            canal: "",
            estado: "",
            pagado: "",
            membresia: "",
            q: "",
        });
    }

    // ===== Debounce búsqueda =====
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);

        debounceRef.current = setTimeout(() => {
            if (typingQ !== q) {
                const next = { ...appliedRef.current, q: typingQ };

                setQ(typingQ);
                setApplied(next);
                setPage(1);

                pushUrl(next);
            }
        }, 400);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [typingQ, q]);

    // ✅ KPIs rápidos (sobre la página actual)
    const pageKpis = useMemo(() => {
        const rows = data?.data ?? [];

        let registradas = 0;
        let confirmadas = 0;
        let pendientes = 0;
        let pagadas = 0;

        for (const r of rows) {
            const e = normLower((r as any).Estado);
            const p = normLower((r as any).Pagado);

            if (e.startsWith("reg")) registradas++;
            if (e.startsWith("conf")) confirmadas++;

            if (p === "no") pendientes++;
            if (p === "si" || p === "sí") pagadas++;
        }

        return {
            enPantalla: rows.length,
            registradas,
            confirmadas,
            pendientes,
            pagadas,
        };
    }, [data?.data]);

    // ✅ Export CSV (lo que ves en pantalla)
    function exportMembresiasCsv() {
        const rows = data?.data ?? [];

        const headers = [
            "FechaHora",
            "Canal",
            "Nombre",
            "Celular",
            "Inicio",
            "ConversationId",
            "Notas",
            "Membresia",
            "LeadKey",
            "Estado",
            "Pagado",
            "MetodoPago",
            "FechaPago",
        ];

        const csv = rowsToCsv(headers, rows, (r: any) => [
            r.FechaHora ?? "",
            compactText(r.Canal ?? ""),
            compactText(r.Nombre ?? ""),
            compactText(r.Celular ?? ""),
            r.Inicio ?? "",
            r.ConversationId ?? "",
            compactText(r.Notas ?? ""),
            compactText(r.Membresia ?? r["Membresía"] ?? ""),
            r.LeadKey ?? "",
            compactText(r.Estado ?? ""),
            compactText(r.Pagado ?? ""),
            compactText(r.MetodoPago ?? r["Metodo Pago"] ?? ""),
            compactText(r.FechaPago ?? r["Fecha Pago"] ?? ""),
        ]);

        const suffix =
            (applied.canal ? `_canal-${compactText(applied.canal)}` : "") +
            (applied.estado ? `_estado-${compactText(applied.estado)}` : "") +
            (applied.pagado ? `_pagado-${compactText(applied.pagado)}` : "") +
            (applied.membresia ? `_memb-${compactText(applied.membresia)}` : "") +
            (applied.from ? `_from-${applied.from}` : "") +
            (applied.to ? `_to-${applied.to}` : "");

        downloadTextFile(`membresias_${nowFileStamp()}${suffix}.csv`, csv);
    }

    // ========= Optimistic update helpers =========
    function applyPatchToRow(row: any, patch: Record<string, any>) {
        const next = { ...row };

        if (patch.Estado !== undefined) next.Estado = patch.Estado;
        if (patch.Pagado !== undefined) next.Pagado = patch.Pagado;

        if (patch.MetodoPago !== undefined) {
            next.MetodoPago = patch.MetodoPago;
            next["Metodo Pago"] = patch.MetodoPago;
        }
        if (patch["Metodo Pago"] !== undefined) {
            next.MetodoPago = patch["Metodo Pago"];
            next["Metodo Pago"] = patch["Metodo Pago"];
        }

        if (patch.FechaPago !== undefined) {
            next.FechaPago = patch.FechaPago;
            next["Fecha Pago"] = patch.FechaPago;
        }
        if (patch["Fecha Pago"] !== undefined) {
            next.FechaPago = patch["Fecha Pago"];
            next["Fecha Pago"] = patch["Fecha Pago"];
        }

        if (patch.Notas !== undefined) next.Notas = patch.Notas;

        // meta local para historial UI
        if (patch.__updatedAt) {
            next._updatedAt = patch.__updatedAt;
        }

        return next;
    }

    function applyPatchToPaged(current: any, leadKey: string, patch: Record<string, any>) {
        if (!current?.data) return current;

        const nextData = current.data.map((r: any) => {
            if (String(r.LeadKey || "") !== String(leadKey)) return r;
            return applyPatchToRow(r, patch);
        });

        return { ...current, data: nextData };
    }

    function syncLocalSelectedRows(leadKey: string, newRow: any) {
        // sheet detalle
        setDetailRow((prev) => {
            if (!prev) return prev;
            if (String((prev as any).LeadKey || "") !== String(leadKey)) return prev;
            return { ...(prev as any), ...(newRow as any) } as any;
        });

        // modal edición
        setEditing((prev) => {
            if (!prev) return prev;
            if (String((prev as any).LeadKey || "") !== String(leadKey)) return prev;
            return { ...(prev as any), ...(newRow as any) } as any;
        });
    }

    async function optimisticUpdate(
        mutateFn: any,
        leadKey: string,
        patch: Record<string, any>,
        apiCall: () => Promise<UpdateResp>
    ): Promise<UpdateResp> {
        const optimistic = (current: any) => applyPatchToPaged(current, leadKey, patch);

        let result: UpdateResp | undefined;

        await mutateFn(
            async (current: any) => {
                const resp = await apiCall();
                result = resp;

                // ✅ si backend devolvió "updated", reemplazamos con esa fuente de verdad
                if ((resp as any)?.ok && (resp as any)?.updated) {
                    const updatedAt = (resp as any)?.meta?.updatedAt;
                    const normalized = normalizeRowFromApiUpdated((resp as any).updated, updatedAt);
                    return replaceRowInPaged(current, leadKey, normalized);
                }

                // fallback: solo aplica patch (no debería ocurrir si ok=true siempre trae updated)
                const updatedAt = (resp as any)?.meta?.updatedAt;
                const patchWithMeta = updatedAt ? { ...patch, __updatedAt: updatedAt } : patch;
                return applyPatchToPaged(current, leadKey, patchWithMeta);
            },
            {
                optimisticData: optimistic,
                rollbackOnError: true,
                populateCache: true,
                revalidate: false,
            }
        );

        // Si por alguna razón no hubo respuesta (muy raro), lanzamos error explícito
        if (!result) {
            throw new Error("No se recibió respuesta del servidor");
        }

        // ✅ sync también en sheet/modal (para que historial cambie al toque)
        if ((result as any).ok && (result as any).updated) {
            const updatedAt = (result as any)?.meta?.updatedAt;
            const normalized = normalizeRowFromApiUpdated((result as any).updated, updatedAt);
            syncLocalSelectedRows(leadKey, normalized);
        } else if ((result as any)?.meta?.updatedAt) {
            syncLocalSelectedRows(leadKey, { _updatedAt: (result as any).meta.updatedAt });
        }

        return result;
    }


    async function quickConfirm(row: MembresiaRow) {
        setMsg(null);

        const leadKey = row.LeadKey;
        const patch = { Estado: "Confirmada" };

        try {
            await optimisticUpdate(mutate, leadKey, patch, () => updateMembresia(leadKey, patch));
            setMsg({ type: "ok", text: "Membresía confirmada ✅" });
        } catch (e: any) {
            setMsg({ type: "err", text: e?.message || "Error confirmando" });
        }
    }

    async function quickPaid(row: MembresiaRow) {
        setMsg(null);

        const leadKey = row.LeadKey;

        // Optimistic: muestra pagado + fecha (luego backend devuelve la real)
        const optimisticPatch = {
            Pagado: "Si",
            FechaPago: new Date().toISOString(),
        };

        try {
            await optimisticUpdate(mutate, leadKey, optimisticPatch, () =>
                // en backend puedes setear fecha automáticamente si la mandas vacía
                updateMembresia(leadKey, { Pagado: "Si", FechaPago: "" })
            );

            setMsg({ type: "ok", text: "Marcado como pagado ✅" });
        } catch (e: any) {
            setMsg({ type: "err", text: e?.message || "Error marcando pagado" });
        }
    }

    function openEdit(row: MembresiaRow) {
        setMsg(null);
        setEditing(row);

        setEEstado(safeStr((row as any).Estado));
        setEPagado(safeStr((row as any).Pagado));
        setEMetodoPago(safeStr((row as any).MetodoPago || (row as any)["Metodo Pago"] || ""));
        setEFechaPago(safeStr((row as any).FechaPago || (row as any)["Fecha Pago"] || ""));
        setENotas(safeStr((row as any).Notas || ""));

        setOpen(true);
    }

    async function saveEdit() {
        if (!editing) return;

        setSaving(true);
        setMsg(null);

        const leadKey = (editing as any).LeadKey;

        const patch: Record<string, any> = {
            Estado: eEstado || "",
            Pagado: ePagado || "",
            MetodoPago: eMetodoPago || "",
            FechaPago: eFechaPago || "",
            Notas: eNotas || "",
        };

        try {
            await optimisticUpdate(mutate, leadKey, patch, () => updateMembresia(leadKey, patch));

            setMsg({ type: "ok", text: "Actualizado ✅" });
            setOpen(false);
            setEditing(null);
        } catch (e: any) {
            setMsg({ type: "err", text: e?.message || "Error actualizando" });
        } finally {
            setSaving(false);
        }
    }

    return (
        <div>
            <Topbar title="Membresías" onRefresh={() => mutate()} />

            <div className="p-6 space-y-4">
                {/* Mensaje */}
                {msg && (
                    <div
                        className={`rounded-lg border p-3 text-sm ${msg.type === "ok" ? "bg-muted/30" : "bg-destructive/10"
                            }`}
                    >
                        {msg.text}
                    </div>
                )}

                {/* Filtros */}
                <div className="rounded-lg border bg-card p-4">
                    <div className="grid gap-3 md:grid-cols-6">
                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Desde</div>
                            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                        </div>

                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Hasta</div>
                            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                        </div>

                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Canal</div>
                            <Input
                                placeholder="Telegram / Web / WhatsApp…"
                                value={canal}
                                onChange={(e) => setCanal(e.target.value)}
                            />
                        </div>

                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Estado</div>
                            <Select value={estado} onValueChange={(v) => setEstado(v === "__all__" ? "" : v)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Todos" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__all__">Todos</SelectItem>
                                    <SelectItem value="Registrada">Registrada</SelectItem>
                                    <SelectItem value="Confirmada">Confirmada</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Pagado</div>
                            <Select value={pagado} onValueChange={(v) => setPagado(v === "__all__" ? "" : v)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Todos" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__all__">Todos</SelectItem>
                                    <SelectItem value="Si">Si</SelectItem>
                                    <SelectItem value="No">No</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Membresía</div>
                            <Select value={membresia} onValueChange={(v) => setMembresia(v === "__all__" ? "" : v)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Todas" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__all__">Todas</SelectItem>
                                    <SelectItem value="1 mes">1 mes</SelectItem>
                                    <SelectItem value="2 meses">2 meses</SelectItem>
                                    <SelectItem value="3 meses">3 meses</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Buscar</div>
                            <Input
                                placeholder="Nombre, celular, LeadKey, notas…"
                                value={typingQ}
                                onChange={(e) => setTypingQ(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        if (debounceRef.current) clearTimeout(debounceRef.current);

                                        const next = { ...appliedRef.current, q: typingQ };
                                        setQ(typingQ);
                                        setApplied(next);
                                        setPage(1);
                                        pushUrl(next);
                                    }
                                }}
                            />
                        </div>

                        <div className="flex items-end gap-2 md:justify-end">
                            <Button onClick={applyFilters}>Aplicar</Button>
                            <Button variant="secondary" onClick={clearFilters}>
                                Limpiar
                            </Button>
                            <Button variant="outline" onClick={() => mutate()}>
                                Refrescar
                            </Button>

                            <Button
                                variant="outline"
                                onClick={exportMembresiasCsv}
                                disabled={(data?.data?.length ?? 0) === 0}
                                title="Exporta lo que estás viendo en pantalla"
                            >
                                Exportar CSV
                            </Button>

                            <div className="ml-auto text-sm text-muted-foreground md:ml-4">
                                {isLoading ? "Cargando…" : `Total: ${total}`}
                            </div>
                        </div>
                    </div>

                    {/* Atajos */}
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => applyPreset({ pagado: "No" })}>
                            Pendientes
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => applyPreset({ pagado: "Si" })}>
                            Pagadas
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => applyPreset({ estado: "Confirmada" })}>
                            Confirmadas
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => applyPreset({ estado: "Registrada" })}>
                            Registradas
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

                        <Button variant="outline" size="sm" onClick={() => applyPreset({ canal: "Telegram" })}>
                            Canal: Telegram
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => applyPreset({ canal: "Web" })}>
                            Canal: Web
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => applyPreset({ canal: "WhatsApp" })}>
                            Canal: WhatsApp
                        </Button>
                    </div>
                </div>

                {error && (
                    <div className="rounded-lg border p-4 text-sm">
                        Error cargando membresías.{" "}
                        <Button variant="link" onClick={() => mutate()}>
                            Reintentar
                        </Button>
                    </div>
                )}

                {/* KPIs rápidos (página actual) */}
                {!isLoading && (data?.data?.length ?? 0) > 0 && (
                    <div className="grid gap-3 md:grid-cols-5">
                        <div className="rounded-lg border bg-card p-4">
                            <div className="text-xs text-muted-foreground">En pantalla</div>
                            <div className="mt-1 text-2xl font-semibold">{pageKpis.enPantalla}</div>
                        </div>

                        <div className="rounded-lg border bg-card p-4">
                            <div className="text-xs text-muted-foreground">Registradas</div>
                            <div className="mt-1 text-2xl font-semibold">{pageKpis.registradas}</div>
                        </div>

                        <div className="rounded-lg border bg-card p-4">
                            <div className="text-xs text-muted-foreground">Confirmadas</div>
                            <div className="mt-1 text-2xl font-semibold">{pageKpis.confirmadas}</div>
                        </div>

                        <div className="rounded-lg border bg-card p-4">
                            <div className="text-xs text-muted-foreground">Pendientes</div>
                            <div className="mt-1 text-2xl font-semibold">{pageKpis.pendientes}</div>
                        </div>

                        <div className="rounded-lg border bg-card p-4">
                            <div className="text-xs text-muted-foreground">Pagadas</div>
                            <div className="mt-1 text-2xl font-semibold">{pageKpis.pagadas}</div>
                        </div>
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
                                <TableHead>Membresía</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead>Pago</TableHead>
                                <TableHead>Inicio</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>

                        <TableBody>
                            {/* ✅ Skeleton loading */}
                            {isLoading && (
                                <>
                                    {Array.from({ length: 8 }).map((_, i) => (
                                        <TableRow key={`sk-${i}`}>
                                            <TableCell>
                                                <Skeleton className="h-4 w-36" />
                                            </TableCell>
                                            <TableCell>
                                                <Skeleton className="h-5 w-20" />
                                            </TableCell>
                                            <TableCell>
                                                <Skeleton className="h-4 w-48" />
                                            </TableCell>
                                            <TableCell>
                                                <Skeleton className="h-4 w-24" />
                                            </TableCell>
                                            <TableCell>
                                                <Skeleton className="h-5 w-24" />
                                            </TableCell>
                                            <TableCell>
                                                <Skeleton className="h-5 w-28" />
                                            </TableCell>
                                            <TableCell>
                                                <Skeleton className="h-4 w-24" />
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Skeleton className="h-8 w-20" />
                                                    <Skeleton className="h-8 w-24" />
                                                    <Skeleton className="h-8 w-20" />
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </>
                            )}

                            {/* ✅ Empty state pro */}
                            {!isLoading && (data?.data?.length ?? 0) === 0 && (
                                <TableRow>
                                    <TableCell colSpan={8} className="py-10">
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

                            {!isLoading &&
                                data?.data?.map((r) => {
                                    const celular = safeStr((r as any).Celular);
                                    const leadKey = safeStr((r as any).LeadKey);
                                    const wa = celular ? `https://wa.me/51${celular}` : "";

                                    const estadoVal = safeStr((r as any).Estado) || "—";
                                    const pagadoVal = safeStr((r as any).Pagado) || "—";
                                    const metodo = safeStr((r as any).MetodoPago || (r as any)["Metodo Pago"] || "");

                                    const canalTxt = compactText((r as any).Canal) || "—";

                                    return (
                                        <TableRow
                                            key={(r as any).id || leadKey}
                                            className={rowHighlightClass(estadoVal, pagadoVal)}
                                        >
                                            <TableCell className="whitespace-nowrap">{fmtDate((r as any).FechaHora)}</TableCell>

                                            <TableCell className="whitespace-nowrap">
                                                <Badge variant="outline" className={canalBadgeClass(canalTxt)}>
                                                    {canalTxt}
                                                </Badge>
                                            </TableCell>

                                            <TableCell className="font-medium">{safeStr((r as any).Nombre) || "—"}</TableCell>

                                            <TableCell className="whitespace-nowrap">
                                                {safeStr((r as any).Membresia) || safeStr((r as any)["Membresía"]) || "—"}
                                            </TableCell>

                                            <TableCell className="whitespace-nowrap">{estadoBadge(estadoVal)}</TableCell>

                                            <TableCell className="whitespace-nowrap">
                                                <div className="flex flex-col gap-1 items-start">
                                                    {pagadoBadge(pagadoVal)}
                                                    {metodoChip(metodo)}
                                                </div>
                                            </TableCell>

                                            <TableCell className="whitespace-nowrap">{safeStr((r as any).Inicio) || "—"}</TableCell>

                                            <TableCell className="text-right space-x-2">
                                                <Button variant="outline" size="sm" onClick={() => openMembresiaDetail(r)}>
                                                    Detalle
                                                </Button>

                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => copyToClipboard(leadKey)}
                                                    disabled={!leadKey}
                                                    title="Copiar LeadKey"
                                                >
                                                    Copiar
                                                </Button>

                                                {wa ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        asChild
                                                        className={whatsappBtnClass(true)}
                                                        title="Abrir WhatsApp"
                                                    >
                                                        <a href={wa} target="_blank" rel="noreferrer">
                                                            WhatsApp
                                                        </a>
                                                    </Button>
                                                ) : (
                                                    <Button variant="outline" size="sm" disabled title="Sin celular">
                                                        WhatsApp
                                                    </Button>
                                                )}

                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => quickConfirm(r)}
                                                    disabled={estadoVal.toLowerCase().startsWith("confirm")}
                                                    title="Marcar como confirmada"
                                                >
                                                    Confirmar
                                                </Button>

                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => quickPaid(r)}
                                                    disabled={pagadoVal.toLowerCase() === "si" || pagadoVal.toLowerCase() === "sí"}
                                                    title="Marcar como pagada"
                                                >
                                                    Pagado
                                                </Button>

                                                <Button variant="outline" size="sm" onClick={() => openEdit(r)} title="Editar">
                                                    Editar
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
                            <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
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

            {/* ================= Sheet: Detalle membresía ================= */}
            <Sheet open={openDetail} onOpenChange={setOpenDetail}>
                <SheetContent side="right" className="w-full sm:max-w-[560px]">
                    <SheetHeader>
                        <SheetTitle>Detalle de membresía</SheetTitle>
                        <SheetDescription>Acciones rápidas para el counter</SheetDescription>
                    </SheetHeader>

                    {!detailRow ? (
                        <div className="mt-6 text-sm text-muted-foreground">Sin selección</div>
                    ) : (
                        <div className="mt-6 space-y-4">
                            <div className="rounded-lg border bg-card p-4 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-base font-semibold">{safeStr((detailRow as any).Nombre) || "—"}</div>
                                    <Badge
                                        variant="outline"
                                        className={canalBadgeClass(compactText((detailRow as any).Canal))}
                                    >
                                        {compactText((detailRow as any).Canal) || "—"}
                                    </Badge>
                                </div>

                                {/* ===== Historial ===== */}
                                {(() => {
                                    const events = buildHistoryFromRow(detailRow);
                                    const notes = safeStr((detailRow as any).Notas);

                                    return (
                                        <div className="rounded-lg border bg-card p-4">
                                            <div className="flex items-center justify-between">
                                                <div className="text-sm font-semibold">Historial</div>
                                                <div className="text-xs text-muted-foreground">(inferido con datos actuales)</div>
                                            </div>

                                            <div className="mt-3 space-y-3">
                                                {events.length === 0 ? (
                                                    <div className="text-sm text-muted-foreground">Sin eventos</div>
                                                ) : (
                                                    events.map((ev, idx) => (
                                                        <div key={idx} className="flex gap-3">
                                                            <div className="mt-1.5">
                                                                <div className={`h-2.5 w-2.5 rounded-full ${historyDotClass(ev.tone)}`} />
                                                            </div>

                                                            <div className="min-w-0">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <div className="text-sm font-medium">{ev.title}</div>
                                                                    <div className="text-xs text-muted-foreground">{fmtDate(ev.at)}</div>
                                                                </div>
                                                                {ev.detail && (
                                                                    <div className="text-sm text-muted-foreground">{ev.detail}</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>

                                            {notes && (
                                                <div className="mt-4 border-t pt-3">
                                                    <div className="text-xs font-medium text-muted-foreground">Notas</div>
                                                    <div className="mt-1 whitespace-pre-wrap break-words text-sm">{notes}</div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                <div className="flex flex-wrap gap-2">
                                    {estadoBadge(safeStr((detailRow as any).Estado))}
                                    {pagadoBadge(safeStr((detailRow as any).Pagado))}
                                    {metodoChip(safeStr((detailRow as any).MetodoPago || (detailRow as any)["Metodo Pago"] || ""))}
                                </div>

                                <div className="text-sm">
                                    <span className="text-muted-foreground">Celular: </span>
                                    <span className="font-medium">{safeStr((detailRow as any).Celular) || "—"}</span>
                                </div>

                                <div className="text-sm">
                                    <span className="text-muted-foreground">LeadKey: </span>
                                    <span className="font-mono text-xs break-all">{safeStr((detailRow as any).LeadKey) || "—"}</span>
                                </div>

                                <div className="text-sm">
                                    <span className="text-muted-foreground">Membresía: </span>
                                    <span className="font-medium">
                                        {safeStr((detailRow as any).Membresia || (detailRow as any)["Membresía"]) || "—"}
                                    </span>
                                </div>

                                <div className="text-sm">
                                    <span className="text-muted-foreground">Inicio: </span>
                                    <span className="font-medium">{safeStr((detailRow as any).Inicio) || "—"}</span>
                                </div>

                                <div className="text-sm">
                                    <span className="text-muted-foreground">Fecha registro: </span>
                                    <span className="font-medium">
                                        {safeStr((detailRow as any).FechaHora) ? fmtDate(safeStr((detailRow as any).FechaHora)) : "—"}
                                    </span>
                                </div>

                                {!!safeStr((detailRow as any).Notas) && (
                                    <div className="text-sm">
                                        <div className="text-xs text-muted-foreground">Notas</div>
                                        <div className="mt-1 whitespace-pre-wrap break-words">{safeStr((detailRow as any).Notas)}</div>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <Button variant="outline" onClick={() => copyToClipboard(membresiaSummaryText(detailRow))}>
                                    Copiar resumen
                                </Button>

                                <Button
                                    variant="outline"
                                    onClick={() => copyToClipboard(safeStr((detailRow as any).LeadKey))}
                                    disabled={!safeStr((detailRow as any).LeadKey)}
                                >
                                    Copiar LeadKey
                                </Button>

                                {safeStr((detailRow as any).Celular) ? (
                                    <Button variant="outline" asChild className={whatsappBtnClass(true)}>
                                        <a
                                            href={`https://wa.me/51${safeStr((detailRow as any).Celular)}`}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            WhatsApp
                                        </a>
                                    </Button>
                                ) : (
                                    <Button variant="outline" disabled>
                                        WhatsApp
                                    </Button>
                                )}

                                <Button
                                    variant="secondary"
                                    onClick={() => detailRow && quickConfirm(detailRow)}
                                    disabled={normLower((detailRow as any).Estado).startsWith("conf")}
                                >
                                    Confirmar
                                </Button>

                                <Button
                                    variant="secondary"
                                    onClick={() => detailRow && quickPaid(detailRow)}
                                    disabled={
                                        normLower((detailRow as any).Pagado) === "si" ||
                                        normLower((detailRow as any).Pagado) === "sí"
                                    }
                                >
                                    Pagado
                                </Button>

                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        if (!detailRow) return;
                                        setOpenDetail(false);
                                        openEdit(detailRow);
                                    }}
                                >
                                    Editar
                                </Button>
                            </div>
                        </div>
                    )}
                </SheetContent>
            </Sheet>

            {/* Modal editar */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-[560px]">
                    <DialogHeader>
                        <DialogTitle>Editar membresía</DialogTitle>
                        <DialogDescription>Actualiza estado/pago/notas. Se guarda directo en Google Sheets vía n8n.</DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                                <div className="text-xs text-muted-foreground">Estado</div>
                                <Select value={eEstado} onValueChange={setEEstado}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecciona" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Registrada">Registrada</SelectItem>
                                        <SelectItem value="Confirmada">Confirmada</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <div className="text-xs text-muted-foreground">Pagado</div>
                                <Select value={ePagado} onValueChange={setEPagado}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecciona" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="No">No</SelectItem>
                                        <SelectItem value="Si">Si</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                                <div className="text-xs text-muted-foreground">Método pago</div>
                                <Select
                                    value={eMetodoPago || "__none__"}
                                    onValueChange={(v) => setEMetodoPago(v === "__none__" ? "" : v)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="(Opcional)" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">(Vacío)</SelectItem>
                                        <SelectItem value="Transferencia">Transferencia</SelectItem>
                                        <SelectItem value="Tarjeta">Tarjeta</SelectItem>
                                        <SelectItem value="Yape">Yape</SelectItem>
                                        <SelectItem value="Efectivo">Efectivo</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <div className="text-xs text-muted-foreground">Fecha pago</div>
                                <Input
                                    placeholder="(vacío = auto)"
                                    value={eFechaPago}
                                    onChange={(e) => setEFechaPago(e.target.value)}
                                />
                                <div className="text-[11px] text-muted-foreground">
                                    Tip: deja vacío y el flujo pone fecha automáticamente cuando Pagado=Si.
                                </div>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Notas</div>
                            <Textarea value={eNotas} onChange={(e) => setENotas(e.target.value)} />
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button onClick={saveEdit} disabled={saving}>
                            {saving ? "Guardando…" : "Guardar"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
