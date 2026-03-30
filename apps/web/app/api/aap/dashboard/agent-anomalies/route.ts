// app/api/aap/dashboard/agent-anomalies/route.ts
import { NextResponse } from "next/server";

/**
 * NOTA:
 * - Evitamos export const dynamic / runtime para no chocar con output: export.
 * - Este endpoint asume que tu PostgREST expone las RPC en schema "public".
 */

function getEnv(name: string, required = true): string {
    const v = process.env[name];
    if (required && (!v || !String(v).trim())) throw new Error(`Missing env var: ${name}`);
    return String(v || "").trim();
}

function jsonOk(data: any, init?: ResponseInit) {
    return NextResponse.json(data, { status: 200, ...init });
}

function jsonErr(message: string, status = 500, extra?: any) {
    return NextResponse.json({ error: message, ...(extra ? { extra } : {}) }, { status });
}

// PostgREST RPC (sin supabase-js)
async function postgrestRpc<T>(fn: string, payload: any): Promise<T> {
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL", true);

    const serviceKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
        process.env.SUPABASE_SERVICE_KEY?.trim() ||
        process.env.SUPABASE_ANON_KEY?.trim() ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

    if (!serviceKey) throw new Error("Missing env var: SUPABASE_SERVICE_ROLE_KEY (recommended)");

    const url = `${supabaseUrl}/rest/v1/rpc/${fn}`;

    const res = await fetch(url, {
        method: "POST",
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            "Content-Profile": "public",
            "Accept-Profile": "public",
        },
        body: JSON.stringify(payload ?? {}),
        cache: "no-store",
    });

    const text = await res.text();
    let json: any = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = text;
    }

    if (!res.ok) {
        const msg = (json && (json.message || json.error || json.details)) || `PostgREST RPC error calling ${fn}`;
        throw new Error(msg);
    }

    return json as T;
}

// ---------- Types ----------
type AgentKpisRow = {
    agent: string | null;
    total_calls: number;
    connected_calls: number;
    connect_rate_pct: number | string;
    avg_duration_sec: number | string | null;
    avg_time_to_start_sec: number | string | null;
};

type Payload = {
    p_from_pe: string;
    p_to_pe: string;
    p_campaign_id: string | null;
    p_min_calls?: number | null; // default 15
};

function num(x: any, d = 0) {
    const n = Number(x);
    return Number.isFinite(n) ? n : d;
}

function parsePeTs(peTs: string) {
    const s = String(peTs || "").trim().replace("T", " ");
    const [datePart, timePart] = s.split(" ");
    const [y, m, d] = datePart.split("-").map(Number);
    const [hh, mi, ss] = (timePart ?? "00:00:00").split(":").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mi ?? 0, ss ?? 0);
}

function formatPeTs(dt: Date) {
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const yyyy = dt.getFullYear();
    const mm = pad2(dt.getMonth() + 1);
    const dd = pad2(dt.getDate());
    const HH = pad2(dt.getHours());
    const MI = pad2(dt.getMinutes());
    const SS = pad2(dt.getSeconds());
    return `${yyyy}-${mm}-${dd} ${HH}:${MI}:${SS}`;
}

function prevRange(p_from_pe: string, p_to_pe: string) {
    const from = parsePeTs(p_from_pe);
    const to = parsePeTs(p_to_pe);
    const dur = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime());
    const prevFrom = new Date(from.getTime() - dur);
    return { prev_from_pe: formatPeTs(prevFrom), prev_to_pe: formatPeTs(prevTo) };
}

function mean(values: number[]) {
    if (!values.length) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values: number[]) {
    if (values.length < 2) return 0;
    const m = mean(values);
    const v = mean(values.map((x) => (x - m) ** 2));
    return Math.sqrt(v);
}

type Anomaly = {
    agent: string;
    severity: "low" | "medium" | "high";
    title: string;
    what_happened: string;
    recommended_actions: string[];
    metrics: {
        total_calls: number;
        connect_rate_pct: number;
        avg_time_to_start_sec: number;
        avg_duration_sec: number;
        prev_calls: number;
        prev_connect_rate_pct: number | null;
        delta_connect_rate_pp: number | null;
        z_rate: number | null;
    };
};

function sevRank(sev: "high" | "medium" | "low") {
    return sev === "high" ? 0 : sev === "medium" ? 1 : 2;
}

