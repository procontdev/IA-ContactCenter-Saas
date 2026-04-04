import { resolveTenantContext, type ResolveTenantOptions } from './tenant-resolver';

function getBearerToken(req: Request): string | null {
    const auth = req.headers.get('authorization') || req.headers.get('Authorization') || '';
    const value = auth.trim();
    if (!value) return null;

    const m = value.match(/^Bearer\s+(.+)$/i);
    return m?.[1]?.trim() || null;
}

export async function resolveTenantFromRequest(req: Request, opts?: Omit<ResolveTenantOptions, 'accessToken'>) {
    const token = getBearerToken(req);

    if (token) {
        return resolveTenantContext(undefined, {
            ...opts,
            accessToken: token,
            fallbackEnabled: false,
        });
    }

    return resolveTenantContext(undefined, {
        ...opts,
    });
}
