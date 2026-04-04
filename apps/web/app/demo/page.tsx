"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback-state";
import { sbFetch } from "@/lib/supabaseRest";
import { useTenant } from "@/lib/tenant/use-tenant";

const DEMO_CODE_PREFIX = "DEMOSEED_";

type NarrativeTrackId = "commercial" | "operations" | "executive";

type NarrativeStep = {
    title: string;
    show: string;
    tell: string;
    href: string;
    cta: string;
    needsTakeoverCase?: boolean;
};

type NarrativeTrack = {
    id: NarrativeTrackId;
    badge: string;
    title: string;
    duration: string;
    outcome: string;
    steps: NarrativeStep[];
};

type DemoCampaign = {
    id: string;
    code: string | null;
    name: string | null;
    is_active: boolean | null;
    created_at: string | null;
};

type DemoLead = {
    id: string;
    source_id: string | null;
    campaign_id: string | null;
    work_status: "queued" | "assigned" | "in_progress" | "done" | null;
    human_takeover_status: "none" | "taken" | "released" | "closed" | null;
    sla_status: "no_sla" | "on_time" | "due_soon" | "overdue" | null;
    sla_is_escalated: boolean | null;
    created_at: string | null;
};

type DemoCall = {
    id: string;
    lead_id: string | null;
    assigned_channel: string | null;
    status: string | null;
    created_at: string | null;
};

function trimText(v: string | null | undefined) {
    return String(v || "").trim();
}

function shortId(v: string | null | undefined) {
    const value = trimText(v);
    return value ? `${value.slice(0, 8)}...` : "-";
}

function sourceHas(lead: DemoLead, token: string) {
    return trimText(lead.source_id).toUpperCase().includes(token.toUpperCase());
}

function pickScenarioLead(leads: DemoLead[], token: string, extra?: (lead: DemoLead) => boolean) {
    return (
        leads.find((lead) => sourceHas(lead, token) && (extra ? extra(lead) : true)) ||
        leads.find((lead) => sourceHas(lead, token)) ||
        null
    );
}

