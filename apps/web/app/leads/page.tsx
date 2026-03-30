"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Lead = {
    id: string;
    phone: string | null;

    // ✅ Columna real
    campaign_id: string | null;

    // (si existe también, no estorba)
    campaign?: string | null;

    estado_cliente: string | null;
    created_at: string;
};

type Campaign = {
    id: string;
    code: string | null;
    name: string | null;
    is_active?: boolean | null;
};

// ✅ campaña Claro Peru Fijo (id de campaign)
const CLARO_PERU_FIJO_CAMPAIGN_ID = "be637346-39fd-4f4a-9dcf-4c3d58d03d84";

// ✅ lead a fijar para demo cuando se elige Claro Peru Fijo
const PINNED_LEAD_ID_FIJO = "038a89ac-9e92-4f93-ab65-375409b46d23";

// ✅ Pines globales (se mantienen tal cual)
const PINNED_LEAD_IDS = [
    "243ce61e-066a-41c8-bd25-7222be2f54ba",
    "15f944c0-de92-42b5-8054-5113666b6cf4",
] as const;

const DB_SCHEMA = "demo_callcenter";

function buildUrl(path: string, query?: Record<string, string>) {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!base) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL (sin /rest/v1)");

    const url = new URL(path, base);
    if (query) {
        for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }
    return url.toString();
}

