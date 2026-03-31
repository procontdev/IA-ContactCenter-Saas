"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readAccessTokenFromLocalStorage } from "@/lib/tenant/tenant-resolver";
import { useTenant } from "@/lib/tenant/use-tenant";
import type { TenantSettings } from "@/lib/tenant/tenant-types";

type TenantSettingsResponse = {
    item: TenantSettings;
    error?: string;
};

function getAuthHeaders() {
    const token = readAccessTokenFromLocalStorage();
    if (!token) throw new Error("No access token in localStorage");
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
}

function toText(v: unknown) {
    return typeof v === "string" ? v : "";
}

export default function TenantSettingsPage() {
    const { context, loading: tenantLoading } = useTenant();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const [row, setRow] = useState<TenantSettings | null>(null);
    const [name, setName] = useState("");
    const [timezone, setTimezone] = useState("");
    const [locale, setLocale] = useState("");
    const [brandName, setBrandName] = useState("");
    const [brandColor, setBrandColor] = useState("");
    const [brandLogoUrl, setBrandLogoUrl] = useState("");
    const [website, setWebsite] = useState("");
    const [supportEmail, setSupportEmail] = useState("");

    const canManage = useMemo(
        () => context?.role === "tenant_admin" || context?.role === "superadmin",
        [context?.role]
    );

    function hydrateForm(item: TenantSettings) {
        setRow(item);
        setName(item.name || "");
        setTimezone(item.timezone || "");
        setLocale(item.locale || "");

        const branding = (item.branding || {}) as Record<string, unknown>;
        setBrandName(toText(branding.brand_name));
        setBrandColor(toText(branding.primary_color));
        setBrandLogoUrl(toText(branding.logo_url));

        const metadata = (item.metadata || {}) as Record<string, unknown>;
        setWebsite(toText(metadata.website));
        setSupportEmail(toText(metadata.support_email));
    }

    const loadSettings = useCallback(async () => {
        setLoading(true);
        setError("");
        setSuccess("");
        try {
            const res = await fetch("/api/tenant/settings", {
                method: "GET",
                headers: getAuthHeaders(),
                cache: "no-store",
            });

            const data = (await res.json().catch(() => ({}))) as TenantSettingsResponse;
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            if (!data?.item) throw new Error("No tenant settings returned");
            hydrateForm(data.item);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Error loading tenant settings");
            setRow(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (tenantLoading) return;
        void loadSettings();
    }, [tenantLoading, context?.tenantId, loadSettings]);

    async function onSave() {
        if (!canManage) {
            setError("Solo tenant_admin puede actualizar la configuración.");
            return;
        }

        const normalizedName = name.trim();
        if (!normalizedName) {
            setError("El nombre de organización es requerido");
            return;
        }

        setSaving(true);
        setError("");
        setSuccess("");

        try {
            const baseMetadata = ((row?.metadata || {}) as Record<string, unknown>) || {};
            const baseBranding = ((row?.branding || {}) as Record<string, unknown>) || {};

            const metadata: Record<string, unknown> = {
                ...baseMetadata,
                website: website.trim(),
                support_email: supportEmail.trim(),
            };

            const branding: Record<string, unknown> = {
                ...baseBranding,
                brand_name: brandName.trim(),
                primary_color: brandColor.trim(),
                logo_url: brandLogoUrl.trim(),
            };

            const res = await fetch("/api/tenant/settings", {
                method: "PATCH",
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    name: normalizedName,
                    timezone: timezone.trim(),
                    locale: locale.trim(),
                    metadata,
                    branding,
                }),
            });

            const data = (await res.json().catch(() => ({}))) as TenantSettingsResponse;
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            if (!data?.item) throw new Error("No tenant settings returned");

            hydrateForm(data.item);
            setSuccess("Configuración actualizada");
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Error saving tenant settings");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="min-h-screen bg-background">
            <Topbar title="Configuración de organización" onRefresh={() => void loadSettings()} />

            <div className="max-w-3xl p-6 space-y-4">
                {loading ? (
                    <div className="text-sm text-muted-foreground">Cargando configuración...</div>
                ) : (
                    <>
                        <div className="rounded-lg border bg-card p-4 space-y-4">
                            <div className="text-sm font-medium">Tenant activo</div>

                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-1">
                                    <div className="text-xs text-muted-foreground">Nombre visible</div>
                                    <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage || saving} />
                                </div>
                                <div className="space-y-1">
                                    <div className="text-xs text-muted-foreground">Slug (solo lectura en MVP)</div>
                                    <Input value={row?.slug || ""} readOnly disabled />
                                </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-1">
                                    <div className="text-xs text-muted-foreground">Timezone</div>
                                    <Input
                                        value={timezone}
                                        onChange={(e) => setTimezone(e.target.value)}
                                        placeholder="America/Lima"
                                        disabled={!canManage || saving}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <div className="text-xs text-muted-foreground">Locale</div>
                                    <Input
                                        value={locale}
                                        onChange={(e) => setLocale(e.target.value)}
                                        placeholder="es-PE"
                                        disabled={!canManage || saving}
                                    />
                                </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-3">
                                <div className="space-y-1 md:col-span-1">
                                    <div className="text-xs text-muted-foreground">Brand name</div>
                                    <Input
                                        value={brandName}
                                        onChange={(e) => setBrandName(e.target.value)}
                                        placeholder="Event Pro Labs"
                                        disabled={!canManage || saving}
                                    />
                                </div>
                                <div className="space-y-1 md:col-span-1">
                                    <div className="text-xs text-muted-foreground">Color principal</div>
                                    <Input
                                        value={brandColor}
                                        onChange={(e) => setBrandColor(e.target.value)}
                                        placeholder="#0EA5E9"
                                        disabled={!canManage || saving}
                                    />
                                </div>
                                <div className="space-y-1 md:col-span-1">
                                    <div className="text-xs text-muted-foreground">Logo URL</div>
                                    <Input
                                        value={brandLogoUrl}
                                        onChange={(e) => setBrandLogoUrl(e.target.value)}
                                        placeholder="https://..."
                                        disabled={!canManage || saving}
                                    />
                                </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-1">
                                    <div className="text-xs text-muted-foreground">Website</div>
                                    <Input
                                        value={website}
                                        onChange={(e) => setWebsite(e.target.value)}
                                        placeholder="https://eventprolabs.com"
                                        disabled={!canManage || saving}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <div className="text-xs text-muted-foreground">Support email</div>
                                    <Input
                                        value={supportEmail}
                                        onChange={(e) => setSupportEmail(e.target.value)}
                                        placeholder="support@eventprolabs.com"
                                        disabled={!canManage || saving}
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <Button onClick={onSave} disabled={!canManage || saving}>
                                    {saving ? "Guardando..." : "Guardar cambios"}
                                </Button>
                                {!canManage && <span className="text-xs text-muted-foreground">Solo tenant_admin puede editar.</span>}
                            </div>
                        </div>

                        {error && <div className="text-sm text-red-600">{error}</div>}
                        {success && <div className="text-sm text-emerald-600">{success}</div>}
                    </>
                )}
            </div>
        </div>
    );
}

