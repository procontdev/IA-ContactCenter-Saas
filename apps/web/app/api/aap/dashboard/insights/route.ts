import { NextResponse } from "next/server";

type DonutRow = { result_bucket: string; calls: number };
type TimeseriesRow = {
    bucket_ts: string; // timestamp string
    total_calls: number;
    connected_calls: number;
    no_answer_calls: number;
};
type Kpis = {
    total_calls: number;
    connected_calls: number;
    queued_calls: number;
    no_answer_calls?: number;
    busy_calls?: number;
    failed_calls?: number;
    canceled_calls?: number;
    connect_rate?: number;
};
type Snapshot = {
    filters: {
        from_pe: string; // ISO-ish
        to_pe: string;
        campaign_id?: string | null;
        mode?: "llm" | "human" | null;
        grain?: "hour" | "day";
    };
    kpis: Kpis;
    donut: DonutRow[];
    timeseries: TimeseriesRow[];
    top_campaigns?: Array<{ campaign_name: string; calls: number; connected_calls?: number }>;
    queue_stale?: { stale_queued: number; stale_minutes?: number };
};

type Anomaly = {
    id: string;
    severity: "low" | "medium" | "high";
    title: string;
    metric: string;
    current: number;
    baseline: number;
    delta_abs: number;
    delta_pct: number;
    hint: string;
};

function safeNum(x: any): number {
    const n = typeof x === "number" ? x : Number(x);
    return Number.isFinite(n) ? n : 0;
}

function pct(a: number, b: number): number {
    return b === 0 ? 0 : (a / b) * 100;
}

