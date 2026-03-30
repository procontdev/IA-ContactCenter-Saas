"use client";

import React, { useRef, useState } from "react";
import { SB_URL, SB_ANON, SB_SCHEMA } from "@/lib/supabaseRest";

// Si ya tienes XLSX instalado úsalo. Si no, comenta el import y deja solo CSV.
import * as XLSX from "xlsx";

type Props = {
    campaignId: string;
    campaignCode?: string;
};

type ImportMode = "merge" | "replace";

function nowIso() {
    return new Date().toISOString();
}

function toE164PE(input: any): string | null {
    const s0 = String(input ?? "").trim();
    if (!s0) return null;

    // deja solo dígitos
    const digits = s0.replace(/[^\d]/g, "");

    // si ya venía con +51 en texto original
    if (s0.startsWith("+") && digits.startsWith("51") && digits.length === 11) {
        return `+${digits}`;
    }

    // si viene 9 dígitos (móvil PE)
    if (digits.length === 9 && digits.startsWith("9")) {
        return `+51${digits}`;
    }

    // si viene 11 y empieza con 51
    if (digits.length === 11 && digits.startsWith("51")) {
        return `+${digits}`;
    }

    // fallback: si parece e164 sin +
    if (digits.length >= 9) return digits.startsWith("51") ? `+${digits}` : `+51${digits.slice(-9)}`;

    return null;
}

