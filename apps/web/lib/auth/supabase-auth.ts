type SupabaseUser = {
    id: string;
    email?: string | null;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
};

type SessionPayload = {
    currentSession?: unknown;
    access_token?: unknown;
    refresh_token?: unknown;
    token_type?: unknown;
    expires_in?: unknown;
    expires_at?: unknown;
    user?: unknown;
    error_description?: unknown;
    msg?: unknown;
    error?: unknown;
};

export type AuthSession = {
    access_token: string;
    refresh_token: string;
    token_type?: string;
    expires_in?: number;
    expires_at?: number;
    user?: SupabaseUser;
};

const AUTH_CHANGED_EVENT = "auth-session-changed";

function getSupabaseUrl() {
    return (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
}

function getAnonKey() {
    return (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
}

function inferProjectRef() {
    const raw = getSupabaseUrl();
    if (!raw) return "local";

    try {
        const hostname = new URL(raw).hostname;
        const first = hostname.split(".")[0] || "";
        return (first || "local").toLowerCase();
    } catch {
        return "local";
    }
}

export function getAuthStorageKey() {
    return `sb-${inferProjectRef()}-auth-token`;
}

function nowEpochSeconds() {
    return Math.floor(Date.now() / 1000);
}

function normalizeSession(raw: unknown): AuthSession | null {
    if (!raw || typeof raw !== "object") return null;
    const src = raw as SessionPayload;
    const session = (src.currentSession && typeof src.currentSession === "object" ? src.currentSession : src) as SessionPayload;

    const access = String(session?.access_token || "").trim();
    const refresh = String(session?.refresh_token || "").trim();
    if (!access || !refresh) return null;

    return {
        access_token: access,
        refresh_token: refresh,
        token_type: typeof session?.token_type === "string" ? session.token_type : undefined,
        expires_in: Number(session?.expires_in || 0) || undefined,
        expires_at: Number(session?.expires_at || 0) || undefined,
        user: session?.user && typeof session.user === "object" ? (session.user as SupabaseUser) : undefined,
    };
}

export function readStoredSession(): AuthSession | null {
    if (typeof window === "undefined") return null;

    const raw = window.localStorage.getItem(getAuthStorageKey());
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        return normalizeSession(parsed);
    } catch {
        return null;
    }
}

function persistSession(session: AuthSession | null) {
    if (typeof window === "undefined") return;

    const key = getAuthStorageKey();
    if (!session) {
        window.localStorage.removeItem(key);
        window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
        return;
    }

    const payload = {
        currentSession: session,
        expiresAt: session.expires_at || null,
    };
    window.localStorage.setItem(key, JSON.stringify(payload));
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

function authHeaders(accessToken?: string) {
    const headers: Record<string, string> = {
        apikey: getAnonKey(),
        "Content-Type": "application/json",
    };

    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
}

function isExpiring(session: AuthSession, safetySeconds = 30) {
    const exp = Number(session.expires_at || 0);
    if (!exp) return false;
    return exp <= nowEpochSeconds() + safetySeconds;
}

async function requestSession(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
    });

    const payload = (await res.json().catch(() => ({}))) as SessionPayload;
    if (!res.ok) {
        const msg = String(payload?.error_description || payload?.msg || payload?.error || `HTTP ${res.status}`);
        throw new Error(msg);
    }

    const session = normalizeSession(payload);
    if (!session) throw new Error("No se pudo construir sesión desde auth response");
    persistSession(session);
    return session;
}

export async function signInWithPassword(email: string, password: string): Promise<AuthSession> {
    const base = getSupabaseUrl();
    if (!base || !getAnonKey()) {
        throw new Error("Falta configurar NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }

    return requestSession(`${base}/auth/v1/token?grant_type=password`, {
        email,
        password,
    });
}

export async function refreshSession(refreshToken: string): Promise<AuthSession> {
    const base = getSupabaseUrl();
    if (!base || !getAnonKey()) {
        throw new Error("Falta configurar NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }

    return requestSession(`${base}/auth/v1/token?grant_type=refresh_token`, {
        refresh_token: refreshToken,
    });
}

export async function getValidSession(): Promise<AuthSession | null> {
    const session = readStoredSession();
    if (!session) return null;
    if (!isExpiring(session)) return session;

    try {
        return await refreshSession(session.refresh_token);
    } catch {
        persistSession(null);
        return null;
    }
}

export async function logout(): Promise<void> {
    const session = readStoredSession();
    const base = getSupabaseUrl();

    if (session?.access_token && base) {
        try {
            await fetch(`${base}/auth/v1/logout`, {
                method: "POST",
                headers: authHeaders(session.access_token),
            });
        } catch {
            // no-op
        }
    }

    persistSession(null);
}

export function onAuthSessionChanged(cb: () => void) {
    if (typeof window === "undefined") return () => { };

    const handler = () => cb();
    window.addEventListener(AUTH_CHANGED_EVENT, handler);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, handler);
}