async function sbGet<T>(path: string, query?: Record<string, string>): Promise<T> {
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anon) throw new Error("Falta NEXT_PUBLIC_SUPABASE_ANON_KEY");

    const res = await fetch(buildUrl(path, query), {
        method: "GET",
        headers: {
            apikey: anon,
            Authorization: `Bearer ${anon}`,
            "Content-Type": "application/json",
            "Accept-Profile": DB_SCHEMA,
        },
        cache: "no-store",
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Supabase REST ${res.status}: ${text}`);
    }

    return (await res.json()) as T;
}

export default function LeadsPage() {
    const router = useRouter();
    const sp = useSearchParams();

    const selectedCampaign = (sp.get("campaign") || "").trim(); // UUID
    const isFiltering = selectedCampaign.length > 0;

    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>("");

    function setCampaignToUrl(value: string) {
        const params = new URLSearchParams(sp.toString());
        if (!value) params.delete("campaign");
        else params.set("campaign", value);

        const qs = params.toString();
        router.push(qs ? `/leads?${qs}` : "/leads");
    }

    // 1) Cargar campañas (1 vez)
    useEffect(() => {
        let alive = true;
        setError("");

        sbGet<Campaign[]>("/rest/v1/campaigns", {
            select: "id,code,name,is_active",
            order: "name.asc",
            limit: "200",
        })
            .then((data) => {
                if (!alive) return;
                setCampaigns(Array.isArray(data) ? data : []);
            })
            .catch((e) => {
                if (!alive) return;
                setError(e?.message || "Error cargando campañas");
            });

        return () => {
            alive = false;
        };
    }, []);

    const campaignNameById = useMemo(() => {
        return new Map(campaigns.map((c) => [c.id, c.name || c.code || c.id]));
    }, [campaigns]);

    const selectedCampaignLabel = isFiltering
        ? campaignNameById.get(selectedCampaign) || selectedCampaign
        : "Todas";

    // 2) Cargar leads
    //    - Sin filtro: últimos 200 globales
    //    - Con filtro: últimos 500 de ESA campaña (campaign_id)
    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError("");

        const baseSelect = "id,phone,campaign_id,campaign,estado_cliente,created_at";

        const latestQuery: Record<string, string> = {
            select: baseSelect,
            order: "created_at.desc",
            limit: isFiltering ? "500" : "200",
        };

        // ✅ filtro correcto por columna campaign_id
        if (isFiltering) latestQuery["campaign_id"] = `eq.${selectedCampaign}`;

        // ✅ OJO: pinnedQuery NO debe filtrarse por campaña.
        // Traemos siempre los pineados y luego el sort decide si aplican.
        const pinnedQuery: Record<string, string> = {
            select: baseSelect,
            id: `in.(${[...PINNED_LEAD_IDS, PINNED_LEAD_ID_FIJO].join(",")})`,
        };

        Promise.all([
            sbGet<Lead[]>("/rest/v1/leads", latestQuery),
            sbGet<Lead[]>("/rest/v1/leads", pinnedQuery),
        ])
            .then(([latest, pinned]) => {
                if (!alive) return;

                const map = new Map<string, Lead>();
                for (const p of pinned || []) map.set(p.id, p);
                for (const l of latest || []) map.set(l.id, l);

                const ordered = Array.from(map.values())
                    .sort((a, b) => {
                        // ✅ Pin especial SOLO cuando se filtra por "Claro Peru Fijo"
                        // Y solo si el lead realmente pertenece a esa campaña (campaign_id == selectedCampaign)
                        const isFijoCampaign = selectedCampaign === CLARO_PERU_FIJO_CAMPAIGN_ID;

                        if (isFijoCampaign) {
                            const aIsPinnedFijo =
                                a.id === PINNED_LEAD_ID_FIJO && String(a.campaign_id || "") === selectedCampaign;
                            const bIsPinnedFijo =
                                b.id === PINNED_LEAD_ID_FIJO && String(b.campaign_id || "") === selectedCampaign;

                            if (aIsPinnedFijo && !bIsPinnedFijo) return -1;
                            if (!aIsPinnedFijo && bIsPinnedFijo) return 1;
                        }

                        // Pines globales (se mantienen)
                        const ia = PINNED_LEAD_IDS.indexOf(a.id as any);
                        const ib = PINNED_LEAD_IDS.indexOf(b.id as any);

                        const aPinned = ia !== -1;
                        const bPinned = ib !== -1;

                        if (aPinned && bPinned) return ia - ib;
                        if (aPinned) return -1;
                        if (bPinned) return 1;

                        // Orden por fecha desc para el resto
                        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                    })
                    .slice(0, 52);

                setLeads(ordered);
            })
            .catch((e) => {
                if (!alive) return;
                setError(e?.message || "Error cargando leads");
                setLeads([]);
            })
            .finally(() => {
                if (!alive) return;
                setLoading(false);
            });

        return () => {
            alive = false;
        };
    }, [isFiltering, selectedCampaign]);

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold">Leads</h1>
                    <p className="text-sm text-muted-foreground">
                        {isFiltering
                            ? `Filtrando por campaña: ${selectedCampaignLabel}`
                            : "Últimos leads + leads fijados (demo)"}
                    </p>
                </div>
                <a href="/leads/wow" className="rounded-md border px-3 py-2 text-sm">
                    🔥 Cola priorizada (WOW)
                </a>

                <div className="flex items-center gap-2">
                    <label className="text-sm text-muted-foreground" htmlFor="campaign">
                        Campaña
                    </label>

                    <select
                        id="campaign"
                        value={selectedCampaign}
                        onChange={(e) => setCampaignToUrl(e.target.value)}
                        className="h-9 rounded-md border bg-background px-3 text-sm"
                    >
                        <option value="">Todas</option>
                        {campaigns.map((c) => (
                            <option key={c.id} value={c.id}>
                                {(c.name || c.code || c.id) as string}
                            </option>
                        ))}
                    </select>

                    {isFiltering && (
                        <button
                            type="button"
                            onClick={() => setCampaignToUrl("")}
                            className="h-9 rounded-md border px-3 text-sm hover:bg-muted"
                        >
                            Limpiar
                        </button>
                    )}
                </div>
            </div>

            {error && (
                <div className="rounded-md border p-3 text-sm">
                    <b>Error:</b> {error}
                </div>
            )}

            <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                        <tr>
                            <th className="text-left p-3">Teléfono</th>
                            <th className="text-left p-3">Campaña</th>
                            <th className="text-left p-3">Estado</th>
                            <th className="text-left p-3">Fecha</th>
                            <th className="text-right p-3">Acción</th>
                        </tr>
                    </thead>

                    <tbody>
                        {loading && (
                            <tr>
                                <td className="p-6 text-center text-muted-foreground" colSpan={5}>
                                    Cargando...
                                </td>
                            </tr>
                        )}

                        {!loading &&
                            leads.map((l) => {
                                const pinnedIndex = PINNED_LEAD_IDS.indexOf(l.id as any);
                                const isPinnedGlobal = pinnedIndex !== -1;

                                const isPinnedFijo =
                                    selectedCampaign === CLARO_PERU_FIJO_CAMPAIGN_ID &&
                                    l.id === PINNED_LEAD_ID_FIJO &&
                                    String(l.campaign_id || "") === selectedCampaign;

                                return (
                                    <tr
                                        key={l.id}
                                        className={`border-t ${isPinnedGlobal || isPinnedFijo ? "bg-muted/20" : ""}`}
                                    >
                                        <td className="p-3">
                                            {l.phone ?? "-"}
                                            {isPinnedFijo && (
                                                <span className="ml-2 text-xs px-2 py-0.5 rounded-full border">
                                                    DEMO FIJO
                                                </span>
                                            )}
                                            {isPinnedGlobal && (
                                                <span className="ml-2 text-xs px-2 py-0.5 rounded-full border">
                                                    DEMO {pinnedIndex + 1}
                                                </span>
                                            )}
                                        </td>

                                        <td className="p-3">
                                            {l.campaign_id
                                                ? campaignNameById.get(l.campaign_id) || l.campaign_id
                                                : l.campaign || "-"}
                                        </td>

                                        <td className="p-3">{l.estado_cliente ?? "-"}</td>

                                        <td className="p-3">
                                            {l.created_at ? new Date(l.created_at).toLocaleString() : "-"}
                                        </td>

                                        <td className="p-3 text-right">
                                            <Link className="underline" href={`/leads/view?id=${encodeURIComponent(l.id)}`}>
                                                Ver
                                            </Link>
                                        </td>
                                    </tr>
                                );
                            })}

                        {!loading && leads.length === 0 && (
                            <tr>
                                <td className="p-6 text-center text-muted-foreground" colSpan={5}>
                                    No hay leads para el filtro seleccionado.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
