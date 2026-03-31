"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sbFetch } from "@/lib/supabaseRest";
import { useTenant } from "@/lib/tenant/use-tenant";

type Campaign = {
    id: string;
    code: string;
    name: string;
    description: string;
    objective: string;
    success_criteria: string;
    target_audience: string;
    llm_policy: any;
    llm_system_prompt: string;
    qualification_fields: any;
    allowed_intents: any;
    disallowed_topics: any;
    closing_reasons: any;
    is_active: boolean;
    opening_script: string;
    opening_question: string;
};

type CampaignProduct = {
    id: string;
    campaign_id: string;
    code: string;
    name: string;
    price_monthly: number;
    currency: string;
    data: any;
    disclaimers: any;
    source_url: string;
    is_active: boolean;
    price_text?: string | null;
    description?: string | null;
};

async function fetchCampaign(campaignId: string, tenantId?: string): Promise<Campaign> {
    const rows = await sbFetch<Campaign[]>("/rest/v1/campaigns", {
        tenantId,
        query: {
            select:
                "id,code,name,description,objective,success_criteria,target_audience,llm_policy,llm_system_prompt,qualification_fields,allowed_intents,disallowed_topics,closing_reasons,is_active,opening_script,opening_question",
            id: `eq.${campaignId}`,
            limit: 1,
        },
    });
    if (!rows?.[0]) throw new Error("No se encontró la campaña a duplicar.");
    return rows[0];
}

async function fetchProducts(campaignId: string, tenantId?: string): Promise<CampaignProduct[]> {
    return sbFetch<CampaignProduct[]>("/rest/v1/campaign_products", {
        tenantId,
        query: {
            select:
                "id,campaign_id,code,name,price_monthly,currency,data,disclaimers,source_url,is_active,price_text,description",
            campaign_id: `eq.${campaignId}`,
            order: "updated_at.desc",
            limit: 200,
        },
    });
}

async function fetchCampaignIdByCode(code: string, tenantId?: string): Promise<string> {
    const rows = await sbFetch<{ id: string }[]>("/rest/v1/campaigns", {
        tenantId,
        query: { select: "id", code: `eq.${code}`, limit: 1 },
    });
    const id = rows?.[0]?.id;
    if (!id) throw new Error("No pude recuperar el ID de la campaña duplicada.");
    return id;
}

function safeSlug(s: string) {
    return (s || "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9-_]/g, "")
        .slice(0, 60);
}

export default function DuplicateCampaignButton({
    campaignId,
    className,
}: {
    campaignId: string;
    className?: string;
}) {
    const router = useRouter();
    const { context, loading: tenantLoading } = useTenant();
    const tenantId = context?.tenantId || undefined;
    const [busy, setBusy] = useState(false);

    async function onDuplicate() {
        if (!campaignId || tenantLoading || !tenantId) return;

        const ok = confirm("¿Duplicar esta campaña (incluye productos)?");
        if (!ok) return;

        setBusy(true);
        try {
            const [campaign, products] = await Promise.all([
                fetchCampaign(campaignId, tenantId),
                fetchProducts(campaignId, tenantId),
            ]);

            const stamp = new Date()
                .toISOString()
                .replace(/[-:]/g, "")
                .slice(0, 13); // YYYYMMDDTHH
            const defaultCode = safeSlug(`${campaign.code}-copy-${stamp}`);
            const defaultName = `${campaign.name} (copia)`;

            const newCode = prompt("Nuevo CODE (debe ser único):", defaultCode)?.trim();
            if (!newCode) return;

            const newName = prompt("Nuevo NAME:", defaultName)?.trim() || defaultName;

            // 1) Crear campaña nueva
            await sbFetch<any>("/rest/v1/campaigns", {
                method: "POST",
                tenantId,
                body: {
                    code: newCode,
                    name: newName,
                    description: campaign.description ?? "",
                    objective: campaign.objective ?? "",
                    success_criteria: campaign.success_criteria ?? "",
                    target_audience: campaign.target_audience ?? "",
                    llm_policy: campaign.llm_policy ?? {},
                    llm_system_prompt: campaign.llm_system_prompt ?? "",
                    qualification_fields: campaign.qualification_fields ?? [],
                    allowed_intents: campaign.allowed_intents ?? [],
                    disallowed_topics: campaign.disallowed_topics ?? [],
                    closing_reasons: campaign.closing_reasons ?? [],
                    is_active: campaign.is_active ?? true,
                    opening_script: campaign.opening_script ?? "",
                    opening_question: campaign.opening_question ?? "",
                },
            });

            // 2) Recuperar id nuevo por code
            const newId = await fetchCampaignIdByCode(newCode, tenantId);

            // 3) Duplicar productos
            if (products?.length) {
                const newProducts = products.map((p) => ({
                    campaign_id: newId,
                    code: p.code,
                    name: p.name,
                    price_monthly: p.price_monthly,
                    currency: p.currency,
                    data: p.data ?? {},
                    disclaimers: p.disclaimers ?? [],
                    source_url: p.source_url ?? "",
                    is_active: p.is_active ?? true,
                    price_text: p.price_text ?? "",
                    description: p.description ?? "",
                }));

                await sbFetch<any>("/rest/v1/campaign_products", {
                    method: "POST",
                    tenantId,
                    body: newProducts,
                });
            }

            alert("Campaña duplicada ✅");
            router.push(`/campaigns/edit?id=${newId}`);

        } catch (e: any) {
            alert(e?.message ?? String(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <button
            type="button"
            onClick={onDuplicate}
            disabled={busy || tenantLoading || !tenantId}
            className={
                className ??
                "rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            }
            title="Duplicar campaña (incluye productos)"
        >
            {busy ? "Duplicando..." : "Duplicar"}
        </button>
    );
}
