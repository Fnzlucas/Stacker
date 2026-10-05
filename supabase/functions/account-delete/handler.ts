/**
 * Suppression du compte (RGPD, droit à l'effacement). Logique HTTP testée
 * par Vitest ; index.ts branche l'environnement Deno.
 *
 * Contrôles, dans l'ordre : configuration → origine (CORS) → méthode →
 * type et taille du corps → confirmation « SUPPRIMER » → jeton utilisateur
 * validé par Supabase Auth → connexion récente (< 10 min, revendication amr)
 * → rate limit par compte → effacement (liste d'attente) → suppression de
 * l'utilisateur par l'API admin (profil et consentements suivent en cascade).
 *
 * L'identité vient UNIQUEMENT du jeton : le corps ne contient aucun
 * identifiant, un utilisateur ne peut donc supprimer que son propre compte.
 * Journaux sans donnée personnelle (ni email, ni identifiant en clair).
 */
import { REAUTH_MAX_AGE_SECONDS, accountDeleteRequestSchema, type AccountDeleteErrorCode } from '../_shared/account.ts';
import { RpcError, adminDeleteUser, callRpc, fetchAuthUser, lastAuthenticationAt, type FetchLike } from '../_shared/rest.ts';
import type { ConfigResult } from './config.ts';

export const MAX_BODY_BYTES = 1024;
export const RATE_LIMIT = { max: 5, windowSeconds: 3600 } as const;

export interface HandlerDeps {
  config: ConfigResult;
  fetch: FetchLike;
  log: (event: string, data?: Record<string, string | number | boolean | string[]>) => void;
  /** Horloge injectable (secondes Unix). */
  now?: () => number;
}

type Body = { ok: true; status: 'deleted' } | { ok: false; error: AccountDeleteErrorCode };

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function json(status: number, body: Body, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
  });
}

const fail = (status: number, error: AccountDeleteErrorCode, extra: Record<string, string> = {}): Response => json(status, { ok: false, error }, extra);

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function bearer(req: Request): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(req.headers.get('authorization') ?? '');
  return m?.[1] ?? null;
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  if (!deps.config.ok) deps.log('config_invalid', { variables: deps.config.missing });

  return async function handle(req: Request): Promise<Response> {
    if (!deps.config.ok) return fail(503, 'unavailable');
    const config = deps.config.config;

    const origin = req.headers.get('origin');
    if (!origin || !config.allowedOrigins.has(origin)) {
      deps.log('forbidden_origin');
      return fail(403, 'forbidden_origin');
    }
    const cors = corsHeaders(origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', { ...cors, Allow: 'POST, OPTIONS' });

    if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return fail(415, 'unsupported_media_type', cors);
    if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return fail(413, 'payload_too_large', cors);
    const text = await req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return fail(413, 'payload_too_large', cors);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return fail(400, 'invalid_request', cors);
    }
    if (!accountDeleteRequestSchema.safeParse(body).success) return fail(400, 'invalid_request', cors);

    const token = bearer(req);
    if (!token) return fail(401, 'unauthorized', cors);

    try {
      const user = await fetchAuthUser(deps.fetch, config.supabaseUrl, config.anonKey, token);
      if (!user) {
        deps.log('unauthorized');
        return fail(401, 'unauthorized', cors);
      }

      const authAt = lastAuthenticationAt(token);
      if (authAt === null || now() - authAt > REAUTH_MAX_AGE_SECONDS) {
        deps.log('reauth_required');
        return fail(401, 'reauth_required', cors);
      }

      const bucket = `account-delete:${await sha256Hex(`${config.rateLimitPepper}:${user.id}`)}`;
      const allowed = await callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, 'rate_limit_hit', {
        p_bucket: bucket,
        p_max: RATE_LIMIT.max,
        p_window_seconds: RATE_LIMIT.windowSeconds,
      });
      if (allowed !== true) {
        deps.log('rate_limited');
        return fail(429, 'rate_limited', { ...cors, 'Retry-After': String(RATE_LIMIT.windowSeconds) });
      }

      await callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, 'account_erase_prepare', { p_user_id: user.id });
      await adminDeleteUser(deps.fetch, config.supabaseUrl, config.serviceRoleKey, user.id);
      deps.log('account_deleted');
      return json(200, { ok: true, status: 'deleted' }, cors);
    } catch (error) {
      deps.log('server_error', { reason: error instanceof RpcError ? `http_${String(error.status)}_${error.code ?? 'none'}` : 'exception' });
      return fail(500, 'server_error', cors);
    }
  };
}
