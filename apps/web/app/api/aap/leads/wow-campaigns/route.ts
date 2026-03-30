// app/api/aap/leads/wow-campaigns/route.ts
import { NextResponse } from "next/server";

function env(name: string, required = true) {
    const v = (process.env[name] || "").trim();
    if (required && !v) throw new Error(`Missing env var: ${name}`);
    return v;
}

function json(status: number, body: any) {
    return NextResponse.json(body, { status });
}

type CampaignOption = {
    id: string;
    code: string | null;
    name: string | null;
};

export async function GET() {
    try {
        const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
        const key =
            (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
                process.env.SUPABASE_ANON_KEY ||
                process.env.SUPABASE_SERVICE_ROLE_KEY ||
                "").trim();

        if (!key) throw new Error("Missing SUPABASE key (ANON o SERVICE ROLE)");

        // 👇 IMPORTANTE: tu schema real
        const PROFILE = "demo_callcenter";

        // Esta vista existe dentro del schema demo_callcenter
        const base = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/v_leads_wow_queue`;
        const endpoint = `${base}?select=campaign_id,campaign&limit=10000`;

        const headers = new Headers();
        headers.set("Accept-Profile", PROFILE); // ✅ CLAVE: evita que busque en public
        headers.set("apikey", key);
        headers.set("Authorization", `Bearer ${key}`);

        const res = await fetch(endpoint, { headers, cache: "no-store" });

        if (!res.ok) {
            const txt = await res.text().catch(() => "");
            return json(res.status, { error: "PostgREST error", endpoint, details: txt });
        }

        const rows = (await res.json()) as Array<{
            campaign_id: string | null;
            campaign: string | null;
        }>;

        const map = new Map<string, CampaignOption>();
        for (const r of rows) {
            const id = (r.campaign_id || "").trim();
            if (!id) continue;
            if (!map.has(id)) {
                map.set(id, {
                    id,
                    code: null,
                    name: (r.campaign || "").trim() || null,
                });
            }
        }

        const items = Array.from(map.values()).sort((a, b) =>
            (a.name || a.id).localeCompare(b.name || b.id, "es")
        );

        return json(200, { items });
    } catch (e: any) {
        return json(500, { error: e?.message || "Unexpected error", details: String(e) });
    }
}
