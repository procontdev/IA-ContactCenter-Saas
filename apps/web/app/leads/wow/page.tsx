// app/leads/wow/page.tsx
import { Suspense } from "react";
import LeadsWowQueueClient from "./wow-client";
import Link from "next/link";

export default function LeadsWowPage() {
    return (
        <div className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">🔥 Cola priorizada de Leads</h1>
                    <p className="text-sm text-muted-foreground">
                        Score explicable + Temperatura + SLA + Next Best Action.
                    </p>
                </div>

                <Link className="text-sm underline" href="/leads">
                    Volver al listado crudo
                </Link>
            </div>

            <Suspense fallback={<div className="text-sm text-muted-foreground">Cargando cola...</div>}>
                <LeadsWowQueueClient />
            </Suspense>
        </div>
    );
}
