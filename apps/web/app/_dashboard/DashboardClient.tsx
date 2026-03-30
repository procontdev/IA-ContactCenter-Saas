"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";
import { apiGet } from "@/lib/api";
import type { KpisResponse } from "@/lib/types";

import { Topbar } from "@/components/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

const fetcher = () => apiGet<KpisResponse>("/api/dashboard/kpis");

// Mantén tus colores (no los tocamos)
const chartFillPrimary = "var(--chart-primary)";
const chartFillSecondary = "var(--chart-secondary)";
const chartAxis = "var(--muted-foreground)";

function pad2(n: number) {
    return String(n).padStart(2, "0");
}

function ymdLocal(d: Date) {
    // YYYY-MM-DD en hora local (evita desfase por UTC)
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function daysAgo(n: number) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}

function fmtTimeLocal(d: Date) {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function ClickableStatCard(props: {
    title: string;
    value: ReactNode;
    hint?: string;
    onClick: () => void;
    tv?: boolean;
}) {
    return (
        <Card
            onClick={props.onClick}
            className="cursor-pointer transition hover:bg-muted/30 active:scale-[0.99]"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") props.onClick();
            }}
        >
            <CardHeader className="pb-2">
                <CardTitle className={props.tv ? "text-base text-muted-foreground" : "text-sm text-muted-foreground"}>
                    {props.title}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
                <div className={props.tv ? "text-4xl font-semibold" : "text-3xl font-semibold"}>{props.value}</div>
                {!props.tv && props.hint && <div className="text-xs text-muted-foreground">{props.hint}</div>}
            </CardContent>
        </Card>
    );
}

function ActionCard(props: {
    title: string;
    description: string;
    badgeText?: string;
    badgeClassName?: string;
    onClick: () => void;
    tv?: boolean;
}) {
    return (
        <Card
            onClick={props.onClick}
            className="cursor-pointer transition hover:bg-muted/30 active:scale-[0.99]"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") props.onClick();
            }}
        >
            <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3">
                <CardTitle className={props.tv ? "text-base" : "text-sm"}>{props.title}</CardTitle>
                {props.badgeText && (
                    <Badge variant="outline" className={props.badgeClassName}>
                        {props.badgeText}
                    </Badge>
                )}
            </CardHeader>
            <CardContent className="space-y-1">
                <div className={props.tv ? "text-lg font-medium" : "text-base font-medium"}>{props.description}</div>
                {!props.tv && <div className="text-xs text-muted-foreground">Click para abrir</div>}
            </CardContent>
        </Card>
    );
}