const NARRATIVE_TRACKS: NarrativeTrack[] = [
    {
        id: "commercial",
        badge: "Comercial / Producto",
        title: "Demo comercial de valor (7-10 min)",
        duration: "7-10 min",
        outcome: "Demostrar tracción comercial: volumen, conversión y capacidad de cierre sin fricción operativa.",
        steps: [
            {
                title: "Login + contexto de tenant",
                show: "Ingresar y remarcar que el entorno activo es eventprolabs con sesión real.",
                tell: "No es sandbox aislado: operamos con contexto real tenant-safe y control de acceso por rol.",
                href: "/login",
                cta: "Abrir Login",
            },
            {
                title: "Executive Demo Dashboard",
                show: "KPIs de alto nivel, funnel ejecutivo, ranking de campañas y alertas.",
                tell: "En menos de 1 minuto se entiende salud del funnel, riesgo y foco comercial.",
                href: "/leads/executive",
                cta: "Abrir Executive View",
            },
            {
                title: "Commercial Insights",
                show: "Funnel detallado por etapa, conversiones y bottlenecks por campaña.",
                tell: "Conecta inversión en campañas con resultados de operación y tasa de cierre.",
                href: "/leads/commercial",
                cta: "Abrir Commercial Insights",
            },
            {
                title: "Workspace omnicanal (caso takeover)",
                show: "Conversación real y continuidad bot-humano en un caso vivo del seed.",
                tell: "Cuando la IA requiere intervención humana, la continuidad no se rompe y el caso sigue trazable.",
                href: "/leads/workspace",
                cta: "Abrir Workspace",
                needsTakeoverCase: true,
            },
        ],
    },
    {
        id: "operations",
        badge: "Operativo / Desk",
        title: "Demo operativa de ejecución (8-12 min)",
        duration: "8-12 min",
        outcome: "Mostrar control de cola, priorización por SLA y resolución de leads de punta a punta.",
        steps: [
            {
                title: "Manager View",
                show: "Carga operativa, SLA, takeover y alertas consolidadas por campaña.",
                tell: "El supervisor detecta riesgo y asigna foco sin revisar pantallas aisladas.",
                href: "/leads/manager",
                cta: "Abrir Manager View",
            },
            {
                title: "Human Desk",
                show: "Cola filtrable, ownership, playbooks y acciones recomendadas.",
                tell: "El equipo opera con priorización guiada: menos improvisación y menor tiempo de respuesta.",
                href: "/leads/desk",
                cta: "Abrir Human Desk",
            },
            {
                title: "Caso SLA escalado",
                show: "Detalle de lead con señal overdue/escalated y eventos en timeline.",
                tell: "La plataforma identifica riesgo y acelera intervención antes de perder el lead.",
                href: "/leads/wow/view",
                cta: "Ver caso escalado",
            },
            {
                title: "Workspace omnicanal",
                show: "Tomar/soltar/cerrar takeover y continuidad entre conversación y estado operativo.",
                tell: "No hay salto entre herramientas: operación y conversación viven en el mismo flujo.",
                href: "/leads/workspace",
                cta: "Abrir Workspace",
                needsTakeoverCase: true,
            },
        ],
    },
    {
        id: "executive",
        badge: "Ejecutivo / Investor",
        title: "Demo ejecutiva para socios/inversionistas (5-7 min)",
        duration: "5-7 min",
        outcome: "Explicar impacto de negocio con lectura ejecutiva y evidencia de ejecución operacional.",
        steps: [
            {
                title: "Executive Demo Dashboard",
                show: "Volumen, atención, cierre, riesgo y alertas en una sola vista.",
                tell: "Métricas accionables sin BI adicional ni warehouse paralelo.",
                href: "/leads/executive",
                cta: "Abrir Executive View",
            },
            {
                title: "Commercial Insights",
                show: "Conversion rate por campaña y lectura de cuellos de botella.",
                tell: "Permite priorizar inversión comercial según desempeño real.",
                href: "/leads/commercial",
                cta: "Abrir Commercial Insights",
            },
            {
                title: "Manager View",
                show: "Puente a ejecución: carga, SLA, casos sin owner y takeover.",
                tell: "No es tablero decorativo: explica cómo se baja la estrategia a operación diaria.",
                href: "/leads/manager",
                cta: "Abrir Manager View",
            },
            {
                title: "Caso cerrado (evidencia E2E)",
                show: "Lead cerrado para mostrar ciclo completo desde intake hasta cierre.",
                tell: "La historia termina en resultado: trazabilidad completa de principio a fin.",
                href: "/leads/wow/view",
                cta: "Ver caso cerrado",
            },
        ],
    },
];

