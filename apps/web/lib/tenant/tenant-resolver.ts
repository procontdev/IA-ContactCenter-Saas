import { TenantContext, UserRole } from './tenant-types';

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
let fallbackWarned = false;

export type ResolveTenantOptions = {
  /**
   * Override explícito para pruebas/control runtime.
   * Si viene definido, tiene prioridad sobre variables de entorno.
   */
  fallbackEnabled?: boolean;
  /** Token opcional para evitar dependencia de localStorage en validaciones controladas. */
  accessToken?: string | null;
  /** Fetch opcional para pruebas (mock de auth/rest). */
  fetchImpl?: typeof fetch;
};

type SupabaseUser = {
  id: string;
  app_metadata?: Record<string, any>;
  user_metadata?: Record<string, any>;
};

type TenantUserRow = {
  tenant_id: string;
  role: UserRole | null;
  is_primary?: boolean;
};

function pickEnv(...keys: string[]) {
  for (const k of keys) {
    const v = (process.env[k] || '').trim();
    if (v) return v;
  }
  return '';
}

function parseBooleanFlag(raw: string, defaultValue: boolean): boolean {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return defaultValue;
}

/**
 * Lectura explícita (client-safe en Next) del flag público de fallback.
 * Evita acceso dinámico process.env[name].
 */
export function getTenantFallbackEnabled(defaultValue = true): boolean {
  const raw = (process.env.NEXT_PUBLIC_TENANT_FALLBACK_ENABLED || '').trim();
  return parseBooleanFlag(raw, defaultValue);
}

function resolveFallbackEnabled(opts?: ResolveTenantOptions): boolean {
  if (typeof opts?.fallbackEnabled === 'boolean') return opts.fallbackEnabled;
  const raw = (process.env.NEXT_PUBLIC_TENANT_FALLBACK_ENABLED || '').trim();
  return parseBooleanFlag(raw, true);
}

function warnFallback(reason: string) {
  if (fallbackWarned) return;
  fallbackWarned = true;
  try {
    console.warn(`[tenant-resolver] fallback tenant activo (${reason}). Revisa sesión/auth/tenant_users.`);
  } catch {
    // no-op
  }
}

function normalizeRole(raw: unknown): UserRole {
  const val = String(raw || '').toLowerCase();
  if (val === 'superadmin' || val === 'tenant_admin' || val === 'supervisor' || val === 'agent') {
    return val;
  }
  return 'agent';
}

function tryReadTenantFromSession(userSession?: any): { tenantId: string | null; role: UserRole } {
  const tenantId =
    userSession?.tenant_id ||
    userSession?.user_metadata?.tenant_id ||
    userSession?.app_metadata?.tenant_id ||
    null;

  const role = normalizeRole(
    userSession?.role || userSession?.user_metadata?.role || userSession?.app_metadata?.role
  );

  return { tenantId, role };
}

function parseAuthTokenFromLocalStorage(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;

  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i) || '';
    if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;

    const raw = window.localStorage.getItem(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      const token = parsed?.access_token || parsed?.currentSession?.access_token || null;
      if (token) return String(token);
    } catch {
      // ignore malformed localStorage auth entries
    }
  }

  return null;
}

async function fetchCurrentUserFromAuth(
  baseUrl: string,
  accessToken: string,
  fetchImpl: typeof fetch
): Promise<SupabaseUser | null> {
  try {
    const res = await fetchImpl(`${baseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: pickEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'),
      },
      cache: 'no-store',
    });

    if (!res.ok) return null;
    return (await res.json()) as SupabaseUser;
  } catch {
    return null;
  }
}

async function fetchTenantUser(
  baseUrl: string,
  accessToken: string,
  userId: string,
  fetchImpl: typeof fetch
): Promise<TenantUserRow | null> {
  const url = new URL(`${baseUrl}/rest/v1/tenant_users`);
  url.searchParams.set('select', 'tenant_id,role,is_primary');
  url.searchParams.set('user_id', `eq.${userId}`);
  url.searchParams.set('is_primary', 'eq.true');
  url.searchParams.set('order', 'is_primary.desc');
  url.searchParams.set('limit', '1');

  try {
    const res = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: pickEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'),
        Accept: 'application/json',
        'Accept-Profile': 'platform_core',
      },
      cache: 'no-store',
    });

    if (!res.ok) return null;
    const rows = (await res.json()) as TenantUserRow[];
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Resuelve el contexto del tenant del usuario actual priorizando sesión/autenticación real.
 * Orden:
 * 1) Relación activa en platform_core.tenant_users (is_primary=true) vía auth token.
 * 2) tenant_id explícito en sesión (claims / metadata).
 * 3) fallback controlado al tenant por defecto (solo continuidad operativa).
 */
export async function resolveTenantContext(userSession?: any, opts?: ResolveTenantOptions): Promise<TenantContext> {
  const fallbackEnabled = resolveFallbackEnabled(opts);
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const baseUrl = pickEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL').replace(/\/$/, '');
  const sessionFromInput = tryReadTenantFromSession(userSession);

  if (baseUrl) {
    const token = typeof opts?.accessToken === 'string' ? opts.accessToken : parseAuthTokenFromLocalStorage();

    if (token) {
      const authUser = await fetchCurrentUserFromAuth(baseUrl, token, fetchImpl);
      const userId = authUser?.id || userSession?.user?.id || userSession?.id || null;

      if (userId) {
        const tenantUser = await fetchTenantUser(baseUrl, token, String(userId), fetchImpl);
        if (tenantUser?.tenant_id) {
          const role = normalizeRole(tenantUser.role || sessionFromInput.role);
          return {
            tenantId: tenantUser.tenant_id,
            role,
            isSuperAdmin: role === 'superadmin',
          };
        }
      }

      const sessionTenantFromAuthUser =
        authUser?.app_metadata?.tenant_id ||
        authUser?.user_metadata?.tenant_id ||
        null;

      if (sessionTenantFromAuthUser) {
        const role = normalizeRole(
          authUser?.app_metadata?.role || authUser?.user_metadata?.role || sessionFromInput.role
        );
        return {
          tenantId: String(sessionTenantFromAuthUser),
          role,
          isSuperAdmin: role === 'superadmin',
        };
      }

      warnFallback('token_sin_tenant_resuelto');
    }
  }

  if (sessionFromInput.tenantId) {
    return {
      tenantId: sessionFromInput.tenantId,
      role: sessionFromInput.role,
      isSuperAdmin: sessionFromInput.role === 'superadmin',
    };
  }

  if (!fallbackEnabled) {
    throw new Error('Tenant fallback disabled: no se pudo resolver tenant desde sesión real');
  }

  warnFallback('default_tenant');

  return {
    tenantId: DEFAULT_TENANT_ID,
    role: 'agent',
    isSuperAdmin: false,
  };
}

/**
 * Helper para inyectar el filtro de tenant en las queries de Supabase PostgREST.
 * Útil cuando no se usa el helper automático de supabaseRest.
 */
export function injectTenantFilter(query: any, context: TenantContext) {
  if (context.isSuperAdmin) {
    return query; // Superadmin ve todo
  }

  if (!context.tenantId) {
    throw new Error('Tenant context is missing');
  }

  return query.eq('tenant_id', context.tenantId);
}
