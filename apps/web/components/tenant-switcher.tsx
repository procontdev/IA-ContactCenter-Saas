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
import type { TenantMember, TenantMembership, UserRole } from "@/lib/tenant/tenant-types";

const TENANT_CONTEXT_EVENT = "tenant-context-changed";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

type MembershipsResponse = {
    items: TenantMembership[];
};

type MembersResponse = {
    items: TenantMember[];
};

const MEMBER_ROLES: UserRole[] = ["tenant_admin", "supervisor", "agent"];

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
    const [members, setMembers] = useState<TenantMember[]>([]);
    const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});
    const [loading, setLoading] = useState(true);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [error, setError] = useState<string>("");
    const [open, setOpen] = useState(false);
    const [membersOpen, setMembersOpen] = useState(false);
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [memberEmail, setMemberEmail] = useState("");
    const [memberRole, setMemberRole] = useState<UserRole>("agent");
    const [submitting, setSubmitting] = useState(false);
    const [submittingMember, setSubmittingMember] = useState(false);

    const active = useMemo(() => memberships.find((m) => m.is_primary) || memberships[0] || null, [memberships]);
    const canManageMembers = active?.role === "tenant_admin" || active?.role === "superadmin";
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

    async function loadMembers() {
        setLoadingMembers(true);
        setError("");
        try {
            const res = await fetch("/api/tenant/members", {
                method: "GET",
                headers: getAuthHeaders(),
                cache: "no-store",
            });

            const data = (await res.json().catch(() => ({}))) as MembersResponse & { error?: string };
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

            const rows = Array.isArray(data.items) ? data.items : [];
            setMembers(rows);
            setRoleDrafts(
                rows.reduce(
                    (acc, row) => {
                        acc[row.user_id] = row.role;
                        return acc;
                    },
                    {} as Record<string, UserRole>
                )
            );
        } catch (e: unknown) {
            setMembers([]);
            setRoleDrafts({});
            setError(errorMessage(e, "Error loading members"));
        } finally {
            setLoadingMembers(false);
        }
    }

    useEffect(() => {
        void loadMemberships();
    }, []);

    useEffect(() => {
        if (!active?.tenant_id) {
            setMembers([]);
            setRoleDrafts({});
            return;
        }

        void loadMembers();
    }, [active?.tenant_id]);

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

    async function handleAddMember() {
        const email = memberEmail.trim().toLowerCase();
        if (!email) {
            setError("Email requerido");
            return;
        }

        setSubmittingMember(true);
        setError("");
        try {
            const res = await fetch("/api/tenant/members", {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify({ email, role: memberRole }),
            });

            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

            setMemberEmail("");
            await loadMembers();
        } catch (e: unknown) {
            setError(errorMessage(e, "Error adding member"));
        } finally {
            setSubmittingMember(false);
        }
    }

    async function handleUpdateMemberRole(userId: string) {
        const role = roleDrafts[userId] || "agent";
        setSubmittingMember(true);
        setError("");
        try {
            const res = await fetch(`/api/tenant/members/${userId}`, {
                method: "PATCH",
                headers: getAuthHeaders(),
                body: JSON.stringify({ role }),
            });

            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

            await loadMembers();
        } catch (e: unknown) {
            setError(errorMessage(e, "Error updating member role"));
        } finally {
            setSubmittingMember(false);
        }
    }

    async function handleRemoveMember(userId: string) {
        setSubmittingMember(true);
        setError("");
        try {
            const res = await fetch(`/api/tenant/members/${userId}`, {
                method: "DELETE",
                headers: getAuthHeaders(),
            });

            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

            await loadMembers();
        } catch (e: unknown) {
            setError(errorMessage(e, "Error removing member"));
        } finally {
            setSubmittingMember(false);
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

                    <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="w-full h-8 text-xs" disabled={!canManageMembers}>
                                Gestionar miembros
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                            <DialogHeader>
                                <DialogTitle>Miembros del tenant activo</DialogTitle>
                                <DialogDescription>
                                    Solo <span className="font-medium">tenant_admin</span> puede agregar, editar rol y remover.
                                </DialogDescription>
                            </DialogHeader>

                            <div className="space-y-3">
                                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-center">
                                    <Input
                                        className="sm:col-span-3"
                                        value={memberEmail}
                                        onChange={(e) => setMemberEmail(e.target.value)}
                                        placeholder="usuario@empresa.com"
                                        disabled={!canManageMembers || submittingMember}
                                    />
                                    <Select
                                        value={memberRole}
                                        onValueChange={(v) => setMemberRole(v as UserRole)}
                                        disabled={!canManageMembers || submittingMember}
                                    >
                                        <SelectTrigger className="sm:col-span-1">
                                            <SelectValue placeholder="Rol" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {MEMBER_ROLES.map((role) => (
                                                <SelectItem key={role} value={role}>
                                                    {role}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Button
                                        className="sm:col-span-1"
                                        onClick={handleAddMember}
                                        disabled={!canManageMembers || submittingMember}
                                    >
                                        Agregar
                                    </Button>
                                </div>

                                <div className="border rounded-md divide-y max-h-72 overflow-auto">
                                    {loadingMembers ? (
                                        <div className="p-3 text-xs text-muted-foreground">Cargando miembros…</div>
                                    ) : members.length === 0 ? (
                                        <div className="p-3 text-xs text-muted-foreground">Sin miembros en este tenant.</div>
                                    ) : (
                                        members.map((member) => (
                                            <div key={member.user_id} className="p-3 space-y-2">
                                                <div className="text-xs text-muted-foreground">{member.email || member.user_id}</div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Select
                                                        value={roleDrafts[member.user_id] || member.role}
                                                        onValueChange={(v) =>
                                                            setRoleDrafts((prev) => ({ ...prev, [member.user_id]: v as UserRole }))
                                                        }
                                                        disabled={!canManageMembers || submittingMember}
                                                    >
                                                        <SelectTrigger className="h-8 w-[180px] text-xs">
                                                            <SelectValue placeholder="Rol" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {MEMBER_ROLES.map((role) => (
                                                                <SelectItem key={role} value={role}>
                                                                    {role}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>

                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-8 text-xs"
                                                        onClick={() => handleUpdateMemberRole(member.user_id)}
                                                        disabled={!canManageMembers || submittingMember}
                                                    >
                                                        Guardar rol
                                                    </Button>

                                                    <Button
                                                        size="sm"
                                                        variant="destructive"
                                                        className="h-8 text-xs"
                                                        onClick={() => handleRemoveMember(member.user_id)}
                                                        disabled={!canManageMembers || submittingMember}
                                                    >
                                                        Remover
                                                    </Button>

                                                    {member.is_primary && (
                                                        <span className="text-[11px] text-muted-foreground">tenant activo del usuario</span>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>

                    {error && <div className="text-[11px] text-red-600">{error}</div>}
                </>
            )}
        </div>
    );
}

