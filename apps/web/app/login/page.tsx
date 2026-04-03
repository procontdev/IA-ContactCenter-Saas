"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getValidSession, signInWithPassword } from "@/lib/auth/supabase-auth";

function sanitizeNext(nextPath: string | null) {
    const raw = String(nextPath || "").trim();
    if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
    if (raw.startsWith("/login")) return "/dashboard";
    return raw;
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
            setError(e instanceof Error ? e.message : "No se pudo iniciar sesión");
        } finally {
            setLoading(false);
        }
    }

    if (checking) {
        return (
            <div className="min-h-screen grid place-items-center p-6 bg-slate-50">
                <div className="text-sm text-muted-foreground">Validando sesión...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen grid place-items-center p-6 bg-slate-50">
            <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm space-y-4">
                <div>
                    <h1 className="text-xl font-semibold">Ingresar</h1>
                    <p className="text-sm text-muted-foreground">Accede con tu cuenta para operar en tu organización.</p>
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

                    {error ? <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">{error}</div> : null}

                    <button type="submit" className="w-full rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60" disabled={loading}>
                        {loading ? "Ingresando..." : "Ingresar"}
                    </button>
                </form>
            </div>
        </div>
    );
}