export async function POST(req: Request) {
    try {
        const body = (await req.json().catch(() => ({}))) as Payload;

        const p_from_pe = String(body?.p_from_pe || "").trim();
        const p_to_pe = String(body?.p_to_pe || "").trim();
        const p_campaign_id = body?.p_campaign_id ? String(body.p_campaign_id) : null;
        const p_min_calls = body?.p_min_calls != null ? Number(body.p_min_calls) : 15;

        if (!p_from_pe || !p_to_pe) return jsonErr("Missing p_from_pe / p_to_pe", 400);

        const { prev_from_pe, prev_to_pe } = prevRange(p_from_pe, p_to_pe);

        const commonCurr = {
            p_from_pe,
            p_to_pe,
            p_campaign_id,
            p_mode: "human",
            p_agent: null,
        };

        const commonPrev = {
            p_from_pe: prev_from_pe,
            p_to_pe: prev_to_pe,
            p_campaign_id,
            p_mode: "human",
            p_agent: null,
        };

        const [currRows, prevRows] = await Promise.all([
            postgrestRpc<AgentKpisRow[]>("rpc_calls_agent_kpis", commonCurr),
            postgrestRpc<AgentKpisRow[]>("rpc_calls_agent_kpis", commonPrev),
        ]);

        const normName = (a: string | null) => (a && String(a).trim() ? String(a).trim() : "(sin agente)");

        const prevMap = new Map<string, AgentKpisRow>();
        (prevRows ?? []).forEach((r) => prevMap.set(normName(r.agent), r));

        // Stats (connect rate) con min_calls
        const currRatesForStats: number[] = (currRows ?? [])
            .map((r) => ({ calls: num(r.total_calls), rate: num(r.connect_rate_pct) }))
            .filter((x) => x.calls >= p_min_calls)
            .map((x) => x.rate);

        const mRate = mean(currRatesForStats);
        const sdRate = stdev(currRatesForStats);

        const anomalies: Anomaly[] = [];

        const per_agent = (currRows ?? []).map((r) => {
            const agent = normName(r.agent);

            const total_calls = num(r.total_calls);
            const connected_calls = num(r.connected_calls);
            const connect_rate_pct = num(r.connect_rate_pct);
            const avg_time_to_start_sec = num(r.avg_time_to_start_sec);
            const avg_duration_sec = r.avg_duration_sec == null ? 0 : num(r.avg_duration_sec);

            const prev = prevMap.get(agent);
            const prev_calls = prev ? num(prev.total_calls) : 0;
            const prev_rate = prev ? num(prev.connect_rate_pct) : null;

            const delta_pp = prev_rate == null ? null : connect_rate_pct - prev_rate;

            const z = sdRate > 0 && total_calls >= p_min_calls ? (connect_rate_pct - mRate) / sdRate : null;

            // ---------- Heurísticas ----------
            if (total_calls >= p_min_calls && delta_pp != null && delta_pp <= -15) {
                anomalies.push({
                    agent,
                    severity: "high",
                    title: "Caída fuerte del rate vs período anterior",
                    what_happened: `La tasa de conexión bajó ${Math.abs(delta_pp).toFixed(1)} pp vs el período anterior.`,
                    recommended_actions: [
                        "Revisar 5–10 llamadas recientes (horario/segmento) y ajustar guion de apertura.",
                        "Mover llamadas a las 2 franjas horarias con mejor performance.",
                        "Validar calidad de leads (teléfonos válidos / lista no quemada).",
                    ],
                    metrics: {
                        total_calls,
                        connect_rate_pct,
                        avg_time_to_start_sec,
                        avg_duration_sec,
                        prev_calls,
                        prev_connect_rate_pct: prev_rate,
                        delta_connect_rate_pp: delta_pp,
                        z_rate: z,
                    },
                });
            } else if (total_calls >= p_min_calls && delta_pp != null && delta_pp <= -8) {
                anomalies.push({
                    agent,
                    severity: "medium",
                    title: "Caída moderada del rate vs período anterior",
                    what_happened: `La tasa de conexión bajó ${Math.abs(delta_pp).toFixed(1)} pp vs el período anterior.`,
                    recommended_actions: [
                        "Probar micro-guion fijo (2 líneas) durante 24h y comparar.",
                        "Filtrar por campaña/segmento para ver si el problema está concentrado.",
                    ],
                    metrics: {
                        total_calls,
                        connect_rate_pct,
                        avg_time_to_start_sec,
                        avg_duration_sec,
                        prev_calls,
                        prev_connect_rate_pct: prev_rate,
                        delta_connect_rate_pp: delta_pp,
                        z_rate: z,
                    },
                });
            }

            if (total_calls >= 10 && avg_time_to_start_sec >= 120) {
                anomalies.push({
                    agent,
                    severity: "high",
                    title: "Inicio muy lento (SLA en riesgo)",
                    what_happened: `Tiempo promedio para iniciar: ${avg_time_to_start_sec.toFixed(0)}s.`,
                    recommended_actions: [
                        "Reducir tiempos muertos: revisar flujo de toma de llamadas en cola.",
                        "Alertar cuando pasen >60s sin iniciar.",
                        "Verificar latencia / dispositivo / proceso del agente.",
                    ],
                    metrics: {
                        total_calls,
                        connect_rate_pct,
                        avg_time_to_start_sec,
                        avg_duration_sec,
                        prev_calls,
                        prev_connect_rate_pct: prev_rate,
                        delta_connect_rate_pp: delta_pp,
                        z_rate: z,
                    },
                });
            } else if (total_calls >= 10 && avg_time_to_start_sec >= 60) {
                anomalies.push({
                    agent,
                    severity: "medium",
                    title: "Inicio lento (SLA)",
                    what_happened: `Tiempo promedio para iniciar: ${avg_time_to_start_sec.toFixed(0)}s (objetivo <= 60s).`,
                    recommended_actions: [
                        "Revisar disciplina operativa: tomar llamadas rápido al entrar en cola.",
                        "Chequear fricción en el flujo (pantallas / clicks / carga).",
                    ],
                    metrics: {
                        total_calls,
                        connect_rate_pct,
                        avg_time_to_start_sec,
                        avg_duration_sec,
                        prev_calls,
                        prev_connect_rate_pct: prev_rate,
                        delta_connect_rate_pp: delta_pp,
                        z_rate: z,
                    },
                });
            }

            if (total_calls >= p_min_calls && avg_duration_sec > 0 && avg_duration_sec <= 15) {
                anomalies.push({
                    agent,
                    severity: "medium",
                    title: "Duración promedio muy baja",
                    what_happened: `Las llamadas promedian ${avg_duration_sec.toFixed(0)}s (posibles cortes/rechazos tempranos).`,
                    recommended_actions: [
                        "Ajustar apertura: más directa y con permiso (30 segundos).",
                        "Verificar audio / calidad de llamada / latencia.",
                    ],
                    metrics: {
                        total_calls,
                        connect_rate_pct,
                        avg_time_to_start_sec,
                        avg_duration_sec,
                        prev_calls,
                        prev_connect_rate_pct: prev_rate,
                        delta_connect_rate_pp: delta_pp,
                        z_rate: z,
                    },
                });
            }

            if (agent === "(sin agente)" && total_calls >= 10) {
                anomalies.push({
                    agent,
                    severity: "low",
                    title: "(sin agente) — Llamadas sin agente asignado",
                    what_happened: `Hay ${total_calls} llamadas humanas sin agente. Esto limita la comparativa.`,
                    recommended_actions: [
                        "Asignar agente al iniciar la llamada (human_taken_by) o al cierre.",
                        "En demo: mantener ~5% sin agente para mostrar el caso.",
                        "Agregar validación si mode=human y human_taken_by es null.",
                    ],
                    metrics: {
                        total_calls,
                        connect_rate_pct,
                        avg_time_to_start_sec,
                        avg_duration_sec,
                        prev_calls,
                        prev_connect_rate_pct: prev_rate,
                        delta_connect_rate_pp: delta_pp,
                        z_rate: z,
                    },
                });
            }

            if (z != null && total_calls >= p_min_calls && z <= -1.5) {
                anomalies.push({
                    agent,
                    severity: z <= -2.0 ? "high" : "medium",
                    title: "Outlier negativo (vs equipo)",
                    what_happened: `Está significativamente por debajo del promedio del equipo (z=${z.toFixed(2)}).`,
                    recommended_actions: [
                        "Comparar mix campañas/horarios vs el resto.",
                        "Aplicar guion del top performer por 1 día y medir.",
                    ],
                    metrics: {
                        total_calls,
                        connect_rate_pct,
                        avg_time_to_start_sec,
                        avg_duration_sec,
                        prev_calls,
                        prev_connect_rate_pct: prev_rate,
                        delta_connect_rate_pp: delta_pp,
                        z_rate: z,
                    },
                });
            }

            return {
                agent,
                total_calls,
                connected_calls,
                connect_rate_pct,
                avg_time_to_start_sec,
                avg_duration_sec,
                prev_calls,
                prev_connect_rate_pct: prev_rate,
                delta_connect_rate_pp: delta_pp,
            };
        });

        // ✅ Dedup: 1 anomalía por agente (la más importante)
        const bestByAgent = new Map<string, Anomaly>();

        for (const a of anomalies) {
            const prevBest = bestByAgent.get(a.agent);
            if (!prevBest) {
                bestByAgent.set(a.agent, a);
                continue;
            }

            // Comparador: severidad -> abs(delta_pp) -> calls
            const d1 = Math.abs(a.metrics.delta_connect_rate_pp ?? 0);
            const d2 = Math.abs(prevBest.metrics.delta_connect_rate_pp ?? 0);

            const better =
                sevRank(a.severity) < sevRank(prevBest.severity) ||
                (sevRank(a.severity) === sevRank(prevBest.severity) && d1 > d2) ||
                (sevRank(a.severity) === sevRank(prevBest.severity) && d1 === d2 && a.metrics.total_calls > prevBest.metrics.total_calls);

            if (better) bestByAgent.set(a.agent, a);
        }

        const finalAnomalies = Array.from(bestByAgent.values()).sort((a, b) => {
            const ra = sevRank(a.severity);
            const rb = sevRank(b.severity);
            if (ra !== rb) return ra - rb;
            return (b.metrics.total_calls ?? 0) - (a.metrics.total_calls ?? 0);
        });

        return jsonOk({
            ok: true,
            input: { p_from_pe, p_to_pe, p_campaign_id, p_min_calls },
            prev_range: { prev_from_pe, prev_to_pe },
            stats: {
                mean_connect_rate: Number(mRate.toFixed(2)),
                stdev_connect_rate: Number(sdRate.toFixed(2)),
            },
            per_agent,
            anomalies: finalAnomalies,
        });
    } catch (e: any) {
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
