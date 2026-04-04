// app/leads/wow/page.tsx
import { Suspense } from "react";
import LeadsWowQueueClient from "./wow-client";
import Link from "next/link";
import { LoadingState } from "@/components/ui/feedback-state";

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

                <div className="flex gap-3 text-sm">
                    <Link className="underline" href="/leads/desk">
                        Abrir Human Desk
                    </Link>
                    <Link className="underline" href="/leads">
                        Volver al listado crudo
                    </Link>
                </div>
            </div>

            <Suspense fallback={<LoadingState label="Cargando cola WOW..." />}>
                <LeadsWowQueueClient />
            </Suspense>
        </div>
    );
}