function parsePeDateTimeToIso(v: any): string | null {
    if (v === undefined || v === null) return null;

    // Caso XLSX: a veces viene Date real
    if (v instanceof Date && !isNaN(v.getTime())) {
        // asumimos que ese Date representa hora local; lo convertimos a ISO real
        return v.toISOString();
    }

    const s = String(v).trim();
    if (!s) return null;

    // Caso XLSX: a veces viene serial number
    if (/^\d+(\.\d+)?$/.test(s)) {
        const num = Number(s);
        // Excel serial date -> JS Date (UTC-ish)
        // 25569 = días desde 1970-01-01
        const utcMs = Math.round((num - 25569) * 86400 * 1000);
        const d = new Date(utcMs);
        return isNaN(d.getTime()) ? null : d.toISOString();
    }

    // DD/MM/YYYY HH:mm (tu caso)
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (m) {
        const dd = m[1].padStart(2, "0");
        const mm = m[2].padStart(2, "0");
        const yyyy = m[3];
        const hh = (m[4] ?? "00").padStart(2, "0");
        const mi = (m[5] ?? "00").padStart(2, "0");

        // ISO con TZ Perú (America/Lima = -05:00)
        return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00-05:00`;
    }

    // Intento extra: si ya es ISO
    if (s.includes("T") && /\d{4}-\d{2}-\d{2}/.test(s)) return s;

    return null;
}

function detectDelimiter(line: string) {
    const candidates = ["\t", ";", ",", "|"];
    let best = "\t";
    let bestCount = -1;
    for (const d of candidates) {
        const c = line.split(d).length;
        if (c > bestCount) {
            bestCount = c;
            best = d;
        }
    }
    return best;
}

function parseDelimited(text: string): Record<string, string>[] {
    const lines = text
        .replace(/\r/g, "")
        .split("\n")
        .map((l) => l.trimEnd())
        .filter((l) => l.trim().length > 0);

    if (lines.length < 2) return [];

    const delim = detectDelimiter(lines[0]);
    const headers = lines[0].split(delim).map((h) => h.trim());

    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(delim);
        const obj: Record<string, string> = {};
        for (let j = 0; j < headers.length; j++) {
            obj[headers[j]] = (parts[j] ?? "").trim();
        }
        rows.push(obj);
    }
    return rows;
}

function pick(row: any, keys: string[]) {
    for (const k of keys) {
        if (row?.[k] !== undefined && row?.[k] !== null && String(row[k]).trim() !== "") return row[k];
    }
    return "";
}

function mapRowToLead(row: any, campaignId: string, campaignCode?: string) {
    const source_id = String(pick(row, ["ID", "id", "Id", "source_id"])).trim();
    if (!source_id) return null;

    const form_id = String(pick(row, ["ID FORMULARIO", "ID_FORMULARIO", "form_id"])).trim() || null;

    const fechaIso = parsePeDateTimeToIso(pick(row, ["FECHA", "fecha"]));

    const campaignText = String(pick(row, ["CAMPAÑA", "CAMPAÑA ", "campaign"])).trim() || (campaignCode ?? "");

    const lead = {
        source_id,
        form_id,
        fecha: fechaIso, // ✅ ISO
        campaign: campaignText,

        queue_start: String(pick(row, ["COLA DE INICIO", "COLA_DE_INICIO", "queue_start"])).trim() || null,
        queue_end: String(pick(row, ["COLA FINAL", "COLA_FINAL", "queue_end"])).trim() || null,

        estado_cliente: String(pick(row, ["ESTADO CLIENTE", "estado_cliente"])).trim() || null,
        estado_usuario: String(pick(row, ["ESTADO DE USUARIO", "estado_usuario"])).trim() || null,

        phone: toE164PE(pick(row, ["NUMERO DEL CLIENTE", "NUMERO_DEL_CLIENTE", "phone"])),

        usuario: String(pick(row, ["USUARIO", "usuario"])).trim() || null,
        extension: String(pick(row, ["EXTENSION DEL USUARIO", "EXTENSION", "extension"])).trim() || "0",

        duracion_sec: Number(pick(row, ["DURACIÓN", "DURACION", "duracion_sec"]) || 0) || 0,

        call_state_general: String(pick(row, ["Estados de llamada - ESTADO GENERAL", "call_state_general"])).trim() || null,
        call_state: String(pick(row, ["Estados de llamada - ESTADO", "call_state"])).trim() || null,

        sale_state_general: String(pick(row, ["Estados de venta - ESTADO GENERAL", "sale_state_general"])).trim() || null,
        sale_state: String(pick(row, ["Estados de venta - ESTADO", "sale_state"])).trim() || null,

        depto: String(pick(row, ["Datos Instalación - Departamento:", "depto"])).trim() || null,
        provincia: String(pick(row, ["Datos Instalación - Provincia:", "provincia"])).trim() || null,
        distrito: String(pick(row, ["Datos Instalación - Distrito:", "distrito"])).trim() || null,

        raw: row, // trazabilidad
        campaign_id: campaignId,
        updated_at: nowIso(),
    };

    return lead;
}

async function sbRest<T>(
    path: string,
    opts: {
        method?: "GET" | "POST" | "PATCH" | "DELETE";
        query?: Record<string, string | number | boolean | undefined | null>;
        body?: any;
        extraHeaders?: Record<string, string>;
    } = {}
): Promise<T> {
    const url = new URL(`${SB_URL}${path}`);
    if (opts.query) {
        for (const [k, v] of Object.entries(opts.query)) {
            if (v === undefined || v === null) continue;
            url.searchParams.set(k, String(v));
        }
    }

    const res = await fetch(url.toString(), {
        method: opts.method || "GET",
        headers: {
            apikey: SB_ANON,
            Authorization: `Bearer ${SB_ANON}`,
            Accept: "application/json",
            "Accept-Profile": SB_SCHEMA,
            "Content-Profile": SB_SCHEMA,
            ...(opts.body ? { "Content-Type": "application/json" } : {}),
            ...(opts.extraHeaders ?? {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Supabase error ${res.status} : ${text}`);
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return (null as any) as T;
    return (await res.json()) as T;
}

