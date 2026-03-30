// app/api/aap/campaigns/list/route.ts
import { NextResponse } from "next/server";

function env(name: string, required = true) {
    const v = (process.env[name] || "").trim();
    if (required && !v) throw new Error(`Missing env var: ${name}`);
    return v;
}

function json(status: number, body: any) {
    return NextResponse.json(body, { status });
}

export async function GET() {
    try {
        const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
        const key =
            (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
                process.env.SUPABASE_ANON_KEY ||
                "").trim();

        if (!key) throw new Error("Missing env var: SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)");

        const PROFILE = "demo_callcenter";

        // Si tu tabla campaigns está en schema demo_callcenter y PostgREST expone ese schema con Accept-Profile,
        // esto funcionará directo.
        const base = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/campaigns`;
        const endpoint =
            `${base}?select=id,code,name,is_active&is_active=eq.true&order=name.asc`;

        const headers = new Headers();
        headers.set("Accept-Profile", PROFILE);
        headers.set("apikey", key);
        headers.set("Authorization", `Bearer ${key}`);

        const res = await fetch(endpoint, { headers, cache: "no-store" });

        if (!res.ok) {
            const txt = await res.text().catch(() => "");
            return json(res.status, { error: "PostgREST error", endpoint, details: txt });
        }

        const items = await res.json();

        // Devolvemos shape simple
        return json(200, { items });
    } catch (e: any) {
        return json(500, { error: e?.message || "Unexpected error", details: String(e) });
    }
}
