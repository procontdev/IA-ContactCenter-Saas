"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { sbFetch } from "@/lib/supabaseRest";

function parseJsonOr<T>(text: string, fallback: T): { ok: boolean; value: T; error?: string } {
    const t = (text ?? "").trim();
    if (!t) return { ok: true, value: fallback };
    try {
        return { ok: true, value: JSON.parse(t) as T };
    } catch (e: any) {
        return { ok: false, value: fallback, error: e?.message ?? "JSON inválido" };
    }
}

function digitsOnly(v: string) {
    return String(v ?? "").replace(/[^\d]/g, "");
}

function trimOrEmpty(v: string) {
    return String(v ?? "").trim();
}

import { useTenant } from "@/lib/tenant/use-tenant";

async function fetchCampaignByCode(code: string, tenantId?: string) {
    const rows = await sbFetch<{ id: string }[]>("/rest/v1/campaigns", {
        tenantId,
        query: { select: "id", code: `eq.${code}`, limit: 1 },
    });
    return rows?.[0]?.id ?? null;
}

export default function NewCampaignPage() {
    const router = useRouter();
    const { context } = useTenant();

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [code, setCode] = useState("");
    const [name, setName] = useState("");
    const [isActive, setIsActive] = useState(true);

    const [description, setDescription] = useState("");
    const [objective, setObjective] = useState("");
    const [successCriteria, setSuccessCriteria] = useState("");
    const [targetAudience, setTargetAudience] = useState("");

    const [openingScript, setOpeningScript] = useState("");
    const [openingQuestion, setOpeningQuestion] = useState("");

    const [llmSystemPrompt, setLlmSystemPrompt] = useState("");

    // WhatsApp inbound / canales por campaña
    const [inboundEnabled, setInboundEnabled] = useState(true);
    const [inboundDefaultMode, setInboundDefaultMode] = useState<"human" | "llm">("human");
    const [inboundLlmTextEnabled, setInboundLlmTextEnabled] = useState(false);
    const [llmModel, setLlmModel] = useState("");
    const [llmFallbackToHuman, setLlmFallbackToHuman] = useState(true);
    const [waInstance, setWaInstance] = useState("");
    const [waBusinessPhone, setWaBusinessPhone] = useState("");

    const [llmPolicyText, setLlmPolicyText] = useState(`{
  "tone": "profesional_cercano",
  "language": "es-PE",
  "no_invent": true,
  "required_next_step": true,
  "no_unverified_prices": true,
  "ask_one_thing_at_a_time": true
}`);

    const [qualificationFieldsText, setQualificationFieldsText] = useState(`[
  "tipo_gestion",
  "presupuesto_max",
  "operador_actual",
  "numero_lineas",
  "dni",
  "telefono",
  "horario_preferido"
]`);

    const [allowedIntentsText, setAllowedIntentsText] = useState(`[
  "info_planes",
  "portabilidad",
  "alta_linea",
  "precios",
  "beneficios"
]`);

    const [disallowedTopicsText, setDisallowedTopicsText] = useState(`[
  "salud",
  "temas_legales",
  "politica",
  "adulto",
  "datos_sensibles_no_necesarios"
]`);

    const [closingReasonsText, setClosingReasonsText] = useState(`[
  "Venta cerrada",
  "Cita agendada",
  "No contesta",
  "Número incorrecto",
  "No califica",
  "No interesado",
  "Seguimiento pendiente"
]`);

    const jsonErrors = useMemo(() => {
        const errs: string[] = [];
        if (!parseJsonOr<any>(llmPolicyText, {}).ok) errs.push("llm_policy inválido");
        if (!parseJsonOr<any[]>(qualificationFieldsText, []).ok) errs.push("qualification_fields inválido");
        if (!parseJsonOr<any[]>(allowedIntentsText, []).ok) errs.push("allowed_intents inválido");
        if (!parseJsonOr<any[]>(disallowedTopicsText, []).ok) errs.push("disallowed_topics inválido");
        if (!parseJsonOr<any[]>(closingReasonsText, []).ok) errs.push("closing_reasons inválido");
        return errs;
    }, [llmPolicyText, qualificationFieldsText, allowedIntentsText, disallowedTopicsText, closingReasonsText]);

    async function onCreate() {
        setError(null);

        if (!context?.tenantId) {
            setError("No se pudo determinar el contexto del tenant.");
            return;
        }

        if (!code.trim() || !name.trim()) {
            setError("Code y Name son obligatorios.");
            return;
        }
        if (jsonErrors.length) {
            setError(`Corrige JSON: ${jsonErrors.join(", ")}`);
            return;
        }

        // Validación WA
        const waPhone = digitsOnly(waBusinessPhone);
        if (waBusinessPhone.trim() && (waPhone.length < 8 || waPhone.length > 15)) {
            setError("wa_business_phone inválido. Debe contener solo dígitos (8 a 15).");
            return;
        }
        if (inboundDefaultMode !== "human" && inboundDefaultMode !== "llm") {
            setError("inbound_default_mode inválido (use human o llm).");
            return;
        }

        const llm_policy = parseJsonOr<any>(llmPolicyText, {}).value;
        const qualification_fields = parseJsonOr<any[]>(qualificationFieldsText, []).value;
        const allowed_intents = parseJsonOr<any[]>(allowedIntentsText, []).value;
        const disallowed_topics = parseJsonOr<any[]>(disallowedTopicsText, []).value;
        const closing_reasons = parseJsonOr<any[]>(closingReasonsText, []).value;

        setSaving(true);
        try {
            await sbFetch("/rest/v1/campaigns", {
                method: "POST",
                tenantId: context.tenantId, // 👈 Inyección automática de tenant_id en el body
                body: {
                    code: code.trim(),
                    name: name.trim(),
                    is_active: isActive,

                    description: description ?? "",
                    objective: objective ?? "",
                    success_criteria: successCriteria ?? "",
                    target_audience: targetAudience ?? "",

                    llm_policy,
                    llm_system_prompt: llmSystemPrompt ?? "",

                    qualification_fields,
                    allowed_intents,
                    disallowed_topics,
                    closing_reasons,

                    opening_script: openingScript ?? "",
                    opening_question: openingQuestion ?? "",

                    // Canales / WhatsApp inbound
                    inbound_enabled: inboundEnabled,
                    inbound_default_mode: inboundDefaultMode,
                    inbound_llm_text_enabled: inboundLlmTextEnabled,
                    llm_model: trimOrEmpty(llmModel) || null,
                    llm_fallback_to_human: llmFallbackToHuman,
                    wa_instance: trimOrEmpty(waInstance) || null,
                    wa_business_phone: waPhone || null,
                },
            });

            const id = await fetchCampaignByCode(code.trim(), context.tenantId);
            if (!id) {
                router.push("/campaigns");
                return;
            }
            router.push(`/campaigns/${id}`);
        } catch (e: any) {
            setError(e?.message ?? String(e));
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <div className="text-sm text-muted-foreground">Nueva campaña</div>
                    <h1 className="text-2xl font-semibold">Crear campaña</h1>
                </div>
                <Link href="/campaigns" className="rounded-lg border px-3 py-2 text-sm hover:bg-muted">
                    ← Volver
                </Link>
            </div>

            {error && (
                <div className="rounded-xl border p-4 text-sm text-red-600 whitespace-pre-wrap">
                    {error}
                </div>
            )}

            {jsonErrors.length > 0 && (
                <div className="rounded-xl border p-4 text-sm text-amber-700">
                    JSON inválido: {jsonErrors.join(", ")}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border p-4 space-y-3">
                    <div className="font-medium">Identidad</div>

                    <label className="space-y-1">
                        <div className="text-xs text-muted-foreground">Code (único)</div>
                        <input className="w-full rounded-md border px-3 py-2 text-sm" value={code} onChange={(e) => setCode(e.target.value)} />
                    </label>

                    <label className="space-y-1">
                        <div className="text-xs text-muted-foreground">Name</div>
                        <input className="w-full rounded-md border px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
                    </label>

                    <label className="flex items-center gap-2 text-sm pt-1">
                        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                        Activa
                    </label>

                    <div className="font-medium pt-2">Descripción</div>

                    <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[90px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción…" />
                    <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[90px]" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Objetivo…" />
                    <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[70px]" value={successCriteria} onChange={(e) => setSuccessCriteria(e.target.value)} placeholder="Criterio de éxito…" />
                    <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[70px]" value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} placeholder="Público objetivo…" />

                    {/* --- Canales / WhatsApp Inbound --- */}
                    <div className="rounded-xl border p-4 space-y-3 mt-2">
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

                <div className="rounded-xl border p-4 space-y-3">
                    <div className="font-medium">Apertura + LLM</div>

                    <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[90px]" value={openingScript} onChange={(e) => setOpeningScript(e.target.value)} placeholder="Opening script…" />
                    <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[70px]" value={openingQuestion} onChange={(e) => setOpeningQuestion(e.target.value)} placeholder="Opening question…" />

                    <textarea className="w-full rounded-md border px-3 py-2 text-sm min-h-[140px]" value={llmSystemPrompt} onChange={(e) => setLlmSystemPrompt(e.target.value)} placeholder="LLM system prompt…" />

                    <div className="text-xs text-muted-foreground">llm_policy (JSON)</div>
                    <textarea className="w-full rounded-md border px-3 py-2 text-xs font-mono min-h-[120px]" value={llmPolicyText} onChange={(e) => setLlmPolicyText(e.target.value)} />

                    <div className="text-xs text-muted-foreground">qualification_fields (JSON array)</div>
                    <textarea className="w-full rounded-md border px-3 py-2 text-xs font-mono min-h-[90px]" value={qualificationFieldsText} onChange={(e) => setQualificationFieldsText(e.target.value)} />

                    <div className="text-xs text-muted-foreground">allowed_intents (JSON array)</div>
                    <textarea className="w-full rounded-md border px-3 py-2 text-xs font-mono min-h-[90px]" value={allowedIntentsText} onChange={(e) => setAllowedIntentsText(e.target.value)} />

                    <div className="text-xs text-muted-foreground">disallowed_topics (JSON array)</div>
                    <textarea className="w-full rounded-md border px-3 py-2 text-xs font-mono min-h-[90px]" value={disallowedTopicsText} onChange={(e) => setDisallowedTopicsText(e.target.value)} />

                    <div className="text-xs text-muted-foreground">closing_reasons (JSON array)</div>
                    <textarea className="w-full rounded-md border px-3 py-2 text-xs font-mono min-h-[90px]" value={closingReasonsText} onChange={(e) => setClosingReasonsText(e.target.value)} />
                </div>
            </div>

            <button
                onClick={onCreate}
                disabled={saving || jsonErrors.length > 0}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
                {saving ? "Creando…" : "Crear campaña"}
            </button>
        </div>
    );
}
