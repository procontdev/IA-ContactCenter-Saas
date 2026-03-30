import { Suspense } from "react";
import MembresiasClient from "./MembresiasClient";

function MembresiasFallback() {
    return (
        <div className="p-6 space-y-4">
            <div className="h-10 w-60 rounded-md border bg-card animate-pulse" />
            <div className="rounded-lg border bg-card p-4 space-y-3">
                <div className="h-6 w-40 rounded bg-muted/60 animate-pulse" />
                <div className="grid gap-3 md:grid-cols-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-10 rounded bg-muted/60 animate-pulse" />
                    ))}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                    <div className="h-10 rounded bg-muted/60 animate-pulse" />
                    <div className="h-10 rounded bg-muted/60 animate-pulse" />
                </div>
            </div>

            <div className="rounded-lg border bg-card">
                <div className="p-4 border-b">
                    <div className="h-6 w-48 rounded bg-muted/60 animate-pulse" />
                </div>
                <div className="p-4 space-y-3">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="h-10 rounded bg-muted/60 animate-pulse" />
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function MembresiasPage() {
    return (
        <Suspense fallback={<MembresiasFallback />}>
            <MembresiasClient />
        </Suspense>
    );
}
