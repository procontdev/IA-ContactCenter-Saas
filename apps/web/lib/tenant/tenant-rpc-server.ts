type RpcError = {
    status: number;
    message: string;
    details?: unknown;
};

type JsonObject = Record<string, unknown>;

function pickEnv(...keys: string[]) {
    for (const k of keys) {
        const v = (process.env[k] || '').trim();
        if (v) return v;
    }
    return '';
}

export function extractBearerToken(req: Request): string | null {
    const auth = req.headers.get('authorization') || req.headers.get('Authorization') || '';
    const m = auth.trim().match(/^Bearer\s+(.+)$/i);
    return m?.[1]?.trim() || null;
}

async function safeReadJson(res: Response) {
    const text = await res.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

export function normalizeRpcPayload<T>(payload: T[] | T | null): T | null {
    if (!payload) return null;
    if (Array.isArray(payload)) return payload[0] ?? null;
    return payload;
}

export async function callPlatformCoreRpc<T>(
    req: Request,
    fn: string,
    payload: JsonObject
): Promise<T> {
    const token = extractBearerToken(req);
    if (!token) {
        throw { status: 401, message: 'Missing Bearer token' } as RpcError;
    }

    const baseUrl = pickEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
    const anonKey = pickEnv('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');

    if (!baseUrl || !anonKey) {
        throw { status: 500, message: 'Missing Supabase URL or anon key' } as RpcError;
    }

    const res = await fetch(`${baseUrl}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            apikey: anonKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Content-Profile': 'platform_core',
            'Accept-Profile': 'platform_core',
        },
        body: JSON.stringify(payload ?? {}),
        cache: 'no-store',
    });

    const body = await safeReadJson(res);

    if (!res.ok) {
        throw {
            status: res.status,
            message: extractErrorMessage(body),
            details: body,
        } as RpcError;
    }

    return body as T;
}

function extractErrorMessage(body: unknown): string {
    if (!body || typeof body !== 'object') return 'PostgREST RPC error';
    const msg =
        ('message' in body && typeof body.message === 'string' && body.message) ||
        ('error' in body && typeof body.error === 'string' && body.error) ||
        'PostgREST RPC error';
    return msg;
}

export function toHttpError(e: unknown): RpcError {
    const record = e && typeof e === 'object' ? (e as Record<string, unknown>) : null;

    return {
        status: Number(record?.status) || 500,
        message: String(record?.message || 'Unexpected error'),
        details: record?.details,
    };
}

