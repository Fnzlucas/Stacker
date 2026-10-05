/**
 * Appels PostgREST (RPC) et Auth Supabase depuis les Edge Functions, avec la
 * clé service_role. Partagé par waitlist-join et account-delete.
 */
import { z } from 'zod';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** En-têtes d'authentification PostgREST : `apikey`, plus `Authorization` si la clé est un JWT (clés historiques). */
export function supabaseAuthHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key };
  if (key.startsWith('eyJ')) headers['Authorization'] = `Bearer ${key}`;
  return headers;
}

export class RpcError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

const postgrestErrorSchema = z.object({ code: z.string().nullish(), message: z.string().nullish() }).loose();

/** Appelle une fonction SQL exposée par PostgREST avec la clé service_role. */
export async function callRpc(
  fetchFn: FetchLike,
  supabaseUrl: string,
  serviceKey: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetchFn(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...supabaseAuthHeaders(serviceKey), 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    let code: string | null = null;
    let message = `rpc ${fn} http ${String(res.status)}`;
    try {
      const err = postgrestErrorSchema.safeParse(await res.json());
      if (err.success) {
        code = err.data.code ?? null;
        message = err.data.message ?? message;
      }
    } catch {
      /* corps illisible : on garde le message générique */
    }
    throw new RpcError(res.status, code, message);
  }
  return res.json();
}

const authUserSchema = z.object({ id: z.uuid(), email: z.string().nullish() }).loose();

export interface AuthUser {
  id: string;
  email: string | null;
}

/**
 * Valide le jeton d'accès d'un utilisateur auprès de Supabase Auth (GET
 * /auth/v1/user : signature, expiration et session révoquée sont vérifiées
 * par Auth). Renvoie null si le jeton est refusé.
 */
export async function fetchAuthUser(fetchFn: FetchLike, supabaseUrl: string, apiKey: string, accessToken: string): Promise<AuthUser | null> {
  const res = await fetchFn(`${supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new RpcError(res.status, null, `auth user http ${String(res.status)}`);
  const parsed = authUserSchema.safeParse(await res.json());
  if (!parsed.success) throw new RpcError(502, null, 'auth user: réponse invalide');
  return { id: parsed.data.id, email: parsed.data.email ?? null };
}

/** Supprime un utilisateur (API admin Auth). 404 = déjà supprimé (idempotent). */
export async function adminDeleteUser(fetchFn: FetchLike, supabaseUrl: string, serviceKey: string, userId: string): Promise<void> {
  const res = await fetchFn(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok && res.status !== 404) throw new RpcError(res.status, null, `auth admin delete http ${String(res.status)}`);
}

const amrSchema = z.array(z.object({ method: z.string(), timestamp: z.number() }).loose());

/**
 * Horodatage (secondes) de la dernière authentification d'après la
 * revendication `amr` du JWT. À n'utiliser qu'APRÈS validation du jeton par
 * fetchAuthUser : la charge utile n'est décodée, pas vérifiée, ici.
 */
export function lastAuthenticationAt(accessToken: string): number | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0))));
    if (!json || typeof json !== 'object' || !('amr' in json)) return null;
    const amr = amrSchema.safeParse(json.amr);
    if (!amr.success || amr.data.length === 0) return null;
    return Math.max(...amr.data.map((a) => a.timestamp));
  } catch {
    return null;
  }
}
