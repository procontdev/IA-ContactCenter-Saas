"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getValidSession, signInWithPassword } from "@/lib/auth/supabase-auth";
import { ErrorState, LoadingState } from "@/components/ui/feedback-state";

function sanitizeNext(nextPath: string | null) {
    const raw = String(nextPath || "").trim();
    if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
    if (raw.startsWith("/login")) return "/dashboard";
    return raw;
}

function toFriendlyLoginError(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    const normalized = String(message || "").toLowerCase();

    if (
        normalized.includes("invalid login") ||
        normalized.includes("invalid credentials") ||
        normalized.includes("invalid_grant")
    ) {
        return "No pudimos validar tus credenciales. Revisa email y contraseña e inténtalo nuevamente.";
    }

    if (normalized.includes("network") || normalized.includes("fetch")) {
        return "No pudimos conectar con el servicio de autenticación. Revisa tu conexión e inténtalo otra vez.";
    }

    return "No se pudo iniciar sesión en este momento. Vuelve a intentarlo en unos segundos.";
}

export default function LoginPage() {
    const router = useRouter();
    const sp = useSearchParams();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(true);
    const [error, setError] = useState<string>("");

    const nextPath = sanitizeNext(sp.get("next"));

    useEffect(() => {
        let cancelled = false;

        (async () => {
            const existing = await getValidSession();
            if (cancelled) return;

            if (existing) {
                router.replace(nextPath);
                return;
            }

            setChecking(false);
        })();

        return () => {
            cancelled = true;
        };
    }, [router, nextPath]);

    async function onSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError("");

        if (!email.trim() || !password.trim()) {
            setError("Ingresa email y password.");
            return;
        }

        setLoading(true);
        try {
            await signInWithPassword(email.trim().toLowerCase(), password);
            router.replace(nextPath);
        } catch (e) {
            setError(toFriendlyLoginError(e));
        } finally {
            setLoading(false);
        }
    }

    if (checking) {
        return (
            <div className="min-h-screen grid place-items-center p-6 bg-slate-50">
                <LoadingState label="Validando tu sesión..." className="w-full max-w-md" />
            </div>
        );
    }

    return (
        <div className="min-h-screen grid place-items-center p-6 bg-slate-50">
            <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm space-y-4">
                <div>
                    <h1 className="text-xl font-semibold">Ingresar</h1>
                    <p className="text-sm text-muted-foreground">Accede con tu cuenta para operar en tu organización.</p>
                    <p className="text-xs text-muted-foreground mt-1">Entorno activo: eventprolabs</p>
                </div>

                <form className="space-y-3" onSubmit={onSubmit}>
                    <label className="block space-y-1">
                        <span className="text-xs text-muted-foreground">Email</span>
                        <input
                            type="email"
                            className="w-full rounded-md border px-3 py-2 text-sm"
                            placeholder="tu.email@empresa.com"
                            autoComplete="email"
                            value={email}
                            onChange={(ev) => setEmail(ev.target.value)}
                            disabled={loading}
                        />
                    </label>

                    <label className="block space-y-1">
                        <span className="text-xs text-muted-foreground">Password</span>
                        <input
                            type="password"
                            className="w-full rounded-md border px-3 py-2 text-sm"
                            placeholder="••••••••"
                            autoComplete="current-password"
                            value={password}
                            onChange={(ev) => setPassword(ev.target.value)}
                            disabled={loading}
                        />
                    </label>

                    {error ? <ErrorState title="No pudimos iniciar tu sesión" description={error} className="text-xs" /> : null}

                    <button type="submit" className="w-full rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60" disabled={loading}>
                        {loading ? "Ingresando..." : "Ingresar al workspace"}
                    </button>
                </form>
            </div>
        </div>
    );
}

