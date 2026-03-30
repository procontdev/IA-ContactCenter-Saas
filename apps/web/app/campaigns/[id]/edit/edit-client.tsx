"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { sbFetch } from "@/lib/supabaseRest";
import DuplicateCampaignButton from "@/app/campaigns/_components/DuplicateCampaignButton";

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
    created_at: string;
    updated_at: string;

    opening_script: string;
    opening_question: string;

    inbound_enabled: boolean;
    inbound_default_mode: "human" | "llm";
    inbound_llm_text_enabled: boolean;

    llm_model: string | null;
    llm_fallback_to_human: boolean;

    wa_instance: string | null;
    wa_business_phone: string | null;

};

type CampaignProduct = {
    id: string;
    campaign_id: string;

    code: string;
    name: string;

    price_monthly: number;
    currency: string;

    is_active: boolean;

    price_text?: string | null;
    description?: string | null;
    source_url?: string | null;

    updated_at: string;

    // existen en la tabla, pero no son necesarios en UI
    data?: any;
    disclaimers?: any;
};

function prettyJson(v: any) {
    try {
        return JSON.stringify(v ?? {}, null, 2);
    } catch {
        return "{}";
    }
}

function parseJsonOr<T>(text: string, fallback: T): { ok: boolean; value: T; error?: string } {
    const t = (text ?? "").trim();
    if (!t) return { ok: true, value: fallback };
    try {
        return { ok: true, value: JSON.parse(t) as T };
    } catch (e: any) {
        return { ok: false, value: fallback, error: e?.message ?? "JSON inválido" };
    }
}

