// app/api/aap/dashboard/agent-coach/route.ts
import { NextResponse } from "next/server";
import { resolveTenantFromRequest } from "../../../../../lib/tenant/tenant-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * =========================
 *  Constantes ajustables
 * =========================
 */
const SLA_TARGET_SECONDS = 60; // <= 60s
const SLA_TARGET_PCT = 85; // 85%
const SLA_BUCKET_WITHIN_TARGET = "0-1 min"; // según tu RPC
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const POSTGREST_PROFILE = "contact_center"; // ✅ Schema actualizado

/**
 * =========================
 *  Helpers
 * =========================
 */
function jsonOk(data: any, init?: ResponseInit) {
    return NextResponse.json(data, { status: 200, ...init });
}

function jsonErr(message: string, status = 500, extra?: any) {
    return NextResponse.json({ error: message, ...(extra ? { extra } : {}) }, { status });
}

function pickEnv(...names: string[]) {
    for (const n of names) {
        const v = process.env[n];
        if (v && String(v).trim()) return String(v).trim();
    }
    return "";
}

function getSupabaseUrl() {
    const url = pickEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
    if (!url) throw new Error("Missing env var: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
    return url;
}

function getServiceKey() {
    const key =
        pickEnv(
            "SUPABASE_SERVICE_ROLE_KEY",
            "SUPABASE_SERVICE_KEY",
            "SUPABASE_ANON_KEY",
            "NEXT_PUBLIC_SUPABASE_ANON_KEY"
        ) || "";
    if (!key) throw new Error("Missing env var: SUPABASE_SERVICE_ROLE_KEY (recommended) or ANON key");
    return key;
}

async function safeReadJson(res: Response) {
    const text = await res.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

function num(x: any, d = 0) {
    const n = Number(x);
    return Number.isFinite(n) ? n : d;
}

function pct(part: number, total: number) {
    if (total <= 0) return 0;
    return (part * 100) / total;
}

/**
 * =========================
 *  PostgREST RPC (sin supabase-js)
 * =========================
 * ✅ Forzamos el schema/profile con Content-Profile/Accept-Profile
 */
async function postgrestRpc<T>(fn: string, payload: any, profile = POSTGREST_PROFILE): Promise<T> {
    const supabaseUrl = getSupabaseUrl();
    const serviceKey = getServiceKey();

    const url = `${supabaseUrl}/rest/v1/rpc/${fn}`;

    const res = await fetch(url, {
        method: "POST",
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            // ✅ fuerza schema donde PostgREST busca la función
            "Content-Profile": profile,
            "Accept-Profile": profile,
        },
        body: JSON.stringify(payload ?? {}),
        cache: "no-store",
    });

    const json = await safeReadJson(res);

    if (!res.ok) {
        const msg =
            (json as any)?.message ||
            (json as any)?.error ||
            (json as any)?.details ||
            `PostgREST RPC error calling ${fn}`;
        throw new Error(msg);
    }

    return json as T;
}

/**
 * =========================
 *  OpenAI via fetch (sin SDK) - NO TUMBA EL ENDPOINT
 * =========================
 */
async function callOpenAIJson(system: string, user: string): Promise<any | null> {
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) return null;

    const model = (process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim();

    try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model,
                temperature: 0.2,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
            }),
        });

        const json = await safeReadJson(res);

        if (!res.ok) {
            // ❗ No lanzamos error: devolvemos null para fallback
            console.error("OpenAI error:", json);
            return null;
        }

        const content = (json as any)?.choices?.[0]?.message?.content ?? "{}";
        try {
            return JSON.parse(content);
        } catch {
            return null;
        }
    } catch (e) {
        console.error("OpenAI fetch failed:", e);
        return null;
    }
}

/**
 * =========================
 *  Tipos esperados RPC
 * =========================
 */
type AgentKpisRow = {
    agent: string;
    total_calls: number;
    connected_calls: number;
    connect_rate_pct: number;
    avg_duration_sec: number;
    avg_time_to_start_sec: number;
};

type SlaBucketRow = {
    bucket: string;
    calls: number;
};

