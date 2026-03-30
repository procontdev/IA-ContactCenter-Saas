import { Suspense } from "react";
import DashboardClient from "./DashboardClient";

function DashboardFallback() {
  return (
    <div className="p-6 space-y-6">
      {/* Topbar placeholder */}
      <div className="h-12 rounded-lg border bg-card animate-pulse" />

      {/* Controls placeholder */}
      <div className="h-12 rounded-lg border bg-card animate-pulse" />

      {/* Cards placeholder */}
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg border bg-card animate-pulse" />
        ))}
      </div>

      {/* Action cards placeholder */}
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg border bg-card animate-pulse" />
        ))}
      </div>

      {/* Charts placeholder */}
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-96 rounded-lg border bg-card animate-pulse" />
        ))}
      </div>

      {/* Conversion placeholder */}
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg border bg-card animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardFallback />}>
      <DashboardClient />
    </Suspense>
  );
}
