"use client";

import {
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Tooltip as ReTooltip,
    Legend,
    LineChart,
    Line,
    CartesianGrid,
    XAxis,
    YAxis,
    Tooltip,
} from "recharts";

type DonutRow = { result_bucket: string; calls: number };
type SeriesRow = {
    bucket_ts: string;
    total_calls: number;
    connected_calls: number;
    no_answer_calls: number;
};

function prettyBucket(b: string) {
    const x = String(b ?? "").toLowerCase();
    switch (x) {
        case "connected": return "Conectada";
        case "queued": return "En cola";
        case "initiated": return "Iniciada";
        case "no_answer": return "No contesta";
        case "busy": return "Ocupado";
        case "failed": return "Fallida";
        case "canceled": return "Cancelada";
        case "orphaned": return "Orphaned";
        case "other": return "Otros";
        default: return b;
    }
}

function formatTick(ts: string) {
    const d = new Date(ts);
    const hh = d.getHours();
    const mm = String(d.getMinutes()).padStart(2, "0");

    // Heurística simple: si es medianoche, mostramos fecha; si no, hora.
    if (hh === 0 && mm === "00") {
        return d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit" });
    }
    return `${String(hh).padStart(2, "0")}:${mm}`;
}

const COLORS = [
    "#4f46e5", "#06b6d4", "#10b981", "#f59e0b",
    "#ef4444", "#a855f7", "#64748b", "#0ea5e9",
];

export function DonutResultChart({
    data,
    onSelectBucket,
}: {
    data: DonutRow[];
    onSelectBucket?: (bucket: string) => void;
}) {
    const chartData = (data ?? [])
        .filter((x) => Number(x.calls ?? 0) > 0)
        .map((x) => ({
            name: prettyBucket(x.result_bucket),
            value: Number(x.calls),
            bucket: String(x.result_bucket ?? "").toLowerCase(),
        }));

    const total = chartData.reduce((a, b) => a + b.value, 0);

    return (
        <div className="w-full h-[260px]">
            <ResponsiveContainer>
                <PieChart>
                    <Pie
                        data={chartData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="55%"
                        outerRadius="80%"
                        paddingAngle={2}
                        onClick={(entry: any) => {
                            const b = entry?.payload?.bucket;
                            if (b && onSelectBucket) onSelectBucket(b);
                        }}
                    >
                        {chartData.map((_, idx) => (
                            <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                        ))}
                    </Pie>

                    <ReTooltip
                        formatter={(value: any, name: any) => {
                            const v = Number(value);
                            const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0.0";
                            return [`${v} (${pct}%)`, name];
                        }}
                    />
                    <Legend />
                </PieChart>
            </ResponsiveContainer>

            {onSelectBucket && (
                <div className="mt-2 text-xs text-muted-foreground">
                    Tip: clic en un segmento para filtrar (clic nuevamente para limpiar).
                </div>
            )}
        </div>
    );
}

export function CallsTrendChart({
    data,
    onSelectPoint,
}: {
    data: SeriesRow[];
    onSelectPoint?: (bucketTs: string) => void;
}) {
    const chartData = (data ?? []).map((r) => ({
        ts: r.bucket_ts,
        label: formatTick(r.bucket_ts),
        total: Number(r.total_calls ?? 0),
        connected: Number(r.connected_calls ?? 0),
        no_answer: Number(r.no_answer_calls ?? 0),
    }));

    return (
        <div className="w-full h-[280px]">
            <ResponsiveContainer>
                <LineChart
                    data={chartData}
                    margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                    onClick={(state: any) => {
                        const ts = state?.activePayload?.[0]?.payload?.ts;
                        if (ts && onSelectPoint) onSelectPoint(ts);
                    }}
                >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                        labelFormatter={(_, payload) => {
                            const row = payload?.[0]?.payload;
                            if (!row?.ts) return "";
                            return new Date(row.ts).toLocaleString("es-PE");
                        }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="total" name="Total" strokeWidth={2} dot />
                    <Line type="monotone" dataKey="connected" name="Conectadas" strokeWidth={2} dot />
                    <Line type="monotone" dataKey="no_answer" name="No contesta" strokeWidth={2} dot />
                </LineChart>
            </ResponsiveContainer>

            {onSelectPoint && (
                <div className="mt-2 text-xs text-muted-foreground">
                    Tip: clic en un punto para filtrar por ese día/hora.
                </div>
            )}
        </div>
    );
}
