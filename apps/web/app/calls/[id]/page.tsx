import { redirect } from "next/navigation";

export default async function CallLegacyDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const safeId = encodeURIComponent(String(id || "").trim());
    redirect(`/call?id=${safeId}`);
}
