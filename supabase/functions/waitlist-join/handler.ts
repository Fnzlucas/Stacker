/**
 * Logique HTTP de `waitlist-join`, indépendante de Deno pour être testée
 * avec Vitest. index.ts ne fait que brancher l'environnement réel.
 *
 * Ordre des contrôles (du moins cher au plus cher) :
 *   configuration → origine (CORS) → méthode → type et taille du corps →
 *   validation Zod → rate limit par IP (compteur Postgres) → Turnstile
 *   (siteverify, si TURNSTILE_SECRET_KEY est défini) → insertion idempotente (RPC security definer) → email.
 *
 * Confidentialité : la réponse a la même forme qu'il s'agisse d'une
 * nouvelle inscription ou d'une réinscription, et ne contient que des
 * informations sur l'adresse soumise. Les journaux ne contiennent ni
 * email, ni prénom, ni IP.
 */
import { z } from 'zod';
import {
  LEGAL_VERSION,
  buildReferralUrl,
  fieldErrors,
  generateReferralCode,
  waitlistJoinRequestSchema,
  type WaitlistErrorBody,
  type WaitlistErrorCode,
  type WaitlistJoinResponse,
} from '../_shared/waitlist.ts';
import type { ConfigResult, WaitlistConfig } from './config.ts';
import { buildConfirmationEmail } from './email.ts';
import { RpcError, callRpc, sendBrevoEmail, verifyTurnstile, type FetchLike } from './services.ts';

export const MAX_BODY_BYTES = 8 * 1024;
export const RATE_LIMIT = { max: 10, windowSeconds: 600 } as const;
const MAX_REFERRAL_ATTEMPTS = 3;

export interface HandlerDeps {
  config: ConfigResult;
  fetch: FetchLike;
  /** Prolonge l'exécution après la réponse (EdgeRuntime.waitUntil en production). */
  waitUntil: (promise: Promise<unknown>) => void;
  log: (event: string, data?: Record<string, string | number | boolean | string[]>) => void;
  randomBytes?: (n: number) => Uint8Array;
  uuid?: () => string;
}

const joinRowSchema = z.array(
  z.object({
    queue_position: z.number().int().positive(),
    code: z.string(),
    created: z.boolean(),
  }),
).length(1);

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function json(status: number, body: WaitlistJoinResponse | WaitlistErrorBody, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

const fail = (status: number, error: WaitlistErrorCode, extra: Record<string, string> = {}): Response =>
  json(status, { ok: false, error }, extra);

/** IP du client telle que transmise par la passerelle Supabase (premier saut). */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  return null;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function readJsonBody(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return { ok: false, response: fail(413, 'payload_too_large') };
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { ok: false, response: fail(413, 'payload_too_large') };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: fail(400, 'invalid_request') };
  }
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  if (deps.config.ok) {
    for (const warning of deps.config.warnings) deps.log('config_warning', { warning });
  } else {
    deps.log('config_invalid', { variables: deps.config.missing });
  }

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

    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) return fail(415, 'unsupported_media_type', cors);

    const body = await readJsonBody(req);
    if (!body.ok) {
      for (const [k, v] of Object.entries(cors)) body.response.headers.set(k, v);
      return body.response;
    }

    const parsed = waitlistJoinRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return json(400, { ok: false, error: 'invalid_request', fields: fieldErrors(parsed.error) }, cors);
    }
    const input = parsed.data;

    try {
      const ip = clientIp(req);
      const bucket = `waitlist-join:${await sha256Hex(`${config.rateLimitPepper}:${ip ?? 'unknown'}`)}`;
      const allowed = await callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, 'rate_limit_hit', {
        p_bucket: bucket,
        p_max: RATE_LIMIT.max,
        p_window_seconds: RATE_LIMIT.windowSeconds,
      });
      if (allowed !== true) {
        deps.log('rate_limited');
        return fail(429, 'rate_limited', { ...cors, 'Retry-After': String(RATE_LIMIT.windowSeconds) });
      }

      if (config.turnstileSecret) {
        const captcha = input.turnstileToken
          ? await verifyTurnstile(deps.fetch, config.turnstileSecret, input.turnstileToken, ip, uuid())
          : { success: false, errorCodes: ['missing-input-response'] };
        if (!captcha.success) {
          deps.log('captcha_failed', { codes: captcha.errorCodes });
          return fail(403, 'captcha_failed', cors);
        }
      }

      const row = await join(deps, config, input);
      const referralUrl = buildReferralUrl(config.siteUrl, row.code);

      if (row.created) {
        deps.log('joined');
        if (config.brevo) {
          const message = buildConfirmationEmail({
            email: input.email,
            firstName: input.firstName,
            position: row.queue_position,
            referralUrl,
            siteUrl: config.siteUrl,
            contactEmail: config.contactEmail,
          });
          deps.waitUntil(
            sendBrevoEmail(deps.fetch, config.brevo, message).then(
              () => deps.log('email_sent'),
              (error: unknown) => deps.log('email_failed', { reason: error instanceof Error ? error.message : 'unknown' }),
            ),
          );
        } else {
          // Mode « log » : sans clé Brevo, l'email n'est pas envoyé ; on journalise
          // son existence (jamais le destinataire ni le contenu).
          deps.log('email_logged', { mode: 'log', template: 'waitlist-confirmation' });
        }
      } else {
        deps.log('rejoined');
      }

      return json(200, { ok: true, position: row.queue_position, referralCode: row.code, referralUrl }, cors);
    } catch (error) {
      if (error instanceof RpcError && (error.code === '23514' || error.code === '22023')) {
        deps.log('rejected_by_database', { code: error.code });
        return fail(400, 'invalid_request', cors);
      }
      deps.log('server_error', {
        reason: error instanceof RpcError ? `rpc_${String(error.status)}_${error.code ?? 'none'}` : 'exception',
      });
      return fail(500, 'server_error', cors);
    }
  };
}

async function join(
  deps: HandlerDeps,
  config: WaitlistConfig,
  input: z.output<typeof waitlistJoinRequestSchema>,
): Promise<z.output<typeof joinRowSchema>[number]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, 'waitlist_join', {
        p_email: input.email,
        p_first_name: input.firstName,
        p_department: input.department,
        p_age_confirmed: input.ageConfirmed,
        p_terms_accepted: input.termsAccepted,
        p_marketing_opt_in: input.marketingOptIn,
        p_legal_version: LEGAL_VERSION,
        p_referral_code: input.referralCode,
        p_new_referral_code: generateReferralCode(deps.randomBytes),
      });
      const [row] = joinRowSchema.parse(result);
      if (!row) throw new Error('waitlist_join: aucune ligne');
      return row;
    } catch (error) {
      const collision = error instanceof RpcError && error.message === 'referral_code_collision';
      if (!collision || attempt >= MAX_REFERRAL_ATTEMPTS) throw error;
      deps.log('referral_code_retry', { attempt });
    }
  }
}
