import { Suspense } from "react";
import LeadsClient from "./LeadsClient";

function LeadsFallback() {
    return (
        <div className="p-6 space-y-4">
            <div className="h-10 w-56 rounded-md border bg-card animate-pulse" />
            <div className="h-12 rounded-lg border bg-card animate-pulse" />
            <div className="h-[520px] rounded-lg border bg-card animate-pulse" />
        </div>
    );
}

export default function LeadsPage() {
    return (
        <Suspense fallback={<LeadsFallback />}>
            <LeadsClient />
        </Suspense>
    );
}
