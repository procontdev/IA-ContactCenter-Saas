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

function toE164(p: string) {
    const digits = String(p ?? "").replace(/[^\d]/g, "");
    if (!digits) return "";
    return digits.startsWith("0") ? `+51${digits.replace(/^0+/, "")}` : `+${digits}`;
}

export async function POST(req: Request) {
    try {
        const N8N_WA_SEND_WEBHOOK_URL = getEnv("N8N_WA_SEND_WEBHOOK_URL", true);

        const body = await req.json().catch(() => ({}));
        const call_id = String(body.call_id || "").trim();
        const agent_id = String(body.agent_id || "web").trim();
        const text = String(body.text || "").trim();
        const instance = String(body.instance || "").trim();
        const to = String(body.to || "").trim();

        if (!call_id) return jsonErr("call_id requerido");
        if (!text) return jsonErr("text requerido");
        if (!instance) return jsonErr("instance requerido");
        if (!to) return jsonErr("to requerido");

        // Normaliza teléfono a E.164
        const to_norm = to.startsWith("+") ? to : toE164(to);

        const res = await fetch(N8N_WA_SEND_WEBHOOK_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                call_id,
                agent_id,
                instance,
                to: to_norm,
                text,
                source: "web_inbox",
            }),
        });

        const raw = await res.text();
        if (!res.ok) {
            return jsonErr("n8n webhook error", 502, { status: res.status, response: raw });
        }

        // si n8n devuelve JSON, lo pasamos; si no, devolvemos texto
        try {
            return jsonOk({ ok: true, n8n: JSON.parse(raw) });
        } catch {
            return jsonOk({ ok: true, n8n_raw: raw });
        }
    } catch (e: any) {
        return jsonErr(e?.message ?? String(e), 500);
    }
}
