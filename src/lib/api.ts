/**
 * Appels réseau du site public (sans supabase-js : deux requêtes suffisent,
 * et le bundle reste léger).
 */
import { z } from 'zod';
import {
  waitlistJoinResponseSchema,
  type WaitlistErrorCode,
  type WaitlistFieldsInput,
  type WaitlistJoinResponse,
} from '@shared/waitlist';
import type { PublicEnv } from './env';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function authHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key };
  if (key.startsWith('eyJ')) headers['Authorization'] = `Bearer ${key}`;
  return headers;
}

const countSchema = z.number().int().nonnegative();

/**
 * Nombre réel d'inscrits (RPC publique waitlist_count, qui ne renvoie qu'un
 * entier). Renvoie null si le service n'est pas configuré ou ne répond pas :
 * on n'affiche alors rien, jamais un chiffre inventé.
 */
export async function fetchWaitlistCount(env: PublicEnv, fetchFn: FetchLike = fetch): Promise<number | null> {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  try {
    const res = await fetchFn(`${env.supabaseUrl}/rest/v1/rpc/waitlist_count`, {
      method: 'POST',
      headers: { ...authHeaders(env.supabaseAnonKey), 'content-type': 'application/json', accept: 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const parsed = countSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

let sharedCount: Promise<number | null> | null = null;

/** Une seule requête par page, même si plusieurs compteurs sont affichés. */
export function getWaitlistCountOnce(env: PublicEnv, fetchFn: FetchLike = fetch): Promise<number | null> {
  sharedCount ??= fetchWaitlistCount(env, fetchFn);
  return sharedCount;
}

/** Réinitialise le cache (tests). */
export function resetWaitlistCountCache(): void {
  sharedCount = null;
}

export type JoinResult =
  | { ok: true; data: WaitlistJoinResponse }
  | { ok: false; error: WaitlistErrorCode | 'network' | 'not_configured'; fields?: Partial<Record<keyof WaitlistFieldsInput, string>> };

const errorBodySchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});

const KNOWN_ERRORS: readonly WaitlistErrorCode[] = [
  'invalid_request',
  'captcha_failed',
  'rate_limited',
  'forbidden_origin',
  'method_not_allowed',
  'payload_too_large',
  'unsupported_media_type',
  'unavailable',
  'server_error',
];

export async function joinWaitlist(env: PublicEnv, body: unknown, fetchFn: FetchLike = fetch): Promise<JoinResult> {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return { ok: false, error: 'not_configured' };
  let res: Response;
  try {
    res = await fetchFn(`${env.supabaseUrl}/functions/v1/waitlist-join`, {
      method: 'POST',
      headers: { ...authHeaders(env.supabaseAnonKey), 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, error: 'network' };
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (res.ok) {
    const parsed = waitlistJoinResponseSchema.safeParse(payload);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: 'server_error' };
  }
  const err = errorBodySchema.safeParse(payload);
  const code = err.success && (KNOWN_ERRORS as readonly string[]).includes(err.data.error) ? (err.data.error as WaitlistErrorCode) : null;
  if (code === 'invalid_request' && err.success && err.data.fields) {
    return { ok: false, error: code, fields: err.data.fields };
  }
  if (code) return { ok: false, error: code };
  if (res.status === 429) return { ok: false, error: 'rate_limited' };
  return { ok: false, error: 'server_error' };
}

/** Message affiché pour chaque erreur (jamais de détail technique). */
export function joinErrorMessage(error: Exclude<JoinResult, { ok: true }>['error']): string {
  switch (error) {
    case 'invalid_request':
      return 'Certains champs sont à corriger.';
    case 'captcha_failed':
      return 'La vérification anti-robot a échoué. Réessaie.';
    case 'rate_limited':
      return 'Trop de tentatives depuis ta connexion. Réessaie dans quelques minutes.';
    case 'network':
      return 'Connexion impossible. Vérifie ta connexion internet et réessaie.';
    case 'not_configured':
    case 'unavailable':
      return 'Les inscriptions ne sont pas encore ouvertes. Réessaie un peu plus tard.';
    default:
      return 'Le service est momentanément indisponible. Réessaie dans un instant.';
  }
}

// ---------------------------------------------------------------------------
// Opposition à la prospection (page /opposition)
// ---------------------------------------------------------------------------

export type OppositionResult = { ok: true } | { ok: false; error: 'not_configured' | 'network' | 'invalid' | 'captcha' | 'rate_limited' | 'server' };

/**
 * Enregistre une demande d'opposition (lien d'un email ou formulaire). La
 * réponse est la même qu'un jeton existe ou non : rien n'est révélé.
 */
export async function registerOpposition(env: PublicEnv, body: { token: string } | { siren?: string; email?: string; turnstileToken: string }, fetchFn: FetchLike = fetch): Promise<OppositionResult> {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return { ok: false, error: 'not_configured' };
  let res: Response;
  try {
    res = await fetchFn(`${env.supabaseUrl}/functions/v1/opposition-register`, {
      method: 'POST',
      headers: { ...authHeaders(env.supabaseAnonKey), 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, error: 'network' };
  }
  if (res.ok) return { ok: true };
  if (res.status === 400) return { ok: false, error: 'invalid' };
  if (res.status === 403) return { ok: false, error: 'captcha' };
  if (res.status === 429) return { ok: false, error: 'rate_limited' };
  return { ok: false, error: 'server' };
}