export default function DemoLauncherPage() {
    const { context, loading: tenantLoading } = useTenant();
    const tenantId = context?.tenantId || undefined;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [campaigns, setCampaigns] = useState<DemoCampaign[]>([]);
    const [leads, setLeads] = useState<DemoLead[]>([]);
    const [calls, setCalls] = useState<DemoCall[]>([]);
    const [trackId, setTrackId] = useState<NarrativeTrackId>("commercial");

    useEffect(() => {
        if (tenantLoading) return;

        if (!tenantId) {
            setLoading(false);
            setError("No se pudo resolver el tenant activo para el demo launcher.");
            return;
        }

        let alive = true;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const demoCampaigns = await sbFetch<DemoCampaign[]>("/rest/v1/campaigns", {
                    tenantId,
                    query: {
                        select: "id,code,name,is_active,created_at",
                        code: `ilike.${DEMO_CODE_PREFIX}%`,
                        order: "created_at.desc",
                        limit: 20,
                    },
                });

                const demoLeads = await sbFetch<DemoLead[]>("/rest/v1/leads", {
                    tenantId,
                    query: {
                        select: "id,source_id,campaign_id,work_status,human_takeover_status,sla_status,sla_is_escalated,created_at",
                        source_id: `ilike.${DEMO_CODE_PREFIX}%`,
                        order: "created_at.desc",
                        limit: 200,
                    },
                });

                const leadIds = (Array.isArray(demoLeads) ? demoLeads : []).map((l) => trimText(l.id)).filter(Boolean);
                let demoCalls: DemoCall[] = [];
                if (leadIds.length > 0) {
                    demoCalls = await sbFetch<DemoCall[]>("/rest/v1/calls", {
                        tenantId,
                        query: {
                            select: "id,lead_id,assigned_channel,status,created_at",
                            lead_id: `in.(${leadIds.join(",")})`,
                            order: "created_at.desc",
                            limit: 200,
                        },
                    });
                }

                if (!alive) return;
                setCampaigns(Array.isArray(demoCampaigns) ? demoCampaigns : []);
                setLeads(Array.isArray(demoLeads) ? demoLeads : []);
                setCalls(Array.isArray(demoCalls) ? demoCalls : []);
            } catch (e: unknown) {
                if (!alive) return;
                setError(e instanceof Error ? e.message : "No se pudo cargar información demo.");
            } finally {
                if (!alive) return;
                setLoading(false);
            }
        })();

        return () => {
            alive = false;
        };
    }, [tenantLoading, tenantId]);

    const scenario = useMemo(() => {
        const escalated =
            pickScenarioLead(leads, "_ESCALATED", (lead) => lead.sla_is_escalated === true) ||
            leads.find((lead) => lead.sla_is_escalated === true) ||
            null;

        const takeover =
            pickScenarioLead(leads, "_TAKEOVER", (lead) => {
                const takeoverStatus = trimText(lead.human_takeover_status).toLowerCase();
                return takeoverStatus === "taken" || takeoverStatus === "released";
            }) ||
            leads.find((lead) => {
                const takeoverStatus = trimText(lead.human_takeover_status).toLowerCase();
                return takeoverStatus === "taken" || takeoverStatus === "released";
            }) ||
            null;

        const closed =
            pickScenarioLead(leads, "_CLOSED", (lead) => {
                const takeoverStatus = trimText(lead.human_takeover_status).toLowerCase();
                const workStatus = trimText(lead.work_status).toLowerCase();
                return takeoverStatus === "closed" || workStatus === "done";
            }) ||
            leads.find((lead) => {
                const takeoverStatus = trimText(lead.human_takeover_status).toLowerCase();
                const workStatus = trimText(lead.work_status).toLowerCase();
                return takeoverStatus === "closed" || workStatus === "done";
            }) ||
            null;

        const duplicate = pickScenarioLead(leads, "_DEDUP") || null;
        const workspaceCall = calls.find((call) => trimText(call.lead_id) === trimText(takeover?.id)) || calls[0] || null;

        return { escalated, takeover, closed, duplicate, workspaceCall };
    }, [calls, leads]);

    const hasDemoSeed = campaigns.length > 0 || leads.length > 0;
    const activeTrack = NARRATIVE_TRACKS.find((track) => track.id === trackId) || NARRATIVE_TRACKS[0];

    function resolveStepHref(step: NarrativeStep) {
        if (step.href === "/leads/workspace" && step.needsTakeoverCase && scenario.takeover) {
            return `/leads/workspace?leadId=${encodeURIComponent(scenario.takeover.id)}${scenario.workspaceCall ? `&callId=${encodeURIComponent(scenario.workspaceCall.id)}` : ""
                }`;
        }
        if (step.href === "/leads/wow/view" && step.cta.includes("escalado") && scenario.escalated) {
            return `/leads/wow/view?id=${encodeURIComponent(scenario.escalated.id)}`;
        }
        if (step.href === "/leads/wow/view" && step.cta.includes("cerrado") && scenario.closed) {
            return `/leads/wow/view?id=${encodeURIComponent(scenario.closed.id)}`;
        }
        return step.href;
    }

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-2">
                    <Badge variant="secondary">Demo flow · Guided showcase MVP</Badge>
                    <h1 className="text-2xl font-semibold">Demo Launcher</h1>
                    <p className="text-sm text-muted-foreground max-w-3xl">
                        Punto de entrada para demos comerciales: concentra los mejores accesos y un recorrido sugerido
                        para Human Desk, Manager View y Workspace omnicanal usando el seed demo existente.
                    </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                    <Button asChild variant="outline" size="sm">
                        <Link href="/leads/executive">Executive View</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                        <Link href="/leads/desk">Human Desk</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                        <Link href="/leads/manager">Manager View</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                        <Link href="/leads/commercial">Commercial Insights</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                        <Link href="/leads/workspace">Workspace</Link>
                    </Button>
                </div>
            </div>

            {loading && <LoadingState label="Preparando casos demo..." />}
            {!loading && error && <ErrorState title="No pudimos cargar el demo launcher" description={error} />}

            {!loading && !error && !hasDemoSeed ? (
                <EmptyState
                    title="No encontramos dataset demo en este tenant"
                    description="Ejecuta seed:demo y valida que el tenant activo tenga campañas/casos DEMOSEED_."
                />
            ) : null}

            {!loading && !error && hasDemoSeed ? (
                <>
                    <Card>
                        <CardHeader>
                            <CardTitle>Pre-flight demo checklist</CardTitle>
                            <CardDescription>Checklist mínimo para evitar bloqueos en vivo durante la presentación.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <div>• Tenant activo correcto en switcher (eventprolabs o tenant demo objetivo).</div>
                            <div>• Dataset demo visible: campañas/leads con prefijo <span className="font-mono">DEMOSEED_</span>.</div>
                            <div>• Rol recomendado para demo completa: supervisor / tenant_admin / superadmin.</div>
                            <div>• Punto de entrada único: esta pantalla ({"/demo"}) para evitar buscar rutas manualmente.</div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Narrativa guiada por audiencia</CardTitle>
                            <CardDescription>
                                Selecciona el tipo de demo y usa el guion de qué mostrar + qué contar paso a paso.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex flex-wrap gap-2">
                                {NARRATIVE_TRACKS.map((track) => {
                                    const selected = track.id === activeTrack.id;
                                    return (
                                        <button
                                            key={track.id}
                                            type="button"
                                            className={[
                                                "rounded-md border px-3 py-1.5 text-sm",
                                                selected ? "bg-muted font-medium" : "hover:bg-muted/60",
                                            ].join(" ")}
                                            onClick={() => setTrackId(track.id)}
                                        >
                                            {track.badge}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="rounded-md border p-3 space-y-1">
                                <div className="text-sm font-medium">{activeTrack.title}</div>
                                <div className="text-xs text-muted-foreground">Duración sugerida: {activeTrack.duration}</div>
                                <div className="text-sm mt-1">Resultado esperado: {activeTrack.outcome}</div>
                            </div>

                            <div className="space-y-3">
                                {activeTrack.steps.map((step, idx) => {
                                    const href = resolveStepHref(step);
                                    return (
                                        <div key={`${activeTrack.id}-${step.title}`} className="rounded-md border p-3 space-y-1">
                                            <div className="text-sm font-medium">
                                                {idx + 1}. {step.title}
                                            </div>
                                            <div className="text-sm">
                                                <span className="font-medium">Qué mostrar:</span> {step.show}
                                            </div>
                                            <div className="text-sm">
                                                <span className="font-medium">Qué contar:</span> {step.tell}
                                            </div>
                                            <Link className="text-sm underline" href={href}>
                                                {step.cta}
                                            </Link>
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Recorrido sugerido (7-10 min)</CardTitle>
                            <CardDescription>
                                Orden recomendado para contar el valor del producto sin memorizar rutas largas ni IDs.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <div>
                                1) <b>Executive View:</b> abre una lectura high-level de volumen, funnel, cierre y riesgo para conversación comercial/inversionista.
                                <Link className="ml-2 underline" href="/leads/executive">
                                    Abrir
                                </Link>
                            </div>
                            <div>
                                2) <b>Manager View:</b> abre métricas de cola, takeover y SLA para contexto operativo.
                                <Link className="ml-2 underline" href="/leads/manager">
                                    Abrir
                                </Link>
                            </div>
                            <div>
                                3) <b>Commercial Insights:</b> explica funnel, conversión por campaña y cuellos operativos.
                                <Link className="ml-2 underline" href="/leads/commercial">
                                    Abrir
                                </Link>
                            </div>
                            <div>
                                4) <b>Human Desk:</b> entra a operación, ownership y acciones de playbook sobre casos vivos.
                                <Link className="ml-2 underline" href="/leads/desk">
                                    Abrir
                                </Link>
                            </div>
                            <div>
                                5) <b>Workspace omnicanal:</b> muestra conversación real, takeover humano y continuidad.
                                {scenario.takeover ? (
                                    <Link
                                        className="ml-2 underline"
                                        href={`/leads/workspace?leadId=${encodeURIComponent(scenario.takeover.id)}${scenario.workspaceCall ? `&callId=${encodeURIComponent(scenario.workspaceCall.id)}` : ""
                                            }`}
                                    >
                                        Abrir caso takeover
                                    </Link>
                                ) : (
                                    <Link className="ml-2 underline" href="/leads/workspace">
                                        Abrir
                                    </Link>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Caso escalado SLA</CardTitle>
                                <CardDescription>Ideal para mostrar alertas y priorización.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <div className="text-muted-foreground">Lead: {shortId(scenario.escalated?.id)}</div>
                                {scenario.escalated ? (
                                    <Link className="underline" href={`/leads/wow/view?id=${encodeURIComponent(scenario.escalated.id)}`}>
                                        Ver detalle escalado
                                    </Link>
                                ) : (
                                    <div className="text-muted-foreground">Sin caso detectado en tenant activo.</div>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Caso takeover</CardTitle>
                                <CardDescription>Demuestra handoff humano y continuidad operacional.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <div className="text-muted-foreground">Lead: {shortId(scenario.takeover?.id)}</div>
                                {scenario.takeover ? (
                                    <Link
                                        className="underline"
                                        href={`/leads/workspace?leadId=${encodeURIComponent(scenario.takeover.id)}${scenario.workspaceCall ? `&callId=${encodeURIComponent(scenario.workspaceCall.id)}` : ""
                                            }`}
                                    >
                                        Abrir takeover en workspace
                                    </Link>
                                ) : (
                                    <div className="text-muted-foreground">Sin caso detectado en tenant activo.</div>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Caso cerrado</CardTitle>
                                <CardDescription>Permite narrar ciclo completo desde intake hasta cierre.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <div className="text-muted-foreground">Lead: {shortId(scenario.closed?.id)}</div>
                                {scenario.closed ? (
                                    <Link className="underline" href={`/leads/wow/view?id=${encodeURIComponent(scenario.closed.id)}`}>
                                        Ver caso cerrado
                                    </Link>
                                ) : (
                                    <div className="text-muted-foreground">Sin caso detectado en tenant activo.</div>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Caso duplicado / merge</CardTitle>
                                <CardDescription>Explica deduplicación y política de merge del intake.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <div className="text-muted-foreground">Lead: {shortId(scenario.duplicate?.id)}</div>
                                {scenario.duplicate ? (
                                    <Link className="underline" href={`/leads/wow/view?id=${encodeURIComponent(scenario.duplicate.id)}`}>
                                        Ver caso dedup
                                    </Link>
                                ) : (
                                    <div className="text-muted-foreground">Sin caso detectado en tenant activo.</div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Campañas demo del tenant activo</CardTitle>
                            <CardDescription>
                                Señalización explícita de campañas seed para evitar depender de recordar IDs.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {campaigns.length === 0 ? (
                                <div className="text-sm text-muted-foreground">No hay campañas DEMOSEED_ en este tenant.</div>
                            ) : (
                                <div className="grid gap-2 md:grid-cols-2">
                                    {campaigns.map((campaign) => (
                                        <div key={campaign.id} className="rounded-md border p-3 text-sm">
                                            <div className="font-medium">{campaign.name || campaign.id}</div>
                                            <div className="text-xs text-muted-foreground mt-1">
                                                <span className="font-mono">{campaign.code || "(sin code)"}</span>
                                            </div>
                                            <div className="mt-2 flex gap-3 text-xs">
                                                <Link className="underline" href={`/campaigns/${campaign.id}`}>
                                                    Ver campaña
                                                </Link>
                                                <Link className="underline" href="/campaigns">
                                                    Ir a listado
                                                </Link>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </>
            ) : null}
        </div>
    );
}
