"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readAccessTokenFromLocalStorage } from "@/lib/tenant/tenant-resolver";
import type { TenantMembership } from "@/lib/tenant/tenant-types";

const TENANT_CONTEXT_EVENT = "tenant-context-changed";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

type MembershipsResponse = {
    items: TenantMembership[];
};

function errorMessage(e: unknown, fallback: string) {
    if (e instanceof Error && e.message) return e.message;
    return fallback;
}

function getAuthHeaders() {
    const token = readAccessTokenFromLocalStorage();
    if (!token) throw new Error("No access token in localStorage");
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
}

export function TenantSwitcher() {
    const router = useRouter();
    const [memberships, setMemberships] = useState<TenantMembership[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>("");
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const active = useMemo(() => memberships.find((m) => m.is_primary) || memberships[0] || null, [memberships]);
    const showSelector = memberships.length > 1;

    async function loadMemberships() {
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/tenant/memberships", {
                method: "GET",
                headers: getAuthHeaders(),
                cache: "no-store",
            });

            const data = (await res.json().catch(() => ({}))) as MembershipsResponse & { error?: string };
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            setMemberships(Array.isArray(data.items) ? data.items : []);
        } catch (e: unknown) {
            setError(errorMessage(e, "Error loading memberships"));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadMemberships();
    }, []);

    async function handleSwitch(tenantId: string) {
        if (!tenantId) return;
        setError("");

        try {
            const res = await fetch("/api/tenant/switch", {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify({ tenant_id: tenantId }),
            });

            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

            await loadMemberships();
            window.dispatchEvent(new Event(TENANT_CONTEXT_EVENT));
            router.refresh();
        } catch (e: unknown) {
            setError(errorMessage(e, "Error switching tenant"));
        }
    }

    async function handleCreate() {
        const normalizedSlug = slug.trim().toLowerCase();
        if (!name.trim()) {
            setError("Nombre requerido");
            return;
        }
        if (!SLUG_RE.test(normalizedSlug)) {
            setError("Slug inválido: usa minúsculas, números y guiones (3-64)");
            return;
        }

        setSubmitting(true);
        setError("");

        try {
            const res = await fetch("/api/tenant/create", {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify({ name: name.trim(), slug: normalizedSlug }),
            });

            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

            setOpen(false);
            setName("");
            setSlug("");
            await loadMemberships();
            window.dispatchEvent(new Event(TENANT_CONTEXT_EVENT));
            router.refresh();
        } catch (e: unknown) {
            setError(errorMessage(e, "Error creating tenant"));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="px-3 py-3 space-y-2 border-b">
            <div className="text-xs font-medium text-muted-foreground">Organización</div>

            {loading ? (
                <div className="text-xs text-muted-foreground">Cargando tenants…</div>
            ) : (
                <>
                    {showSelector ? (
                        <Select value={active?.tenant_id} onValueChange={handleSwitch}>
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Selecciona tenant" />
                            </SelectTrigger>
                            <SelectContent>
                                {memberships.map((m) => (
                                    <SelectItem key={m.tenant_id} value={m.tenant_id}>
                                        {m.name} ({m.role})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <div className="text-xs text-foreground/90">{active?.name || "Sin tenant activo"}</div>
                    )}

                    <Dialog open={open} onOpenChange={setOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="w-full h-8 text-xs">
                                Crear organización
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Crear organización</DialogTitle>
                                <DialogDescription>Define nombre y slug del nuevo tenant.</DialogDescription>
                            </DialogHeader>

                            <div className="space-y-3">
                                <div className="space-y-1">
                                    <div className="text-xs text-muted-foreground">Nombre</div>
                                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi organización" />
                                </div>
                                <div className="space-y-1">
                                    <div className="text-xs text-muted-foreground">Slug</div>
                                    <Input
                                        value={slug}
                                        onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                                        placeholder="mi-organizacion"
                                    />
                                </div>
                            </div>

                            <DialogFooter>
                                <Button onClick={handleCreate} disabled={submitting}>
                                    {submitting ? "Creando..." : "Crear"}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {error && <div className="text-[11px] text-red-600">{error}</div>}
                </>
            )}
        </div>
    );
}

