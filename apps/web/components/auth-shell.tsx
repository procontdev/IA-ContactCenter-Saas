"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { ErrorState } from "@/components/ui/feedback-state";
import { getValidSession, logout, onAuthSessionChanged, readStoredSession } from "@/lib/auth/supabase-auth";
import { resolveTenantContext } from "@/lib/tenant/tenant-resolver";

type AuthStatus = "checking" | "authenticated" | "unauthenticated" | "tenant-error";

function isPublicPath(pathname: string) {
    const normalized = String(pathname || "").replace(/\/+$/, "") || "/";
    return normalized === "/login";
}

function SpinnerScreen({ label }: { label: string }) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-8 text-slate-500">
            <div className="flex flex-col items-center gap-4">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600"></div>
                <p className="text-sm font-medium">{label}</p>
            </div>
        </div>
    );
}

export function AuthShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const sp = useSearchParams();
    const router = useRouter();

    const [status, setStatus] = useState<AuthStatus>("checking");
    const [tenantError, setTenantError] = useState<string>("");

    const currentPathWithQuery = useMemo(() => {
        const query = sp?.toString() || "";
        return `${pathname}${query ? `?${query}` : ""}`;
    }, [pathname, sp]);

    useEffect(() => {
        if (isPublicPath(pathname)) {
            return;
        }

        let cancelled = false;

        async function runAuthCheck() {
            setStatus("checking");
            setTenantError("");

            const session = await getValidSession();
            if (!session) {
                if (cancelled) return;
                setStatus("unauthenticated");
                const next = encodeURIComponent(currentPathWithQuery || "/dashboard");
                router.replace(`/login?next=${next}`);
                return;
            }

            try {
                await resolveTenantContext(undefined, { accessToken: session.access_token });
            } catch (e) {
                if (cancelled) return;
                setTenantError(e instanceof Error ? e.message : "No se pudo resolver tenant para la sesión actual");
                setStatus("tenant-error");
                return;
            }

            if (cancelled) return;
            setStatus("authenticated");
        }

        void runAuthCheck();

        const off = onAuthSessionChanged(() => {
            void runAuthCheck();
        });

        return () => {
            cancelled = true;
            off();
        };
    }, [pathname, currentPathWithQuery, router]);

    if (isPublicPath(pathname)) {
        return <>{children}</>;
    }

    if (status === "checking" || status === "unauthenticated") {
        return <SpinnerScreen label="Validando sesión..." />;
    }

    if (status === "tenant-error") {
        const tenantErrorSession = readStoredSession();
        return (
            <div className="flex min-h-screen items-center justify-center p-6 bg-slate-50">
                <div className="w-full max-w-lg rounded-xl border bg-white p-6 space-y-4 shadow-sm">
                    <h1 className="text-lg font-semibold">No se pudo resolver tu organización</h1>
                    <p className="text-sm text-muted-foreground">
                        La sesión está activa, pero no hay un tenant primario disponible para este usuario. Contacta a un admin para
                        asignar membresía en <span className="font-mono">platform_core.tenant_users</span>.
                    </p>
                    {tenantError ? (
                        <ErrorState
                            title="No pudimos validar la organización activa"
                            description={tenantError}
                            className="text-xs"
                        />
                    ) : null}
                    <div className="text-xs text-muted-foreground">
                        Usuario de sesión: <span className="font-mono">{tenantErrorSession?.user?.email || "(sin email)"}</span>
                    </div>
                    <div className="flex gap-2">
                        <button
                            className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                            onClick={() => {
                                void logout().then(() => router.replace("/login"));
                            }}
                        >
                            Cerrar sesión
                        </button>
                        <button className="rounded-md border px-3 py-2 text-sm hover:bg-muted" onClick={() => router.refresh()}>
                            Reintentar
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const session = readStoredSession();

    return (
        <div className="flex min-h-screen">
            <AppSidebar userEmail={session?.user?.email || null} />
            <main className="flex-1">{children}</main>
        </div>
    );
}

