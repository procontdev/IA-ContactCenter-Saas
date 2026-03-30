// app/leads/[id]/page.tsx
import Link from "next/link";
import { sbFetch } from "@/lib/supabaseRest";

type Lead = {
    id: string;
    phone: string | null;
    campaign: string | null;
    estado_cliente: string | null;
    created_at: string;
};

type Call = {
    id: string;
    lead_id: string;
    mode: string;
    status: string | null;
    started_at: string | null;
    ended_at: string | null;
    duration_sec: number | null;
    phone: string | null;
};

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
    const [lead] = await sbFetch<Lead[]>("/rest/v1/leads", {
        query: { select: "*", id: `eq.${params.id}`, limit: 1 },
    });

    const calls = await sbFetch<Call[]>("/rest/v1/calls", {
        query: {
            select: "id,lead_id,mode,status,started_at,ended_at,duration_sec,phone",
            lead_id: `eq.${params.id}`,
            order: "created_at.desc",
            limit: 50,
        },
    });

    if (!lead) return <div className="p-6">Lead no encontrado.</div>;

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <Link href="/leads" className="text-sm underline">← Volver</Link>
                    <h1 className="text-2xl font-semibold mt-2">Lead</h1>
                    <div className="text-sm text-muted-foreground">
                        {lead.phone ?? "-"} · {lead.campaign ?? "-"} · {lead.estado_cliente ?? "-"}
                    </div>
                </div>

                <div className="flex gap-2">
                    {/* Por ahora solo UI; luego lo conectamos al webhook de n8n */}
                    <a
                        className="px-3 py-2 rounded-lg border hover:bg-muted"
                        href={`#`}
                        onClick={(e) => { e.preventDefault(); alert("Siguiente: conectar a n8n Start Human Call"); }}
                    >
                        Llamar (Humano)
                    </a>
                    <a
                        className="px-3 py-2 rounded-lg border hover:bg-muted"
                        href={`#`}
                        onClick={(e) => { e.preventDefault(); alert("Siguiente: conectar a n8n Start LLM Call"); }}
                    >
                        Llamar (IA)
                    </a>
                </div>
            </div>

            <div className="rounded-xl border overflow-hidden">
                <div className="p-3 font-medium bg-muted/50">Llamadas</div>
                <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                        <tr>
                            <th className="text-left p-3">Modo</th>
                            <th className="text-left p-3">Estado</th>
                            <th className="text-left p-3">Inicio</th>
                            <th className="text-left p-3">Duración</th>
                            <th className="text-right p-3">Detalle</th>
                        </tr>
                    </thead>
                    <tbody>
                        {calls.map((c) => (
                            <tr key={c.id} className="border-t">
                                <td className="p-3">{c.mode}</td>
                                <td className="p-3">{(c.status || "").trim() || "-"}</td>
                                <td className="p-3">{c.started_at ? new Date(c.started_at).toLocaleString() : "-"}</td>
                                <td className="p-3">{c.duration_sec ?? "-"}</td>
                                <td className="p-3 text-right">
                                    <Link className="underline" href={`/calls/${c.id}`}>
                                        Ver
                                    </Link>
                                </td>
                            </tr>
                        ))}
                        {calls.length === 0 && (
                            <tr>
                                <td className="p-6 text-center text-muted-foreground" colSpan={5}>
                                    No hay llamadas para este lead.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
