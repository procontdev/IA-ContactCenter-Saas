// app/campaigns/[id]/edit/page.tsx
import { notFound } from "next/navigation";
import EditCampaignClient from "./edit-client";

export const dynamic = "force-dynamic";

type PageProps = {
    params: Promise<{ id: string }>;
};

export default async function CampaignEditPage({ params }: PageProps) {
    const { id } = await params;
    if (!id) notFound();

    return <EditCampaignClient id={id} />;
}
