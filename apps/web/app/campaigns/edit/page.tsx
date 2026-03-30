// app/campaigns/edit/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import EditCampaignClient from "../[id]/edit/edit-client";

export default function CampaignEditQueryPage() {
    const sp = useSearchParams();
    const id = sp.get("id");

    if (!id) {
        return (
            <div className="p-6">
                <div className="text-lg font-semibold">Editar campaña</div>
                <div className="text-sm text-muted-foreground">Falta el parámetro id.</div>
            </div>
        );
    }

    return <EditCampaignClient id={id} />;
}
