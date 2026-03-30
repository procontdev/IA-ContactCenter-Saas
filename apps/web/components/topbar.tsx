"use client";

import { Button } from "@/components/ui/button";

export function Topbar({
    title,
    updatedAt,
    onRefresh,
}: {
    title: string;
    updatedAt?: string; // ISO
    onRefresh?: () => void;
}) {
    const label = (() => {
        if (!updatedAt) return "";
        const d = new Date(updatedAt);
        if (Number.isNaN(d.getTime())) return "";

        const diffMs = Date.now() - d.getTime();
        const mins = Math.floor(diffMs / 60000);

        if (mins <= 0) return "Actualizado recién";
        if (mins === 1) return "Actualizado hace 1 min";
        if (mins < 60) return `Actualizado hace ${mins} min`;

        const hrs = Math.floor(mins / 60);
        return hrs === 1 ? "Actualizado hace 1 hora" : `Actualizado hace ${hrs} horas`;
    })();

    return (
        <div className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
            <div className="flex items-center justify-between px-6 py-4">
                <div>
                    <h1 className="text-xl font-semibold">{title}</h1>
                    {label && <div className="text-xs text-muted-foreground">{label}</div>}
                </div>

                {onRefresh && (
                    <Button variant="outline" onClick={onRefresh}>
                        Refrescar
                    </Button>
                )}
            </div>
        </div>
    );
}
