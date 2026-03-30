// app/campaigns/[id]/edit/page.tsx
import { notFound } from "next/navigation";
import { sbFetchServer } from "@/lib/supabaseRest";
import EditCampaignClient from "./edit-client";

export const dynamicParams = false;

type PageProps = {
    params: Promise<{ id: string }>;
};

async function fetchCampaignIds() {
    return sbFetchServer<{ id: string }[]>("/rest/v1/campaigns", {
        query: {
            select: "id",
            order: "updated_at.desc",
            limit: 500,
        },
    });
}

export async function generateStaticParams() {
    const rows = await fetchCampaignIds();
    return (rows ?? []).map((r) => ({ id: r.id }));
}

export default async function CampaignEditPage({ params }: PageProps) {
    const { id } = await params; // ✅ Next 16: params es Promise
    if (!id) notFound();

    return <EditCampaignClient id={id} />;
}
