import { NextResponse } from "next/server";

function jsonOk(data: any, init?: ResponseInit) {
    return NextResponse.json(data, { status: 200, ...init });
}
function jsonErr(message: string, status = 400, extra?: any) {
    return NextResponse.json({ ok: false, message, ...extra }, { status });
}

function getEnv(name: string, required = true): string {
    const v = process.env[name];
    if (required && (!v || !String(v).trim())) throw new Error(`Missing env var: ${name}`);
    return String(v || "").trim();
}

const cleanDigits = (v: any) => String(v ?? "").replace(/@.*$/, "").replace(/\D/g, "");

export async function POST(req: Request) {
    try {
        const N8N_WA_OUTBOUND_URL = getEnv("N8N_WA_OUTBOUND_URL", true);
        const EVOLUTION_APIKEY = getEnv("EVOLUTION_APIKEY", true);

        const body = await req.json().catch(() => ({}));

        const call_id = String(body.call_id ?? "").trim();
        const agent_id = String(body.agent_id ?? "web").trim();
        const instance = String(body.instance ?? "").trim();
        const to = cleanDigits(body.to);
        const text = String(body.text ?? "").trim();
        const raw = body.raw ?? { source: "web_inbox" };

        if (!call_id) return jsonErr("call_id requerido");
        if (!instance) return jsonErr("instance requerido");
        if (!to) return jsonErr("to requerido");
        if (!text) return jsonErr("text requerido");

        const payload = { call_id, agent_id, instance, to, text, raw, apikey: EVOLUTION_APIKEY };

        const res = await fetch(N8N_WA_OUTBOUND_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        });

        const txt = await res.text();
        if (!res.ok) return jsonErr("n8n outbound error", 502, { status: res.status, response: txt });

        try {
            return jsonOk({ ok: true, n8n: JSON.parse(txt) });
        } catch {
            return jsonOk({ ok: true, n8n_raw: txt });
        }
    } catch (e: any) {
        return jsonErr(e?.message ?? String(e), 500);
    }
}