export default function ImportLeadsButton({ campaignId, campaignCode }: Props) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [mode, setMode] = useState<ImportMode>("merge");
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    async function readFile(file: File): Promise<any[]> {
        const name = file.name.toLowerCase();

        if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: "array" });
            const sheetName = wb.SheetNames[0];
            const ws = wb.Sheets[sheetName];
            // defval para no perder columnas vacías
            const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
            return rows as any[];
        }

        // CSV/TSV
        const text = await file.text();
        return parseDelimited(text);
    }

    async function doReplaceSafety(importedSourceIds: string[]) {
        // 1) leer leads actuales de la campaña
        const existing = await sbRest<{ id: string; source_id: string }[]>("/rest/v1/leads", {
            method: "GET",
            query: {
                select: "id,source_id",
                campaign_id: `eq.${campaignId}`,
                limit: 100000,
            },
        });

        const importedSet = new Set(importedSourceIds);
        const toRemove = (existing ?? []).filter((r) => !importedSet.has(String(r.source_id)));

        if (toRemove.length === 0) return;

        // 2) identificar cuáles tienen calls
        // (para demo funciona; en producción conviene RPC)
        const ids = toRemove.map((r) => r.id);
        const calls = await sbRest<{ lead_id: string }[]>("/rest/v1/calls", {
            method: "GET",
            query: {
                select: "lead_id",
                lead_id: `in.(${ids.join(",")})`,
                limit: 200000,
            },
        });

        const withCalls = new Set((calls ?? []).map((c) => c.lead_id));

        const deleteIds: string[] = [];
        const detachIds: string[] = [];

        for (const r of toRemove) {
            if (withCalls.has(r.id)) detachIds.push(r.id);
            else deleteIds.push(r.id);
        }

        // 3) detacha (no borra) los que tienen calls
        if (detachIds.length) {
            // PATCH en lotes
            const chunk = 200;
            for (let i = 0; i < detachIds.length; i += chunk) {
                const part = detachIds.slice(i, i + chunk);
                await sbRest("/rest/v1/leads", {
                    method: "PATCH",
                    query: { id: `in.(${part.join(",")})` },
                    body: { campaign_id: null, updated_at: nowIso() },
                });
            }
        }

        // 4) borra los que NO tienen calls
        if (deleteIds.length) {
            const chunk = 200;
            for (let i = 0; i < deleteIds.length; i += chunk) {
                const part = deleteIds.slice(i, i + chunk);
                await sbRest("/rest/v1/leads", {
                    method: "DELETE",
                    query: { id: `in.(${part.join(",")})` },
                });
            }
        }
    }

    async function upsertLeads(leads: any[]) {
        const BATCH = 500;
        for (let i = 0; i < leads.length; i += BATCH) {
            const batch = leads.slice(i, i + BATCH);

            await sbRest("/rest/v1/leads", {
                method: "POST",
                query: {
                    on_conflict: "campaign_id,source_id", // 🔑 recomendado
                },
                extraHeaders: {
                    Prefer: "resolution=merge-duplicates,return=minimal",
                },
                body: batch,
            });
        }
    }

    async function onPickFile(file: File) {
        setBusy(true);
        setMsg(null);

        try {
            const rows = await readFile(file);

            const mapped = rows
                .map((r) => mapRowToLead(r, campaignId, campaignCode))
                .filter(Boolean) as any[];

            if (mapped.length === 0) {
                setMsg("No se detectaron filas válidas (revisa que exista columna ID).");
                return;
            }

            // ✅ validar FECHA: si queda null no rompe; pero si queda en formato DD/MM entonces algo falló
            for (const m of mapped) {
                if (m.fecha && typeof m.fecha === "string" && m.fecha.includes("/")) {
                    throw new Error(`FECHA no fue convertida a ISO: "${m.fecha}"`);
                }
            }

            if (mode === "replace") {
                const importedSourceIds = mapped.map((x) => String(x.source_id));
                await doReplaceSafety(importedSourceIds);
            }

            await upsertLeads(mapped);

            setMsg(`✅ Importación OK. Filas procesadas: ${mapped.length} (${mode === "replace" ? "reemplazo" : "merge"}).`);
        } catch (e: any) {
            setMsg(`❌ ${e?.message ?? String(e)}`);
        } finally {
            setBusy(false);
            if (inputRef.current) inputRef.current.value = "";
        }
    }

    return (
        <div className="rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
                <div className="font-medium">Importar Leads (CSV / XLSX)</div>

                <div className="flex items-center gap-2">
                    <select
                        className="border rounded-md px-2 py-1 text-sm"
                        value={mode}
                        onChange={(e) => setMode(e.target.value as ImportMode)}
                        disabled={busy}
                    >
                        <option value="merge">Agregar / Actualizar</option>
                        <option value="replace">Reemplazar (sin romper calls)</option>
                    </select>

                    <button
                        className="border rounded-md px-3 py-1 text-sm hover:bg-muted disabled:opacity-50"
                        disabled={busy}
                        onClick={() => inputRef.current?.click()}
                    >
                        {busy ? "Importando..." : "Importar archivo"}
                    </button>
                </div>
            </div>

            <input
                ref={inputRef}
                type="file"
                accept=".csv,.tsv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPickFile(f);
                }}
            />

            {msg ? <div className="text-sm whitespace-pre-wrap">{msg}</div> : null}

            <div className="text-xs text-muted-foreground">
                - FECHA se convierte a ISO (Perú -05:00) para evitar error 22008.<br />
                - En “Reemplazar”: los leads que tienen calls NO se borran, se “desasocian” (campaign_id=null).<br />
                - Recomendado: UNIQUE(campaign_id, source_id) para el upsert.
            </div>
        </div>
    );
}
