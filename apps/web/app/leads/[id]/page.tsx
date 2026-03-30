// app/leads/page.tsx
import Link from "next/link";
import { sbFetch } from "@/lib/supabaseRest";

type Lead = {
    id: string;
    phone: string | null;
    campaign: string | null;
    estado_cliente: string | null;
    created_at: string;
};

export default async function LeadsPage() {
    // 50 primeros para demo (luego agregamos filtros)
    const leads = await sbFetch<Lead[]>("/rest/v1/leads", {
        query: {
            select: "id,phone,campaign,estado_cliente,created_at",
            order: "created_at.desc",
            limit: 50,
        },
    });

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Leads</h1>
                    <p className="text-sm text-muted-foreground">
                        Últimos 50 leads importados (demo_callcenter)
                    </p>
                </div>
            </div>

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
                        {leads.map((l) => (
                            <tr key={l.id} className="border-t">
                                <td className="p-3">{l.phone ?? "-"}</td>
                                <td className="p-3">{l.campaign ?? "-"}</td>
                                <td className="p-3">{l.estado_cliente ?? "-"}</td>
                                <td className="p-3">{new Date(l.created_at).toLocaleString()}</td>
                                <td className="p-3 text-right">
                                    <Link
                                        className="underline"
                                        href={`/leads/${l.id}`}
                                    >
                                        Ver
                                    </Link>
                                </td>
                            </tr>
                        ))}
                        {leads.length === 0 && (
                            <tr>
                                <td className="p-6 text-center text-muted-foreground" colSpan={5}>
                                    No hay leads.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
