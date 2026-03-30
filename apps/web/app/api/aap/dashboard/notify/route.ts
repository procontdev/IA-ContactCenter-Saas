import { NextResponse } from "next/server";

export async function POST(req: Request) {
    const body = await req.json();

    const n8nUrl = process.env.N8N_NOTIFY_WEBHOOK_URL; // e.g. https://tu-n8n/webhook/aap/dashboard/notify
    const token = process.env.N8N_NOTIFY_TOKEN;        // opcional (recomendado)

    if (!n8nUrl) {
        return NextResponse.json({ error: "Missing N8N_NOTIFY_WEBHOOK_URL" }, { status: 500 });
    }

    const res = await fetch(n8nUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { "x-webhook-token": token } : {}),
        },
        body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));

    return NextResponse.json(json, { status: res.status });
}
