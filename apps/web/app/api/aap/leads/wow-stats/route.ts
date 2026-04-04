// app/api/aap/leads/wow-stats/route.ts
import { NextResponse } from "next/server";
import { resolveTenantFromRequest } from "../../../../../lib/tenant/tenant-request";

function env(name: string, required = true) {
    const v = (process.env[name] || "").trim();
    if (required && !v) throw new Error(`Missing env var: ${name}`);
    return v;
}

function json(status: number, body: unknown) {
    return NextResponse.json(body, { status });
}

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseTotalFromContentRange(cr: string | null): number {
    // "0-0/4097"
    if (!cr) return 0;
    const m = cr.match(/\/(\d+)\s*$/);
    return m ? Number(m[1]) : 0;
}

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const tenant = await resolveTenantFromRequest(req);

        const campaignIdRaw = (url.searchParams.get("campaign_id") || "").trim();
        const temperatureRaw = (url.searchParams.get("temperature") || "").trim().toLowerCase();
        const priorityRaw = (url.searchParams.get("priority") || "").trim().toUpperCase();
        const qRaw = (url.searchParams.get("q") || "").trim();

        const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
        const key =
            (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
                process.env.SUPABASE_ANON_KEY ||
                process.env.SUPABASE_SERVICE_ROLE_KEY ||
                "").trim();

        if (!key) throw new Error("Missing env var: SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)");

        const PROFILE = "contact_center";
        const base = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/v_leads_wow_queue`;
        const baseLeads = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/leads`;

        const headers = new Headers();
        headers.set("Accept-Profile", PROFILE);
        headers.set("apikey", key);
        headers.set("Authorization", `Bearer ${key}`);
        headers.set("Prefer", "count=exact");

        const buildParams = (opts?: {
            temp?: "caliente" | "tibio" | "frio";
            includeTempFilter?: boolean;
            slaOverdue?: boolean;
            slaStatus?: 'no_sla' | 'on_time' | 'due_soon' | 'overdue';
            escalatedOnly?: boolean;
        }) => {
            const sp = new URLSearchParams();

            if (!tenant.isSuperAdmin) sp.set("tenant_id", `eq.${tenant.tenantId}`);

            if (campaignIdRaw && UUID_RE.test(campaignIdRaw)) sp.set("campaign_id", `eq.${campaignIdRaw}`);
            if (["P1", "P2", "P3"].includes(priorityRaw)) sp.set("priority", `eq.${priorityRaw}`);

            // búsqueda (mismo criterio que wow-queue)
            if (qRaw) {
                const like = `*${qRaw.replace(/%/g, "")}*`;
                sp.set("or", `(phone.ilike.${like},phone_norm.ilike.${like},form_id.ilike.${like})`);
            }

            const includeTemp = opts?.includeTempFilter !== false; // default true
            if (includeTemp && ["caliente", "tibio", "frio"].includes(temperatureRaw)) {
                sp.set("lead_temperature", `eq.${temperatureRaw}`);
            }

            if (opts?.temp) sp.set("lead_temperature", `eq.${opts.temp}`);

            if (opts?.slaOverdue) {
                // SLA vencido = sla_due_at < now
                const nowIso = new Date().toISOString();
                sp.set("sla_due_at", `lt.${nowIso}`);
            }

            if (opts?.slaStatus) {
                sp.set('sla_status', `eq.${opts.slaStatus}`);
            }

            if (opts?.escalatedOnly) {
                sp.set('sla_is_escalated', 'eq.true');
            }

            // solo para count via Content-Range
            sp.set("select", "id");
            sp.set("limit", "1");
            sp.set("offset", "0");

            return sp;
        };

        const countBy = async (params: URLSearchParams, endpointBase = base) => {
            const endpoint = `${endpointBase}?${params.toString()}`;
            const res = await fetch(endpoint, { headers, cache: "no-store" });
            if (!res.ok) {
                const txt = await res.text().catch(() => "");
                throw new Error(`PostgREST count failed: ${res.status} ${txt}`);
            }
            return parseTotalFromContentRange(res.headers.get("content-range"));
        };

        // Total (respeta todos los filtros, incluido temperature si está seleccionado)
        const total = await countBy(buildParams({ includeTempFilter: true }));

        // Conteo por temperatura SIEMPRE sin el filtro temperature global (para que los cards siempre tengan data)
        const calientes = await countBy(buildParams({ includeTempFilter: false, temp: "caliente" }));
        const tibios = await countBy(buildParams({ includeTempFilter: false, temp: "tibio" }));
        const frios = await countBy(buildParams({ includeTempFilter: false, temp: "frio" }));

        // SLA vencido (respeta filtros actuales, incluido temperature si está seleccionado)
        const slaVencido = await countBy(buildParams({ includeTempFilter: true, slaOverdue: true }));
        const slaDueSoonParams = buildParams({ includeTempFilter: true });
        const nowIso = new Date().toISOString();
        const soonIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        slaDueSoonParams.set('and', `(sla_due_at.gte.${nowIso},sla_due_at.lte.${soonIso})`);

        const slaEscalatedParams = buildParams({ includeTempFilter: true, escalatedOnly: true });

        const slaDueSoon = await countBy(slaDueSoonParams, baseLeads);
        const slaEscalated = await countBy(slaEscalatedParams, baseLeads);

        // 🔥 Respuesta ultra-compatible (por si el UI espera distintos nombres)
        return json(200, {
            // ✅ los que ya te funcionan
            total,
            sla_vencido: slaVencido,
            sla_overdue: slaVencido,
            sla_due_soon: slaDueSoon,
            sla_escalated: slaEscalated,

            // ✅ español simple
            calientes,
            tibios,
            frios,

            // ✅ inglés simple
            hot: calientes,
            warm: tibios,
            cold: frios,

            // ✅ variantes comunes (snake/camel + *_count/_total)
            calientes_count: calientes,
            tibios_count: tibios,
            frios_count: frios,
            calientes_total: calientes,
            tibios_total: tibios,
            frios_total: frios,
            calientesCount: calientes,
            tibiosCount: tibios,
            friosCount: frios,
            calientesTotal: calientes,
            tibiosTotal: tibios,
            friosTotal: frios,

            hot_count: calientes,
            warm_count: tibios,
            cold_count: frios,
            hot_total: calientes,
            warm_total: tibios,
            cold_total: frios,
            hotCount: calientes,
            warmCount: tibios,
            coldCount: frios,
            hotTotal: calientes,
            warmTotal: tibios,
            coldTotal: frios,

            // ✅ objetos anidados (muchas UIs usan esto)
            temps: { caliente: calientes, tibio: tibios, frio: frios },
            by_temperature: { caliente: calientes, tibio: tibios, frio: frios },
            temperatureCounts: { caliente: calientes, tibio: tibios, frio: frios },
            cards: {
                total,
                calientes,
                tibios,
                frios,
                sla_vencido: slaVencido,
                sla_due_soon: slaDueSoon,
                sla_escalated: slaEscalated,
            },

            debug: {
                campaign_id: campaignIdRaw || null,
                temperature: temperatureRaw || null,
                priority: priorityRaw || null,
                q: qRaw || null,
            },
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Unexpected error";
        return json(500, { error: message, details: String(e) });
    }
}
