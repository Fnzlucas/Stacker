/**
 * Envoi des notifications push (tâche planifiée, chaque minute). Lit la file
 * (push_next), envoie à chaque iPhone du stacker, puis enregistre le
 * résultat (push_result) ; les jetons refusés par Apple sont supprimés.
 * Journaux sans contenu de notification ni identifiant.
 */
import { z } from 'zod';
import { RpcError, callRpc, type FetchLike } from '../_shared/rest.ts';
import { jsonResponse } from '../_shared/http.ts';
import { importApnsKey, providerToken, sendToDevice } from './apns.ts';
import type { PushConfigResult } from './config.ts';

export const BATCH = 100;
/** Le jeton Apple vaut 1 h : on le régénère avant. */
export const JWT_TTL_SEC = 50 * 60;

export interface HandlerDeps {
  config: PushConfigResult;
  fetch: FetchLike;
  log: (event: string, data?: Record<string, string | number | boolean | string[]>) => void;
  now?: () => number;
}

const batchSchema = z.array(
  z.object({
    id: z.number().int(),
    title: z.string(),
    body: z.string(),
    path: z.string(),
    tokens: z.array(z.object({ token: z.string(), platform: z.enum(['ios', 'android']) })),
  }),
);

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  let cached: { jwt: string; at: number } | null = null;
  let key: CryptoKey | null = null;
  if (!deps.config.ok) deps.log('config_invalid', { variables: deps.config.missing });

  return async function handle(req: Request): Promise<Response> {
    if (!deps.config.ok) return jsonResponse(503, { ok: false, error: 'unavailable' });
    const config = deps.config.config;
    if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'method_not_allowed' });
    if (!sameSecret(req.headers.get('x-cron-secret') ?? '', config.cronSecret)) return jsonResponse(403, { ok: false, error: 'forbidden' });
    const rpc = (fn: string, args: Record<string, unknown>) => callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, fn, args);
    const stats = { sent: 0, retry: 0, bad_tokens: 0, no_device: 0 };
    try {
      const batch = batchSchema.parse(await rpc('push_next', { p_limit: BATCH }));
      if (batch.length === 0) return jsonResponse(200, { ok: true, ...stats });
      key ??= await importApnsKey(config.apns.privateKey);
      if (!cached || now() - cached.at > JWT_TTL_SEC) cached = { jwt: await providerToken(key, config.apns.keyId, config.apns.teamId, now()), at: now() };
      const jwt = cached.jwt;
      for (const n of batch) {
        const ios = n.tokens.filter((t) => t.platform === 'ios');
        if (ios.length === 0) {
          stats.no_device++;
          await rpc('push_result', { p_id: n.id, p_ok: true, p_error: 'no_device', p_bad_tokens: [] });
          continue;
        }
        const outcomes = await Promise.all(ios.map(async (t) => ({ token: t.token, outcome: await sendToDevice(deps.fetch, config.apns.host, jwt, config.apns.bundleId, t.token, n) })));
        const bad = outcomes.filter((o) => o.outcome === 'bad_token').map((o) => o.token);
        const sent = outcomes.some((o) => o.outcome === 'sent');
        // Envoyée si au moins un appareil l'a reçue, ou si tous les jetons sont morts (inutile de réessayer).
        const done = sent || bad.length === ios.length;
        stats.bad_tokens += bad.length;
        if (sent) stats.sent++;
        else if (!done) stats.retry++;
        await rpc('push_result', { p_id: n.id, p_ok: done, p_error: done ? null : 'apns_unavailable', p_bad_tokens: bad });
      }
      deps.log('run_done', stats);
      return jsonResponse(200, { ok: true, ...stats });
    } catch (error) {
      deps.log('server_error', { reason: error instanceof RpcError ? `http_${String(error.status)}` : error instanceof z.ZodError ? 'invalid_payload' : 'exception' });
      return jsonResponse(500, { ok: false, error: 'server_error' });
    }
  };
}