/**
 * =========================
 *  POST: genera AI Coach (por agente)
 * =========================
 */
export async function POST(req: Request) {
    try {
        const body = (await req.json().catch(() => ({}))) as any;
        const tenant = await resolveTenantFromRequest(req);
        const hasBearer = Boolean(req.headers.get("authorization") || req.headers.get("Authorization"));

        const p_from_pe = String(body?.p_from_pe || "").trim();
        const p_to_pe = String(body?.p_to_pe || "").trim();
        const requestedTenant = body?.p_tenant_id ? String(body.p_tenant_id) : null;
        const p_tenant_id = tenant.tenantId;
        const p_campaign_id = body?.p_campaign_id ? String(body.p_campaign_id) : null;
        const p_agent = body?.p_agent ? String(body.p_agent) : null;

        if (!p_from_pe || !p_to_pe || !p_tenant_id) {
            return jsonErr("Missing p_from_pe / p_to_pe", 400);
        }

        if (hasBearer && requestedTenant && requestedTenant !== p_tenant_id && !tenant.isSuperAdmin) {
            return jsonErr("Forbidden tenant scope", 403);
        }

        const agentKpisPayload = {
            p_tenant_id, // ✅ Pasado a la RPC
            p_from_pe,
            p_to_pe,
            p_campaign_id,
            p_mode: "human",
            p_agent,
        };

        const slaPayload = {
            p_tenant_id,
            p_from_pe,
            p_to_pe,
            p_campaign_id,
            p_agent,
        };

        // ✅ RPCs en public (forzado)
        const [agentKpisRows, slaRows] = await Promise.all([
            postgrestRpc<AgentKpisRow[]>("rpc_calls_agent_kpis", agentKpisPayload, POSTGREST_PROFILE),
            postgrestRpc<SlaBucketRow[]>("rpc_calls_sla_buckets", slaPayload, POSTGREST_PROFILE),
        ]);

        const chosen =
            (agentKpisRows || [])[0] ||
            ({
                agent: p_agent || "(sin agente)",
                total_calls: 0,
                connected_calls: 0,
                connect_rate_pct: 0,
                avg_duration_sec: 0,
                avg_time_to_start_sec: 0,
            } as AgentKpisRow);

        const slaTotal = (slaRows || []).reduce((a, b) => a + num(b.calls), 0);
        const withinTargetCalls = (slaRows || [])
            .filter((r) => String(r.bucket) === SLA_BUCKET_WITHIN_TARGET)
            .reduce((a, b) => a + num(b.calls), 0);

        const withinTargetPct = pct(withinTargetCalls, slaTotal);
        const slaMeetsTarget = withinTargetPct >= SLA_TARGET_PCT;

        const connectRate = num(chosen.connect_rate_pct);
        const avgStartSec = num(chosen.avg_time_to_start_sec);
        const avgDurSec = num(chosen.avg_duration_sec);

        const flags: string[] = [];
        if (connectRate < 50 && chosen.total_calls >= 30) flags.push("connect_rate_low");
        if (avgStartSec > SLA_TARGET_SECONDS && chosen.total_calls >= 10) flags.push("slow_start_time");
        if (!slaMeetsTarget && slaTotal >= 10) flags.push("sla_breach");

        const system = `
Eres un "AI Coach" operativo para un call center outbound.
Devuelves SIEMPRE JSON válido (response_format json_object).
Sin texto extra fuera del JSON.

Tu tarea:
- Explicar qué está pasando con el desempeño del agente.
- Proponer hipótesis.
- Proponer 3 acciones concretas.
- Proponer 1-2 líneas de script sugerido para mejorar resultados (amable y directo, español Perú).

Reglas:
- Sé específico y accionable.
- No inventes datos fuera del snapshot.
- Si faltan datos, dilo y sugiere cómo capturarlos.
`.trim();

        const user = `
SNAPSHOT (modo humano):
Agente: ${chosen.agent}
Rango: ${p_from_pe} -> ${p_to_pe} (PE)
Campaña: ${p_campaign_id || "todas"}

KPIs:
- total_calls: ${chosen.total_calls}
- connected_calls: ${chosen.connected_calls}
- connect_rate_pct: ${connectRate}
- avg_duration_sec: ${avgDurSec}
- avg_time_to_start_sec: ${avgStartSec}

SLA (inicio humano):
- meta: ${SLA_TARGET_PCT}% dentro de ${SLA_TARGET_SECONDS}s
- within_target_bucket: "${SLA_BUCKET_WITHIN_TARGET}"
- total_rows: ${slaTotal}
- within_target_calls: ${withinTargetCalls}
- within_target_pct: ${withinTargetPct.toFixed(2)}

Buckets:
${(slaRows || []).map((r) => `- ${r.bucket}: ${r.calls}`).join("\n")}

Flags heurísticos: ${flags.join(", ") || "(none)"}

DEVUELVE este JSON:
{
  "coach_title": "string",
  "what_is_happening": "string",
  "hypotheses": ["string", "..."],
  "actions_48h": ["string", "string", "string"],
  "script_sugerido": ["string", "string"],
  "sla_comment": "string"
}
`.trim();

        // OpenAI (no fatal)
        let coach = await callOpenAIJson(system, user);

        // Fallback
        if (!coach || typeof coach !== "object") {
            const slaLine = slaMeetsTarget
                ? `✅ SLA OK: ${withinTargetPct.toFixed(1)}% dentro de ${SLA_TARGET_SECONDS}s (meta ${SLA_TARGET_PCT}%).`
                : `⚠️ SLA bajo: ${withinTargetPct.toFixed(1)}% dentro de ${SLA_TARGET_SECONDS}s (meta ${SLA_TARGET_PCT}%).`;

            coach = {
                coach_title: `AI Coach · ${chosen.agent}`,
                what_is_happening: `En el rango seleccionado, el agente tiene ${chosen.total_calls} llamadas, con ${chosen.connected_calls} conectadas (rate ${connectRate.toFixed(
                    1
                )}%). Tiempo prom. hasta iniciar: ${avgStartSec.toFixed(1)}s. ${slaLine}`,
                hypotheses: [
                    "Demora en tomar/arrancar llamadas (SLA de inicio) está afectando resultados.",
                    "Falta estandarización del primer mensaje/guion para convertir intentos en conexión.",
                    "La franja horaria o el tipo de lead podría no estar alineado con disponibilidad real.",
                ],
                actions_48h: [
                    "Reducir el tiempo a inicio: prioriza tomar llamadas en cola y dispara recordatorios si pasan > 60s.",
                    "Usar un micro-guion fijo (2 líneas) y medir si sube el connect rate en 24h.",
                    "Concentrar llamadas en 2 franjas horarias con mejor desempeño (según tendencia).",
                ],
                script_sugerido: [
                    "Hola 👋 Soy Ramiro. Te llamo rápido para confirmar si aún te interesa la info, ¿tienes 30 segundos?",
                    "Si estás ocupado(a), dime un horario y te llamo exacto a esa hora ✅",
                ],
                sla_comment: slaLine,
            };
        }

        return jsonOk({
            ok: true,
            meta: {
                sla_target_seconds: SLA_TARGET_SECONDS,
                sla_target_pct: SLA_TARGET_PCT,
                sla_bucket_within_target: SLA_BUCKET_WITHIN_TARGET,
                postgrest_profile: POSTGREST_PROFILE,
            },
            input: { p_from_pe, p_to_pe, p_campaign_id, p_agent },
            computed: {
                chosen_agent: chosen.agent,
                connect_rate_pct: connectRate,
                avg_time_to_start_sec: avgStartSec,
                avg_duration_sec: avgDurSec,
                sla_total: slaTotal,
                sla_within_target_calls: withinTargetCalls,
                sla_within_target_pct: Number(withinTargetPct.toFixed(2)),
                sla_meets_target: slaMeetsTarget,
                flags,
            },
            coach,
        });
    } catch (e: any) {
        console.error("agent-coach route failed:", e);
        return jsonErr(e?.message ?? String(e), 500);
    }
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
        },
    });
}
