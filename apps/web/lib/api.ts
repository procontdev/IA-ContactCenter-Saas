export const API_BASE = process.env.NEXT_PUBLIC_API_BASE!;

function qs(params: Record<string, any>) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === null || v === undefined || v === "") return;
    sp.set(k, String(v));
  });
  return sp.toString();
}

export async function apiGet<T>(path: string, params: Record<string, any> = {}): Promise<T> {
  const q = qs(params);
  const url = `${API_BASE}${path}${q ? `?${q}` : ""}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
  return res.json();
}

export async function apiPost<T>(path: string, body: any): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE || "";
  const url = `${base}${path}`;

  const apiKey = process.env.NEXT_PUBLIC_API_KEY || "";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} ${txt}`.trim());
  }

  return res.json();
}
