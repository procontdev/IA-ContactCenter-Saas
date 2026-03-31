// lib/supabaseRest.ts
export const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// OJO: si no defines el env, por defecto apunta a demo_callcenter (tu caso)
export const SB_SCHEMA = process.env.NEXT_PUBLIC_DB_SCHEMA || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || "contact_center";

type FetchOpts = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: any;
  schema?: string; // 👈 override por llamada
  tenantId?: string; // ✅ NEW: Inyección automática de tenant_id
  cache?: RequestCache;
  headers?: Record<string, string>;
};

async function coreFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const schema = opts.schema ?? SB_SCHEMA;
  const url = new URL(`${SB_URL}${path}`);

  // 1. Inyección de tenant_id en Query Params (Lecturas)
  const finalQuery = { ...(opts.query || {}) };
  if (opts.tenantId && (opts.method === 'GET' || !opts.method)) {
    // Si no hay un filtro de tenant_id ya definido, lo inyectamos
    if (!finalQuery.tenant_id) {
       finalQuery.tenant_id = `eq.${opts.tenantId}`;
    }
  }

  if (finalQuery) {
    for (const [k, v] of Object.entries(finalQuery)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  // 2. Inyección de tenant_id en Body (Escrituras)
  let finalBody = opts.body;
  if (opts.tenantId && (opts.method === 'POST' || opts.method === 'PATCH')) {
    if (typeof finalBody === 'object' && finalBody !== null && !Array.isArray(finalBody)) {
      finalBody = { ...finalBody, tenant_id: opts.tenantId };
    } else if (Array.isArray(finalBody)) {
      finalBody = finalBody.map(item => ({ ...item, tenant_id: opts.tenantId }));
    }
  }

  const res = await fetch(url.toString(), {
    method: opts.method || "GET",
    headers: {
      apikey: SB_ANON,
      Authorization: `Bearer ${SB_ANON}`,
      Accept: "application/json",
      "Accept-Profile": schema,
      "Content-Profile": schema,
      ...(finalBody ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers ?? {}),
    },
    body: finalBody ? JSON.stringify(finalBody) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase error ${res.status} ${res.statusText}: ${text}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null as any as T;
  return (await res.json()) as T;
}

// Client fetch (también sirve en server, pero dejo ambos por claridad)
export async function sbFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
    return coreFetch<T>(path, opts);
}

// Server fetch (mismo comportamiento, útil para Server Components/generateStaticParams)
export async function sbFetchServer<T>(path: string, opts: FetchOpts = {}): Promise<T> {
    return coreFetch<T>(path, { ...opts, cache: "force-cache" });
}


// Helpers
export function publicRecordingUrl(keyOrPath: string) {
    const path = keyOrPath.startsWith("recordings/") ? keyOrPath : `recordings/${keyOrPath}`;
    return `${SB_URL}/storage/v1/object/public/${path}`;
}
