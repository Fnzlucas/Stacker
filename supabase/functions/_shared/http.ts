/**
 * Briques HTTP communes aux Edge Functions du lot 3 : CORS par liste
 * blanche, réponses JSON non mises en cache, lecture bornée du corps, jeton
 * Bearer, IP client, hachage.
 */

export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export function jsonResponse(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
  });
}

export type BodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413 | 415 };

/** Corps JSON borné (Content-Length annoncé ET taille réelle). */
export async function readJson(req: Request, maxBytes: number): Promise<BodyResult> {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return { ok: false, status: 415 };
  if (Number(req.headers.get('content-length') ?? '0') > maxBytes) return { ok: false, status: 413 };
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false, status: 413 };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}

export function bearer(req: Request): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(req.headers.get('authorization') ?? '');
  return m?.[1] ?? null;
}

/** IP du client telle que transmise par la passerelle Supabase (premier saut). */
export function clientIp(req: Request): string | null {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (first) return first;
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  return null;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
