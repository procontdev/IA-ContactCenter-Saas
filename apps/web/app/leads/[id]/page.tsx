import { redirect } from "next/navigation";

export default async function LeadsLegacyDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const safeId = encodeURIComponent(String(id || "").trim());
    redirect(`/leads/view?id=${safeId}`);
}