export default function DashboardClient() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // ✅ Modo TV (querystring)
    const tv = useMemo(() => {
        const v = (searchParams.get("tv") || "").toLowerCase();
        return v === "1" || v === "true" || v === "on";
    }, [searchParams]);

    const toggleTv = () => {
        const sp = new URLSearchParams(searchParams.toString());
        if (tv) sp.delete("tv");
        else sp.set("tv", "1");
        const qs = sp.toString();
        router.push(qs ? `/dashboard?${qs}` : `/dashboard`);
    };

    // ✅ Toggle de auto-refresh
    const [autoRefresh, setAutoRefresh] = useState(true);

    // ✅ Última actualización real (hora local)
    const [lastUpdatedLocal, setLastUpdatedLocal] = useState<string | null>(null);

    const { data, error, isLoading, mutate } = useSWR("kpis", fetcher, {
        refreshInterval: autoRefresh ? 60_000 : 0,
        revalidateOnFocus: false,
    });

    // cuando hay data cacheada y falla la siguiente, SWR puede tener data + error
    const updatedAt = data?.meta?.generatedAt;

    // cada vez que llega data nueva, actualiza la hora local
    useEffect(() => {
        if (data) setLastUpdatedLocal(fmtTimeLocal(new Date()));
    }, [data]);

    if (isLoading && !data) {
        return (
            <div>
                <Topbar title="Dashboard" onRefresh={() => mutate()} />
                <div className="p-6">Cargando…</div>
            </div>
        );
    }

    if (!data && error) {
        return (
            <div>
                <Topbar title="Dashboard" onRefresh={() => mutate()} />
                <div className="p-6">Error cargando KPIs</div>
            </div>
        );
    }

    const k = data!.data;

    const today = ymdLocal(new Date());
    const from7 = ymdLocal(daysAgo(7));
    const from30 = ymdLocal(daysAgo(30));

    const apiOk = !error;

    return (
        <div>
            <Topbar title="Dashboard" updatedAt={updatedAt} onRefresh={() => mutate()} />

            {/* ✅ Barra de controles */}
            <div className={tv ? "px-6 pt-4" : "px-6 pt-4"}>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
                    <div className="text-sm text-muted-foreground">
                        Última actualización (local):{" "}
                        <span className="font-medium text-foreground">{lastUpdatedLocal ?? "—"}</span>
                    </div>

                    {/* ✅ Estado API */}
                    <Badge
                        variant="outline"
                        className={
                            apiOk
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300"
                        }
                        title={apiOk ? "Conexión OK" : "Error consultando KPIs (revisa n8n/webhook)"}
                    >
                        {apiOk ? "API OK" : "API ERROR"}
                    </Badge>

                    <div className="ml-auto flex items-center gap-2">
                        {/* ✅ Modo TV */}
                        <Button variant="outline" size="sm" onClick={toggleTv} title="Activa modo TV (más grande, menos texto)">
                            TV:
                            <Badge
                                variant="outline"
                                className={
                                    tv
                                        ? "ml-2 border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/40 dark:bg-violet-950/40 dark:text-violet-300"
                                        : "ml-2 border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300"
                                }
                            >
                                {tv ? "ON" : "OFF"}
                            </Badge>
                        </Button>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAutoRefresh((v) => !v)}
                            title="Activa o desactiva el refresh automático (cada 60s)"
                        >
                            Auto:
                            <Badge
                                variant="outline"
                                className={
                                    autoRefresh
                                        ? "ml-2 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
                                        : "ml-2 border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300"
                                }
                            >
                                {autoRefresh ? "ON" : "OFF"}
                            </Badge>
                        </Button>

                        <Button variant="outline" size="sm" onClick={() => mutate()} title="Refrescar ahora">
                            Refrescar
                        </Button>
                    </div>
                </div>
            </div>

            <div className={`${tv ? "p-8" : "p-6"} space-y-6`}>
                {/* Cards clickeables (se mantienen) */}
                <div className="grid gap-4 md:grid-cols-4">
                    <ClickableStatCard tv={tv} title="Leads (Total)" value={k.leads.total} hint="Ver todos" onClick={() => router.push("/leads")} />
                    <ClickableStatCard
                        tv={tv}
                        title="Leads (Últimos 7 días)"
                        value={k.leads.last7d}
                        hint={`Desde ${from7}`}
                        onClick={() => router.push(`/leads?from=${encodeURIComponent(from7)}&to=${encodeURIComponent(today)}`)}
                    />
                    <ClickableStatCard
                        tv={tv}
                        title="Leads (Últimos 30 días)"
                        value={k.leads.last30d}
                        hint={`Desde ${from30}`}
                        onClick={() => router.push(`/leads?from=${encodeURIComponent(from30)}&to=${encodeURIComponent(today)}`)}
                    />
                    <ClickableStatCard tv={tv} title="Membresías (Total)" value={k.membresias.total} hint="Ver todas" onClick={() => router.push("/membresias")} />

                    <ClickableStatCard
                        tv={tv}
                        title="Membresías (Registradas)"
                        value={k.membresias.registrado}
                        hint="Filtrar por estado"
                        onClick={() => router.push(`/membresias?estado=${encodeURIComponent("Registrada")}`)}
                    />
                    <ClickableStatCard
                        tv={tv}
                        title="Membresías (Confirmadas)"
                        value={k.membresias.confirmado}
                        hint="Filtrar por estado"
                        onClick={() => router.push(`/membresias?estado=${encodeURIComponent("Confirmada")}`)}
                    />
                    <ClickableStatCard
                        tv={tv}
                        title="Pendientes de pago"
                        value={k.membresias.pagadoNo}
                        hint="Pagado = No"
                        onClick={() => router.push(`/membresias?pagado=${encodeURIComponent("No")}`)}
                    />
                    <ClickableStatCard
                        tv={tv}
                        title="Pagadas"
                        value={k.membresias.pagadoSi}
                        hint="Pagado = Si"
                        onClick={() => router.push(`/membresias?pagado=${encodeURIComponent("Si")}`)}
                    />
                </div>

                {/* ✅ Necesita atención */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <h2 className={tv ? "text-xl font-semibold" : "text-base font-semibold"}>Necesita atención</h2>
                        {!tv && <span className="text-xs text-muted-foreground">Accesos rápidos para operación</span>}
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                        <ActionCard
                            tv={tv}
                            title="Leads sin celular"
                            description="Completar número para contacto"
                            badgeText="Leads"
                            badgeClassName="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300"
                            onClick={() => router.push("/leads?celular=without")}
                        />
                        <ActionCard
                            tv={tv}
                            title="Registradas (confirmar)"
                            description="Confirmar pre-reservas"
                            badgeText="Membresías"
                            badgeClassName="border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-300"
                            onClick={() => router.push(`/membresias?estado=${encodeURIComponent("Registrada")}`)}
                        />
                        <ActionCard
                            tv={tv}
                            title="Confirmadas sin pago"
                            description="Hacer seguimiento de pago"
                            badgeText="Pagos"
                            badgeClassName="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300"
                            onClick={() =>
                                router.push(
                                    `/membresias?estado=${encodeURIComponent("Confirmada")}&pagado=${encodeURIComponent("No")}`
                                )
                            }
                        />
                    </div>
                </div>

                {/* Charts con drill-down */}
                <div className="grid gap-4 md:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Leads por canal</CardTitle>
                        </CardHeader>
                        <CardContent className="h-72">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={k.leads.byCanal}>
                                    <XAxis dataKey="canal" stroke={chartAxis} />
                                    <YAxis allowDecimals={false} stroke={chartAxis} />
                                    <Tooltip />
                                    <Bar
                                        dataKey="count"
                                        fill={chartFillPrimary}
                                        radius={[6, 6, 0, 0]}
                                        onClick={(dataPoint: any) => {
                                            const canal = dataPoint?.canal;
                                            if (!canal) return;
                                            router.push(
                                                `/leads?canal=${encodeURIComponent(String(canal))}&from=${encodeURIComponent(from7)}&to=${encodeURIComponent(today)}`
                                            );
                                        }}
                                        style={{ cursor: "pointer" }}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                            {!tv && (
                                <div className="mt-2 text-xs text-muted-foreground">
                                    Tip: click en una barra para ver detalle (canal + últimos 7 días).
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Membresías por tipo</CardTitle>
                        </CardHeader>
                        <CardContent className="h-72">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={k.membresias.porTipo}>
                                    <XAxis dataKey="membresia" stroke={chartAxis} />
                                    <YAxis allowDecimals={false} stroke={chartAxis} />
                                    <Tooltip />
                                    <Bar
                                        dataKey="count"
                                        fill={chartFillSecondary}
                                        radius={[6, 6, 0, 0]}
                                        onClick={(dataPoint: any) => {
                                            const tipo = dataPoint?.membresia;
                                            if (!tipo) return;
                                            router.push(`/membresias?membresia=${encodeURIComponent(String(tipo))}`);
                                        }}
                                        style={{ cursor: "pointer" }}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                            {!tv && <div className="mt-2 text-xs text-muted-foreground">Tip: click en una barra para filtrar por tipo.</div>}
                        </CardContent>
                    </Card>
                </div>

                {/* Conversión */}
                <div className="grid gap-4 md:grid-cols-3">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className={tv ? "text-base text-muted-foreground" : "text-sm text-muted-foreground"}>
                                Leads con membresía
                            </CardTitle>
                        </CardHeader>
                        <CardContent className={tv ? "text-4xl font-semibold" : "text-3xl font-semibold"}>
                            {k.conversion.leadsConMembresia}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className={tv ? "text-base text-muted-foreground" : "text-sm text-muted-foreground"}>
                                Tasa de conversión
                            </CardTitle>
                        </CardHeader>
                        <CardContent className={tv ? "text-4xl font-semibold" : "text-3xl font-semibold"}>
                            {Math.round(k.conversion.tasa * 100)}%
                        </CardContent>
                    </Card>

                    <Card
                        className="cursor-pointer transition hover:bg-muted/30 active:scale-[0.99]"
                        onClick={() => router.push("/membresias?pagado=No")}
                    >
                        <CardHeader className="pb-2">
                            <CardTitle className={tv ? "text-base text-muted-foreground" : "text-sm text-muted-foreground"}>
                                Acción sugerida
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1">
                            <div className={tv ? "text-xl font-medium" : "text-base font-medium"}>Contactar pendientes de pago</div>
                            {!tv && <div className="text-xs text-muted-foreground">Ir a Membresías (Pagado = No)</div>}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
