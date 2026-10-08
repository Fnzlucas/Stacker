/**
 * Opposition à la prospection (« ne plus être contacté par Stacker »).
 * Deux entrées publiques :
 *   - { token } : le lien du pied de chaque email préparé ;
 *   - { siren?, email?, turnstileToken } : le formulaire de la page /opposition.
 *
 * Contrôles : configuration → origine (CORS) → méthode → corps (taille, JSON,
 * Zod strict) → rate limit par IP (20/h, IP hachée) → Turnstile (formulaire)
 * → enregistrement (idempotent, libère les réservations de l'entreprise).
 *
 * Pas d'énumération : un jeton inconnu, expiré ou déjà utilisé reçoit
 * exactement la même réponse qu'un jeton valide. Journaux sans donnée
 * personnelle (ni SIREN, ni email, ni IP).
 */
import { RpcError, callRpc, type FetchLike } from '../_shared/rest.ts';
import { clientIp, corsHeaders, jsonResponse, readJson, sha256Hex } from '../_shared/http.ts';
import { oppositionRequestSchema } from '../_shared/prospects.ts';
import { verifyTurnstile } from '../waitlist-join/services.ts';
import type { ConfigResult } from './config.ts';

export const MAX_BODY_BYTES = 6144;
export const IP_RATE = { max: 20, windowSeconds: 3600 } as const;

export type OppositionErrorCode =
  | 'invalid_request'
  | 'forbidden_origin'
  | 'method_not_allowed'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'rate_limited'
  | 'captcha_failed'
  | 'unavailable'
  | 'server_error';

export interface HandlerDeps {
  config: ConfigResult;
  fetch: FetchLike;
  log: (event: string, data?: Record<string, string | number | boolean | string[]>) => void;
  uuid?: () => string;
}

const fail = (status: number, error: OppositionErrorCode, extra: Record<string, string> = {}): Response => jsonResponse(status, { ok: false, error }, extra);

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  if (!deps.config.ok) deps.log('config_invalid', { variables: deps.config.missing });

  return async function handle(req: Request): Promise<Response> {
    if (!deps.config.ok) return fail(503, 'unavailable');
    const config = deps.config.config;
    const rpc = (fn: string, args: Record<string, unknown>) => callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, fn, args);

    const origin = req.headers.get('origin');
    if (!origin || !config.allowedOrigins.has(origin)) {
      deps.log('forbidden_origin');
      return fail(403, 'forbidden_origin');
    }
    const cors = corsHeaders(origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', { ...cors, Allow: 'POST, OPTIONS' });

    const body = await readJson(req, MAX_BODY_BYTES);
    if (!body.ok) return fail(body.status, body.status === 415 ? 'unsupported_media_type' : body.status === 413 ? 'payload_too_large' : 'invalid_request', cors);
    const parsed = oppositionRequestSchema.safeParse(body.value);
    if (!parsed.success) return fail(400, 'invalid_request', cors);
    const input = parsed.data;

    try {
      const ip = clientIp(req);
      const bucket = `opposition:${await sha256Hex(`${config.rateLimitPepper}:${ip ?? 'inconnue'}`)}`;
      const allowed = await rpc('rate_limit_hit', { p_bucket: bucket, p_max: IP_RATE.max, p_window_seconds: IP_RATE.windowSeconds });
      if (allowed !== true) {
        deps.log('rate_limited');
        return fail(429, 'rate_limited', { ...cors, 'Retry-After': String(IP_RATE.windowSeconds) });
      }

      if ('token' in input) {
        const done = await rpc('opposition_register_token', { p_token: input.token });
        deps.log('token', { applied: done === true });
        return jsonResponse(200, { ok: true }, cors);
      }

      if (config.turnstileSecret) {
        const check = await verifyTurnstile(deps.fetch, config.turnstileSecret, input.turnstileToken, ip, uuid());
        if (!check.success) {
          deps.log('captcha_failed', { codes: check.errorCodes });
          return fail(403, 'captcha_failed', cors);
        }
      }
      await rpc('opposition_register_form', { p_siren: input.siren ?? null, p_email: input.email ?? null });
      deps.log('form');
      return jsonResponse(200, { ok: true }, cors);
    } catch (error) {
      deps.log('server_error', { reason: error instanceof RpcError ? `http_${String(error.status)}_${error.code ?? 'none'}` : 'exception' });
      return fail(500, 'server_error', cors);
    }
  };
}