function numOrNull(v: string): number | null {
    const t = String(v ?? "").trim().replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

async function fetchCampaign(id: string): Promise<Campaign | null> {
    const rows = await sbFetch<Campaign[]>("/rest/v1/campaigns", {
        query: {
            select:
                "id,code,name,description,objective,success_criteria,target_audience,llm_policy,llm_system_prompt," +
                "qualification_fields,allowed_intents,disallowed_topics,closing_reasons,is_active,created_at,updated_at," +
                "opening_script,opening_question,inbound_enabled,inbound_default_mode,inbound_llm_text_enabled,llm_model,llm_fallback_to_human,wa_instance,wa_business_phone",
            id: `eq.${id}`,
            limit: 1,
        },
    });
    return rows?.[0] ?? null;
}

async function fetchCampaignProducts(id: string): Promise<CampaignProduct[]> {
    return sbFetch<CampaignProduct[]>("/rest/v1/campaign_products", {
        query: {
            select: "id,campaign_id,code,name,price_monthly,currency,is_active,price_text,description,source_url,updated_at",
            campaign_id: `eq.${id}`,
            order: "updated_at.desc",
            limit: 500,
        },
    });
}

async function createProduct(payload: Partial<CampaignProduct> & { campaign_id: string; code: string; name: string; price_monthly: number }) {
    // OJO: si omitimos data/disclaimers/source_url, la tabla tiene defaults
    return sbFetch("/rest/v1/campaign_products", {
        method: "POST",
        body: {
            campaign_id: payload.campaign_id,
            code: payload.code,
            name: payload.name,
            price_monthly: payload.price_monthly,
            currency: payload.currency ?? "PEN",
            is_active: payload.is_active ?? true,
            price_text: payload.price_text ?? "",
            description: payload.description ?? "",
            source_url: payload.source_url ?? "",
            // opcional: data/disclaimers si quieres (defaults existen)
            // data: {},
            // disclaimers: [],
        },
    });
}

async function updateProduct(id: string, patch: Partial<CampaignProduct>) {
    return sbFetch("/rest/v1/campaign_products", {
        method: "PATCH",
        query: { id: `eq.${id}` },
        body: {
            ...patch,
            updated_at: new Date().toISOString(),
        },
    });
}

async function deleteProduct(id: string) {
    return sbFetch("/rest/v1/campaign_products", {
        method: "DELETE",
        query: { id: `eq.${id}` },
    });
}

export default function EditCampaignClient({ id }: { id: string }) {
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [campaign, setCampaign] = useState<Campaign | null>(null);
    const [products, setProducts] = useState<CampaignProduct[]>([]);

    // campos campaña
    const [code, setCode] = useState("");
    const [name, setName] = useState("");
    const [isActive, setIsActive] = useState(true);

    const [description, setDescription] = useState("");
    const [objective, setObjective] = useState("");
    const [successCriteria, setSuccessCriteria] = useState("");
    const [targetAudience, setTargetAudience] = useState("");

    const [openingScript, setOpeningScript] = useState("");
    const [openingQuestion, setOpeningQuestion] = useState("");
    // WhatsApp inbound / canales por campaña
    const [inboundEnabled, setInboundEnabled] = useState(true);
    const [inboundDefaultMode, setInboundDefaultMode] = useState<"human" | "llm">("human");
    const [inboundLlmTextEnabled, setInboundLlmTextEnabled] = useState(false);
    const [llmModel, setLlmModel] = useState("");
    const [llmFallbackToHuman, setLlmFallbackToHuman] = useState(true);
    const [waInstance, setWaInstance] = useState("");
    const [waBusinessPhone, setWaBusinessPhone] = useState("");




    const [llmSystemPrompt, setLlmSystemPrompt] = useState("");
    const [llmPolicyText, setLlmPolicyText] = useState("{}");

    const [qualificationFieldsText, setQualificationFieldsText] = useState("[]");
    const [allowedIntentsText, setAllowedIntentsText] = useState("[]");
    const [disallowedTopicsText, setDisallowedTopicsText] = useState("[]");
    const [closingReasonsText, setClosingReasonsText] = useState("[]");

    // crear producto
    const [pCode, setPCode] = useState("");
    const [pName, setPName] = useState("");
    const [pPriceMonthly, setPPriceMonthly] = useState("");
    const [pCurrency, setPCurrency] = useState("PEN");
    const [pPriceText, setPPriceText] = useState("");
    const [pDesc, setPDesc] = useState("");
    const [pSourceUrl, setPSourceUrl] = useState("");
    const [pIsActive, setPIsActive] = useState(true);

    // editar producto inline
    const [editId, setEditId] = useState<string | null>(null);
    const [eCode, setECode] = useState("");
    const [eName, setEName] = useState("");
    const [ePriceMonthly, setEPriceMonthly] = useState("");
    const [eCurrency, setECurrency] = useState("PEN");
    const [ePriceText, setEPriceText] = useState("");
    const [eDesc, setEDesc] = useState("");
    const [eSourceUrl, setESourceUrl] = useState("");
    const [eIsActive, setEIsActive] = useState(true);

    const jsonErrors = useMemo(() => {
        const errs: string[] = [];

        const p1 = parseJsonOr<any>(llmPolicyText, {});
        if (!p1.ok) errs.push(`llm_policy: ${p1.error}`);

        const p2 = parseJsonOr<any[]>(qualificationFieldsText, []);
        if (!p2.ok) errs.push(`qualification_fields: ${p2.error}`);

        const p3 = parseJsonOr<any[]>(allowedIntentsText, []);
        if (!p3.ok) errs.push(`allowed_intents: ${p3.error}`);

        const p4 = parseJsonOr<any[]>(disallowedTopicsText, []);
        if (!p4.ok) errs.push(`disallowed_topics: ${p4.error}`);

        const p5 = parseJsonOr<any[]>(closingReasonsText, []);
        if (!p5.ok) errs.push(`closing_reasons: ${p5.error}`);

        return errs;
    }, [llmPolicyText, qualificationFieldsText, allowedIntentsText, disallowedTopicsText, closingReasonsText]);

    async function reloadAll() {
        setLoading(true);
        setError(null);
        try {
            const [c, ps] = await Promise.all([fetchCampaign(id), fetchCampaignProducts(id)]);

            if (!c) {
                setCampaign(null);
                setProducts([]);
                setError("Campaña no encontrada");
                return;
            }

            setCampaign(c);
            setProducts(ps ?? []);

            setCode(c.code ?? "");
            setName(c.name ?? "");
            setIsActive(!!c.is_active);

            setDescription(c.description ?? "");
            setObjective(c.objective ?? "");
            setSuccessCriteria(c.success_criteria ?? "");
            setTargetAudience(c.target_audience ?? "");

            setOpeningScript(c.opening_script ?? "");
            setOpeningQuestion(c.opening_question ?? "");
            setInboundEnabled(!!c.inbound_enabled);
            setInboundDefaultMode((c.inbound_default_mode as any) || "human");
            setInboundLlmTextEnabled(!!c.inbound_llm_text_enabled);
            setLlmModel(c.llm_model ?? "");
            setLlmFallbackToHuman(!!c.llm_fallback_to_human);
            setWaInstance(c.wa_instance ?? "");
            setWaBusinessPhone(c.wa_business_phone ?? "");

            setLlmSystemPrompt(c.llm_system_prompt ?? "");
            setLlmPolicyText(prettyJson(c.llm_policy ?? {}));

            setQualificationFieldsText(prettyJson(c.qualification_fields ?? []));
            setAllowedIntentsText(prettyJson(c.allowed_intents ?? []));
            setDisallowedTopicsText(prettyJson(c.disallowed_topics ?? []));
            setClosingReasonsText(prettyJson(c.closing_reasons ?? []));
        } catch (e: any) {
            setError(e?.message ?? String(e));
        } finally {
            setLoading(false);
        }
    }

    async function reloadProductsOnly() {
        try {
            const ps = await fetchCampaignProducts(id);
            setProducts(ps ?? []);
        } catch (e: any) {
            setError(e?.message ?? String(e));
        }
    }

    useEffect(() => {
        reloadAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    async function onSaveCampaign() {
        setError(null);

        if (!code.trim() || !name.trim()) {
            setError("Code y Name son obligatorios.");
            return;
        }
        if (jsonErrors.length) {
            setError(`Corrige los JSON antes de guardar:\n- ${jsonErrors.join("\n- ")}`);
            return;
        }

        const llm_policy = parseJsonOr<any>(llmPolicyText, {}).value;
        const qualification_fields = parseJsonOr<any[]>(qualificationFieldsText, []).value;
        const allowed_intents = parseJsonOr<any[]>(allowedIntentsText, []).value;
        const disallowed_topics = parseJsonOr<any[]>(disallowedTopicsText, []).value;
        const closing_reasons = parseJsonOr<any[]>(closingReasonsText, []).value;
        const waPhone = digitsOnly(waBusinessPhone);

        if (waBusinessPhone.trim() && (waPhone.length < 8 || waPhone.length > 15)) {
            setError("wa_business_phone inválido. Debe contener solo dígitos (8 a 15).");
            return;
        }

        if (inboundDefaultMode !== "human" && inboundDefaultMode !== "llm") {
            setError("inbound_default_mode inválido (use human o llm).");
            return;
        }

        setSaving(true);
        try {
            await sbFetch("/rest/v1/campaigns", {
                method: "PATCH",
                query: { id: `eq.${id}` },
                body: {
                    code: code.trim(),
                    name: name.trim(),
                    is_active: isActive,

                    description: description ?? "",
                    objective: objective ?? "",
                    success_criteria: successCriteria ?? "",
                    target_audience: targetAudience ?? "",

                    opening_script: openingScript ?? "",
                    opening_question: openingQuestion ?? "",

                    llm_system_prompt: llmSystemPrompt ?? "",
                    inbound_enabled: inboundEnabled,
                    inbound_default_mode: inboundDefaultMode,
                    inbound_llm_text_enabled: inboundLlmTextEnabled,
                    llm_model: trimOrEmpty(llmModel) || null,
                    llm_fallback_to_human: llmFallbackToHuman,
                    wa_instance: trimOrEmpty(waInstance) || null,
                    wa_business_phone: waPhone || null,

                    llm_policy,

                    qualification_fields,
                    allowed_intents,
                    disallowed_topics,
                    closing_reasons,

                    updated_at: new Date().toISOString(),
                },
            });

            await reloadAll();
        } catch (e: any) {
            setError(e?.message ?? String(e));
        } finally {
            setSaving(false);
        }
    }

    function digitsOnly(v: string) {
        return String(v ?? "").replace(/[^\d]/g, "");
    }

    function trimOrEmpty(v: string) {
        return String(v ?? "").trim();
    }

    async function onCreateProduct() {
        setError(null);

        const c = campaign;
        if (!c) return;

        if (!pCode.trim() || !pName.trim()) {
            setError("Producto: Code y Name son obligatorios.");
            return;
        }
        const price = numOrNull(pPriceMonthly);
        if (price === null) {
            setError("Producto: price_monthly debe ser numérico (ej: 39.90).");
            return;
        }




        setSaving(true);
        try {
            await createProduct({
                campaign_id: c.id,
                code: pCode.trim(),
                name: pName.trim(),
                price_monthly: price,
                currency: (pCurrency || "PEN").trim(),
                is_active: pIsActive,
                price_text: pPriceText ?? "",
                description: pDesc ?? "",
                source_url: pSourceUrl ?? "",
            });

            // limpia inputs
            setPCode("");
            setPName("");
            setPPriceMonthly("");
            setPCurrency("PEN");
            setPPriceText("");
            setPDesc("");
            setPSourceUrl("");
            setPIsActive(true);

            await reloadProductsOnly();
        } catch (e: any) {
            setError(e?.message ?? String(e));
        } finally {
            setSaving(false);
        }
    }

    function beginEdit(p: CampaignProduct) {
        setEditId(p.id);
        setECode(p.code ?? "");
        setEName(p.name ?? "");
        setEPriceMonthly(String(p.price_monthly ?? ""));
        setECurrency(p.currency ?? "PEN");
        setEPriceText(p.price_text ?? "");
        setEDesc(p.description ?? "");
        setESourceUrl(p.source_url ?? "");
        setEIsActive(!!p.is_active);
    }

    function cancelEdit() {
        setEditId(null);
    }

    async function saveEdit() {
        if (!editId) return;

        setError(null);

        if (!eCode.trim() || !eName.trim()) {
            setError("Editar producto: Code y Name son obligatorios.");
            return;
        }

        const price = numOrNull(ePriceMonthly);
        if (price === null) {
            setError("Editar producto: price_monthly debe ser numérico.");
            return;
        }

        setSaving(true);
        try {
            await updateProduct(editId, {
                code: eCode.trim(),
                name: eName.trim(),
                price_monthly: price,
                currency: (eCurrency || "PEN").trim(),
                is_active: eIsActive,
                price_text: ePriceText ?? "",
                description: eDesc ?? "",
                source_url: eSourceUrl ?? "",
            });

            setEditId(null);
            await reloadProductsOnly();
        } catch (e: any) {
            setError(e?.message ?? String(e));
        } finally {
            setSaving(false);
        }
    }

    async function toggleActive(p: CampaignProduct) {
        setError(null);
        setSaving(true);
        try {
            await updateProduct(p.id, { is_active: !p.is_active });
            await reloadProductsOnly();
        } catch (e: any) {
            setError(e?.message ?? String(e));
        } finally {
            setSaving(false);
        }
    }

    async function onDelete(p: CampaignProduct) {
        const ok = confirm(`¿Eliminar producto "${p.name}" (${p.code})?`);
        if (!ok) return;

        setError(null);
        setSaving(true);
        try {
            await deleteProduct(p.id);
            if (editId === p.id) setEditId(null);
            await reloadProductsOnly();
        } catch (e: any) {
            setError(e?.message ?? String(e));
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <div className="p-6 text-sm text-muted-foreground">Cargando campaña…</div>;

    if (!campaign) {
        return (
            <div className="p-6 space-y-3">
                <div className="text-sm text-red-600">No se encontró la campaña.</div>
                <Link href="/campaigns" className="rounded-lg border px-3 py-2 text-sm hover:bg-muted">
                    ← Volver
                </Link>
            </div>
        );
    }

    const activeCount = products.filter((p) => p.is_active).length;

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <div className="text-sm text-muted-foreground">Editar campaña</div>
                    <h1 className="text-2xl font-semibold">
                        {campaign.name} <span className="text-muted-foreground">({campaign.code})</span>
                    </h1>
                    <div className="text-xs text-muted-foreground mt-1">
                        ID: <span className="font-mono">{campaign.id}</span> · Actualizado:{" "}
                        <b>{new Date(campaign.updated_at).toLocaleString("es-PE")}</b>
                    </div>
                </div>

                <div className="flex gap-2 flex-wrap items-center">
                    {/* 👇 usa el id real de campaign (evita edge-cases si `id` viniera raro) */}
                    <div className="text-xs text-red-600"></div>
                    <DuplicateCampaignButton campaignId={campaign.id} />

                    <Link
                        href={`/campaigns/${campaign.id}`}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-muted"
                    >
                        Ver detalle
                    </Link>

                    <Link
                        href="/campaigns"
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-muted"
                    >
                        ← Volver
                    </Link>
                </div>
            </div>


            {error && (
                <div className="rounded-xl border p-4 text-sm text-red-600 whitespace-pre-wrap">{error}</div>
            )}

            {jsonErrors.length > 0 && (
                <div className="rounded-xl border p-4 text-sm text-amber-700 whitespace-pre-wrap">
                    JSON inválido detectado:
                    {"\n"}- {jsonErrors.join("\n- ")}
                </div>
            )}

            {/* --- CAMPaña (igual que antes) --- */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border p-4 space-y-3">
                    <div className="font-medium">Identidad</div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">Code</div>
                            <input className="w-full rounded-md border px-3 py-2 text-sm" value={code} onChange={(e) => setCode(e.target.value)} />
                        </label>

                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">Name</div>
                            <input className="w-full rounded-md border px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
                        </label>
                    </div>

                    <label className="flex items-center gap-2 text-sm pt-1">
                        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                        Activa
                    </label>

                    <div className="font-medium pt-2">Descripción y objetivo</div>

                    <label className="space-y-1">
                        <div className="text-xs text-muted-foreground">Descripción</div>
                        <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[90px]" value={description} onChange={(e) => setDescription(e.target.value)} />
                    </label>

                    <label className="space-y-1">
                        <div className="text-xs text-muted-foreground">Objetivo</div>
                        <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[90px]" value={objective} onChange={(e) => setObjective(e.target.value)} />
                    </label>

                    <label className="space-y-1">
                        <div className="text-xs text-muted-foreground">Criterio de éxito</div>
                        <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[70px]" value={successCriteria} onChange={(e) => setSuccessCriteria(e.target.value)} />
                    </label>

                    <label className="space-y-1">
                        <div className="text-xs text-muted-foreground">Público objetivo</div>
                        <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[70px]" value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} />
                    </label>
                </div>

                <div className="rounded-xl border p-4 space-y-3">
                    <div className="font-medium">Guion (voz) + LLM</div>

                    <label className="space-y-1">
                        <div className="text-xs text-muted-foreground">Opening script</div>
                        <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[90px]" value={openingScript} onChange={(e) => setOpeningScript(e.target.value)} />
                    </label>

                    <label className="space-y-1">
                        <div className="text-xs text-muted-foreground">Opening question</div>
                        <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[70px]" value={openingQuestion} onChange={(e) => setOpeningQuestion(e.target.value)} />
                    </label>

                    <label className="space-y-1">
                        <div className="text-xs text-muted-foreground">LLM system prompt</div>
                        <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[140px]" value={llmSystemPrompt} onChange={(e) => setLlmSystemPrompt(e.target.value)} />
                    </label>

                    <div className="grid grid-cols-1 gap-3">
                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">llm_policy (JSON)</div>
                            <textarea className="w-full rounded-md border px-3 py-2 text-xs font-mono min-h-[120px]" value={llmPolicyText} onChange={(e) => setLlmPolicyText(e.target.value)} />
                        </label>

                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">qualification_fields (JSON array)</div>
                            <textarea className="w-full rounded-md border px-3 py-2 text-xs font-mono min-h-[90px]" value={qualificationFieldsText} onChange={(e) => setQualificationFieldsText(e.target.value)} />
                        </label>

                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">allowed_intents (JSON array)</div>
                            <textarea className="w-full rounded-md border px-3 py-2 text-xs font-mono min-h-[90px]" value={allowedIntentsText} onChange={(e) => setAllowedIntentsText(e.target.value)} />
                        </label>

                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">disallowed_topics (JSON array)</div>
                            <textarea className="w-full rounded-md border px-3 py-2 text-xs font-mono min-h-[90px]" value={disallowedTopicsText} onChange={(e) => setDisallowedTopicsText(e.target.value)} />
                        </label>

                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">closing_reasons (JSON array)</div>
                            <textarea className="w-full rounded-md border px-3 py-2 text-xs font-mono min-h-[90px]" value={closingReasonsText} onChange={(e) => setClosingReasonsText(e.target.value)} />
                        </label>
                    </div>
                </div>
                {/* --- Canales / WhatsApp Inbound --- */}
                <div className="rounded-xl border p-4 space-y-3">
                    <div className="font-medium">Canales · WhatsApp inbound</div>
                    <div className="text-xs text-muted-foreground">
                        Estos valores determinan a qué campaña se enruta el inbound WhatsApp (instance + business phone).
                    </div>

                    <label className="flex items-center gap-2 text-sm pt-1">
                        <input type="checkbox" checked={inboundEnabled} onChange={(e) => setInboundEnabled(e.target.checked)} />
                        Inbound habilitado
                    </label>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">WA instance</div>
                            <input
                                className="w-full rounded-md border px-3 py-2 text-sm"
                                value={waInstance}
                                onChange={(e) => setWaInstance(e.target.value)}
                                placeholder="ej: wa-main"
                            />
                        </label>

                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">WA business phone (solo dígitos)</div>
                            <input
                                className="w-full rounded-md border px-3 py-2 text-sm"
                                value={waBusinessPhone}
                                onChange={(e) => setWaBusinessPhone(e.target.value)}
                                placeholder="ej: 51999999999"
                            />
                        </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">Modo inbound por defecto</div>
                            <select
                                className="w-full rounded-md border px-3 py-2 text-sm"
                                value={inboundDefaultMode}
                                onChange={(e) => setInboundDefaultMode(e.target.value as any)}
                            >
                                <option value="human">human</option>
                                <option value="llm">llm</option>
                            </select>
                        </label>

                        <label className="flex items-center gap-2 text-sm pt-6">
                            <input type="checkbox" checked={inboundLlmTextEnabled} onChange={(e) => setInboundLlmTextEnabled(e.target.checked)} />
                            LLM texto habilitado
                        </label>

                        <label className="flex items-center gap-2 text-sm pt-6">
                            <input type="checkbox" checked={llmFallbackToHuman} onChange={(e) => setLlmFallbackToHuman(e.target.checked)} />
                            Fallback a humano
                        </label>
                    </div>

                    <label className="space-y-1">
                        <div className="text-xs text-muted-foreground">LLM model (opcional)</div>
                        <input
                            className="w-full rounded-md border px-3 py-2 text-sm"
                            value={llmModel}
                            onChange={(e) => setLlmModel(e.target.value)}
                            placeholder="ej: gpt-4o-mini / gpt-5-mini (según tu backend)"
                        />
                    </label>

                    <div className="text-xs text-muted-foreground">
                        Key sugerida: <span className="font-mono">{trimOrEmpty(waInstance) || "?"}</span> ·{" "}
                        <span className="font-mono">{digitsOnly(waBusinessPhone) || "?"}</span>
                    </div>
                </div>

            </div>

            <div className="flex gap-2">
                <button
                    onClick={onSaveCampaign}
                    disabled={saving || jsonErrors.length > 0}
                    className="rounded-lg border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                    {saving ? "Guardando…" : "Guardar campaña"}
                </button>
                <button onClick={() => router.refresh()} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">
                    Refrescar
                </button>
            </div>

            {/* --- CRUD Productos --- */}
            <div className="rounded-xl border p-4 space-y-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <div className="font-medium">Productos</div>
                        <div className="text-xs text-muted-foreground mt-1">
                            Total: <b>{products.length}</b> · Activos: <b>{activeCount}</b>
                        </div>
                    </div>
                    <button
                        onClick={reloadProductsOnly}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-muted"
                        disabled={saving}
                    >
                        Recargar productos
                    </button>
                </div>

                {/* Crear producto */}
                <div className="rounded-lg border p-3 space-y-3">
                    <div className="text-sm font-medium">Agregar producto</div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">Code *</div>
                            <input className="w-full rounded-md border px-3 py-2 text-sm" value={pCode} onChange={(e) => setPCode(e.target.value)} />
                        </label>

                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">Name *</div>
                            <input className="w-full rounded-md border px-3 py-2 text-sm" value={pName} onChange={(e) => setPName(e.target.value)} />
                        </label>

                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">Price monthly *</div>
                            <input
                                className="w-full rounded-md border px-3 py-2 text-sm"
                                value={pPriceMonthly}
                                onChange={(e) => setPPriceMonthly(e.target.value)}
                                placeholder="39.90"
                            />
                        </label>

                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">Currency</div>
                            <input className="w-full rounded-md border px-3 py-2 text-sm" value={pCurrency} onChange={(e) => setPCurrency(e.target.value)} />
                        </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">Price text</div>
                            <input className="w-full rounded-md border px-3 py-2 text-sm" value={pPriceText} onChange={(e) => setPPriceText(e.target.value)} placeholder="S/ 40 al mes" />
                        </label>

                        <label className="space-y-1">
                            <div className="text-xs text-muted-foreground">Source URL</div>
                            <input className="w-full rounded-md border px-3 py-2 text-sm" value={pSourceUrl} onChange={(e) => setPSourceUrl(e.target.value)} placeholder="https://..." />
                        </label>
                    </div>

                    <label className="space-y-1">
                        <div className="text-xs text-muted-foreground">Description</div>
                        <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[70px]" value={pDesc} onChange={(e) => setPDesc(e.target.value)} />
                    </label>

                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={pIsActive} onChange={(e) => setPIsActive(e.target.checked)} />
                        Activo
                    </label>

                    <button
                        onClick={onCreateProduct}
                        disabled={saving}
                        className="rounded-lg border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
                    >
                        {saving ? "Guardando…" : "Agregar"}
                    </button>
                </div>

                {/* Tabla */}
                <div className="overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="text-xs text-muted-foreground">
                            <tr className="border-b">
                                <th className="py-2 text-left">Código</th>
                                <th className="py-2 text-left">Nombre</th>
                                <th className="py-2 text-left">Precio</th>
                                <th className="py-2 text-left">Estado</th>
                                <th className="py-2 text-left">Actualizado</th>
                                <th className="py-2 text-right">Acciones</th>
                            </tr>
                        </thead>

                        <tbody>
                            {products.length === 0 ? (
                                <tr>
                                    <td className="py-4 text-muted-foreground" colSpan={6}>
                                        No hay productos registrados.
                                    </td>
                                </tr>
                            ) : (
                                products.map((p) => {
                                    const isEditing = editId === p.id;

                                    return (
                                        <tr key={p.id} className="border-b last:border-b-0 align-top">
                                            <td className="py-2">
                                                {isEditing ? (
                                                    <input className="w-full rounded-md border px-2 py-1 text-sm" value={eCode} onChange={(e) => setECode(e.target.value)} />
                                                ) : (
                                                    p.code
                                                )}
                                            </td>

                                            <td className="py-2">
                                                {isEditing ? (
                                                    <input className="w-full rounded-md border px-2 py-1 text-sm" value={eName} onChange={(e) => setEName(e.target.value)} />
                                                ) : (
                                                    <div className="space-y-1">
                                                        <div className="font-medium">{p.name}</div>
                                                        {(p.description ?? "").trim() ? (
                                                            <div className="text-xs text-muted-foreground line-clamp-2">{p.description}</div>
                                                        ) : null}
                                                    </div>
                                                )}
                                            </td>

                                            <td className="py-2">
                                                {isEditing ? (
                                                    <div className="space-y-2">
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <input
                                                                className="w-full rounded-md border px-2 py-1 text-sm"
                                                                value={ePriceMonthly}
                                                                onChange={(e) => setEPriceMonthly(e.target.value)}
                                                                placeholder="39.90"
                                                            />
                                                            <input className="w-full rounded-md border px-2 py-1 text-sm" value={eCurrency} onChange={(e) => setECurrency(e.target.value)} />
                                                        </div>
                                                        <input
                                                            className="w-full rounded-md border px-2 py-1 text-sm"
                                                            value={ePriceText}
                                                            onChange={(e) => setEPriceText(e.target.value)}
                                                            placeholder="S/ 40 al mes"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="space-y-1">
                                                        <div>
                                                            {(p.price_text ?? "").trim()
                                                                ? p.price_text
                                                                : `${p.currency} ${Number(p.price_monthly).toFixed(2)}`}
                                                        </div>
                                                        {(p.source_url ?? "").trim() ? (
                                                            <a className="text-xs underline text-muted-foreground" href={p.source_url ?? ""} target="_blank" rel="noreferrer">
                                                                Fuente
                                                            </a>
                                                        ) : null}
                                                    </div>
                                                )}
                                            </td>

                                            <td className="py-2">
                                                {isEditing ? (
                                                    <label className="flex items-center gap-2 text-sm">
                                                        <input type="checkbox" checked={eIsActive} onChange={(e) => setEIsActive(e.target.checked)} />
                                                        Activo
                                                    </label>
                                                ) : (
                                                    <span className={p.is_active ? "" : "text-muted-foreground"}>{p.is_active ? "Activo" : "Inactivo"}</span>
                                                )}
                                            </td>

                                            <td className="py-2">
                                                {p.updated_at ? new Date(p.updated_at).toLocaleString("es-PE") : "-"}
                                            </td>

                                            <td className="py-2 text-right whitespace-nowrap">
                                                {isEditing ? (
                                                    <div className="flex gap-2 justify-end">
                                                        <button
                                                            onClick={saveEdit}
                                                            disabled={saving}
                                                            className="rounded-md border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50"
                                                        >
                                                            Guardar
                                                        </button>
                                                        <button
                                                            onClick={cancelEdit}
                                                            disabled={saving}
                                                            className="rounded-md border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50"
                                                        >
                                                            Cancelar
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex gap-2 justify-end">
                                                        <button
                                                            onClick={() => beginEdit(p)}
                                                            disabled={saving}
                                                            className="rounded-md border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50"
                                                        >
                                                            Editar
                                                        </button>
                                                        <button
                                                            onClick={() => toggleActive(p)}
                                                            disabled={saving}
                                                            className="rounded-md border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50"
                                                        >
                                                            {p.is_active ? "Desactivar" : "Activar"}
                                                        </button>
                                                        <button
                                                            onClick={() => onDelete(p)}
                                                            disabled={saving}
                                                            className="rounded-md border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50"
                                                        >
                                                            Eliminar
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Extra fields cuando editas: descripción + url */}
                {editId ? (
                    <div className="rounded-lg border p-3 space-y-2">
                        <div className="text-sm font-medium">Campos extra (producto en edición)</div>

                        <label className="space-y-1 block">
                            <div className="text-xs text-muted-foreground">Description</div>
                            <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[70px]" value={eDesc} onChange={(e) => setEDesc(e.target.value)} />
                        </label>

                        <label className="space-y-1 block">
                            <div className="text-xs text-muted-foreground">Source URL</div>
                            <input className="w-full rounded-md border px-3 py-2 text-sm" value={eSourceUrl} onChange={(e) => setESourceUrl(e.target.value)} />
                        </label>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