function detectAnomalies(s: Snapshot): Anomaly[] {
    const out: Anomaly[] = [];

    const total = safeNum(s.kpis.total_calls);
    const connected = safeNum(s.kpis.connected_calls);
    const queued = safeNum(s.kpis.queued_calls);

    const connectRate = total > 0 ? connected / total : 0;

    // Baseline: promedio simple del timeseries (si existe)
    // Métricas por bucket -> tasas
    const ts = (s.timeseries || []).map((r) => ({
        total: safeNum(r.total_calls),
        connected: safeNum(r.connected_calls),
        no_answer: safeNum(r.no_answer_calls),
    }));

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

    const rates = ts
        .filter((x) => x.total > 0)
        .map((x) => ({
            connect_rate: x.connected / x.total,
            no_answer_rate: x.no_answer / x.total,
            total: x.total,
        }));

    const baselineConnect = avg(rates.map((r) => r.connect_rate));
    const baselineNoAnswer = avg(rates.map((r) => r.no_answer_rate));
    const baselineTotal = avg(rates.map((r) => r.total));

    // Current (último bucket)
    const last = rates.length ? rates[rates.length - 1] : null;
    const currentConnect = last?.connect_rate ?? connectRate;
    const currentNoAnswer = last?.no_answer_rate ?? 0;
    const currentTotal = last?.total ?? total;

    // Helpers para crear anomalías
    const push = (a: Omit<Anomaly, "id">) => {
        out.push({ id: crypto.randomUUID(), ...a });
    };

    // 1) Caída de connect rate (alta si cae > 15pp vs baseline)
    {
        const delta = currentConnect - baselineConnect;
        const deltaPP = delta * 100;
        if (rates.length >= 6 && deltaPP <= -15) {
            push({
                severity: "high",
                title: "Caída fuerte en tasa de conexión",
                metric: "connect_rate",
                current: currentConnect,
                baseline: baselineConnect,
                delta_abs: delta,
                delta_pct: baselineConnect ? delta / baselineConnect : 0,
                hint: "Posible franja horaria mala, base fría, carrier, o guion/IVR. Revisar por campaña y modo.",
            });
        } else if (rates.length >= 6 && deltaPP <= -8) {
            push({
                severity: "medium",
                title: "Caída en tasa de conexión",
                metric: "connect_rate",
                current: currentConnect,
                baseline: baselineConnect,
                delta_abs: delta,
                delta_pct: baselineConnect ? delta / baselineConnect : 0,
                hint: "Revisar horarios y segmentación. Comparar LLM vs humano.",
            });
        }
    }

    // 2) Subida de no-answer rate
    {
        const delta = currentNoAnswer - baselineNoAnswer;
        const deltaPP = delta * 100;
        if (rates.length >= 6 && deltaPP >= 12) {
            push({
                severity: "high",
                title: "Pico de 'No Answer'",
                metric: "no_answer_rate",
                current: currentNoAnswer,
                baseline: baselineNoAnswer,
                delta_abs: delta,
                delta_pct: baselineNoAnswer ? delta / baselineNoAnswer : 0,
                hint: "Puede indicar horarios inadecuados o números inválidos. Probar ventanas y reintentos inteligentes.",
            });
        } else if (rates.length >= 6 && deltaPP >= 6) {
            push({
                severity: "medium",
                title: "Incremento de 'No Answer'",
                metric: "no_answer_rate",
                current: currentNoAnswer,
                baseline: baselineNoAnswer,
                delta_abs: delta,
                delta_pct: baselineNoAnswer ? delta / baselineNoAnswer : 0,
                hint: "Revisar franja horaria y calidad de leads.",
            });
        }
    }

    // 3) Spike de volumen total (útil para demo)
    {
        const delta = currentTotal - baselineTotal;
        const deltaPct = baselineTotal ? delta / baselineTotal : 0;
        if (rates.length >= 6 && deltaPct >= 0.7) {
            push({
                severity: "medium",
                title: "Aumento inusual de volumen de llamadas",
                metric: "total_calls",
                current: currentTotal,
                baseline: baselineTotal,
                delta_abs: delta,
                delta_pct: deltaPct,
                hint: "Revisar si hubo carga masiva o cambio de estrategia (marcación automática / batches).",
            });
        }
    }

    // 4) Cola stale (si existe)
    if (s.queue_stale?.stale_queued != null) {
        const stale = safeNum(s.queue_stale.stale_queued);
        if (stale >= 20) {
            push({
                severity: "high",
                title: "Cola con llamadas 'stale' alta",
                metric: "stale_queued",
                current: stale,
                baseline: 0,
                delta_abs: stale,
                delta_pct: 0,
                hint: "Revisar sync Twilio-status, reintentos, y si hay calls sin cierre. Priorizar limpieza automática.",
            });
        } else if (stale >= 8) {
            push({
                severity: "medium",
                title: "Cola 'stale' requiere atención",
                metric: "stale_queued",
                current: stale,
                baseline: 0,
                delta_abs: stale,
                delta_pct: 0,
                hint: "Programar reconciliación cada 2–5 min y alertas.",
            });
        }
    }

    // 5) Donut: proporción de failed/busy/canceled (si está disponible)
    const donut = s.donut || [];
    const map = Object.fromEntries(donut.map((r) => [String(r.result_bucket), safeNum(r.calls)]));
    const bad = (map.failed || 0) + (map.busy || 0) + (map.canceled || 0) + (map.orphaned || 0);
    if (total > 0) {
        const badRate = bad / total;
        if (badRate >= 0.25) {
            push({
                severity: "medium",
                title: "Alta proporción de fallas/ocupado/canceladas",
                metric: "bad_outcomes_rate",
                current: badRate,
                baseline: 0,
                delta_abs: badRate,
                delta_pct: 0,
                hint: "Revisar carrier, número origen, configuración de Twilio, y calidad de base.",
            });
        }
    }

    // Orden: high -> medium -> low
    const order = { high: 0, medium: 1, low: 2 } as const;
    out.sort((a, b) => order[a.severity] - order[b.severity]);

    return out.slice(0, 8); // máximo 8 para demo
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const snapshot: Snapshot = body?.snapshot;

        if (!snapshot?.filters?.from_pe || !snapshot?.filters?.to_pe) {
            return NextResponse.json({ error: "Missing filters" }, { status: 400 });
        }

        const anomalies = detectAnomalies(snapshot);

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "Missing OPENAI_API_KEY on server env" },
                { status: 500 }
            );
        }

        // Prompt compacto para ejecutivo + acciones
        const sys = [
            "Eres un analista senior de performance de call center outbound (humano + IA).",
            "Devuelve SIEMPRE un JSON que cumpla el schema.",
            "Escribe en español (Perú), estilo ejecutivo, claro, accionable, sin relleno.",
            "No inventes datos: usa solo el snapshot y anomalías detectadas."
        ].join(" ");

        const input = [
            { role: "system", content: sys },
            {
                role: "user",
                content: JSON.stringify({
                    snapshot: {
                        filters: snapshot.filters,
                        kpis: snapshot.kpis,
                        donut: snapshot.donut,
                        timeseries_tail: snapshot.timeseries?.slice(-24), // evita payload gigante
                        top_campaigns: snapshot.top_campaigns?.slice(0, 5),
                        queue_stale: snapshot.queue_stale ?? null,
                    },
                    anomalies,
                }),
            },
        ];

        // Structured Outputs (JSON Schema) en Responses API
        const schema = {
            name: "dashboard_insights",
            strict: true,
            schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    executive_summary: { type: "string" },
                    key_metrics: {
                        type: "array",
                        items: {
                            type: "object",
                            additionalProperties: false,
                            properties: {
                                label: { type: "string" },
                                value: { type: "string" },
                                note: { type: "string" },
                            },
                            required: ["label", "value", "note"],
                        },
                    },
                    anomalies: {
                        type: "array",
                        items: {
                            type: "object",
                            additionalProperties: false,
                            properties: {
                                severity: { type: "string", enum: ["low", "medium", "high"] },
                                title: { type: "string" },
                                what_happened: { type: "string" },
                                likely_causes: { type: "array", items: { type: "string" } },
                                recommended_actions: { type: "array", items: { type: "string" } },
                            },
                            required: ["severity", "title", "what_happened", "likely_causes", "recommended_actions"],
                        },
                    },
                    next_actions_48h: { type: "array", items: { type: "string" } },
                    talking_points_for_demo: { type: "array", items: { type: "string" } },
                },
                required: [
                    "executive_summary",
                    "key_metrics",
                    "anomalies",
                    "next_actions_48h",
                    "talking_points_for_demo",
                ],
            },
        };

        const r = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`, // Bearer auth :contentReference[oaicite:0]{index=0}
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gpt-4o-mini", // soporta Structured Outputs (gpt-4o+). :contentReference[oaicite:1]{index=1}
                input,
                text: {
                    format: { type: "json_schema", ...schema }, // Structured Outputs :contentReference[oaicite:2]{index=2}
                },
                temperature: 0.2,
            }),
        });

        if (!r.ok) {
            const errText = await r.text();
            return NextResponse.json(
                { error: "OpenAI request failed", details: errText, anomalies },
                { status: 500 }
            );
        }

        const data = await r.json();

        // En Responses API, el contenido estructurado suele venir en output_parsed (SDK),
        // pero aquí usamos fetch, así que extraemos del output text.
        // Si tu respuesta viene en data.output[0].content[0].text (varía),
        // hacemos una extracción robusta.
        let parsed: any = null;

        // Intento 1: buscar algún string JSON en el output
        const maybeText =
            data?.output?.[0]?.content?.find((c: any) => c?.type === "output_text")?.text ??
            data?.output_text ??
            null;

        if (typeof maybeText === "string") {
            parsed = JSON.parse(maybeText);
        } else if (data?.output_parsed) {
            parsed = data.output_parsed;
        }

        if (!parsed) {
            return NextResponse.json(
                { error: "Could not parse structured output", raw: data, anomalies },
                { status: 500 }
            );
        }

        return NextResponse.json({ insights: parsed, anomalies });
    } catch (e: any) {
        return NextResponse.json(
            { error: "Server error", details: String(e?.message ?? e) },
            { status: 500 }
        );
    }
}
