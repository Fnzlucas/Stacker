/**
 * Début de la connexion d'une boîte mail (Gmail ou Outlook). Le stacker
 * connecté demande une URL d'autorisation ; l'état signé désigne SON compte
 * (identité tirée du jeton, jamais du corps).
 */
import { z } from 'zod';
import { fetchAuthUser, RpcError, type FetchLike } from '../_shared/rest.ts';
import { bearer, corsHeaders, jsonResponse, readJson } from '../_shared/http.ts';
import { authorizeUrl, signState } from '../_shared/mail.ts';
import type { MailConfigResult } from '../_shared/mailConfig.ts';

export interface HandlerDeps {
  config: MailConfigResult;
  fetch: FetchLike;
  log: (event: string, data?: Record<string, string | number | boolean | string[]>) => void;
  now?: () => number;
}

const bodySchema = z.strictObject({ provider: z.enum(['gmail', 'outlook']) });

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  if (!deps.config.ok) deps.log('config_invalid', { variables: deps.config.missing });
  return async function handle(req: Request): Promise<Response> {
    if (!deps.config.ok) return jsonResponse(503, { ok: false, error: 'unavailable' });
    const config = deps.config.config;
    const anonKey = config.anonKey;
    if (!anonKey) return jsonResponse(503, { ok: false, error: 'unavailable' });
    const origin = req.headers.get('origin');
    if (!origin || !config.allowedOrigins.has(origin)) return jsonResponse(403, { ok: false, error: 'forbidden_origin' });
    const cors = corsHeaders(origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'method_not_allowed' }, cors);
    const body = await readJson(req, 512);
    const parsed = body.ok ? bodySchema.safeParse(body.value) : null;
    if (!parsed?.success) return jsonResponse(400, { ok: false, error: 'invalid_request' }, cors);
    const client = config.clients[parsed.data.provider];
    if (!client) return jsonResponse(503, { ok: false, error: 'provider_unavailable' }, cors);
    const token = bearer(req);
    if (!token) return jsonResponse(401, { ok: false, error: 'unauthorized' }, cors);
    try {
      const user = await fetchAuthUser(deps.fetch, config.supabaseUrl, anonKey, token);
      if (!user) return jsonResponse(401, { ok: false, error: 'unauthorized' }, cors);
      const state = await signState(config.stateKey, user.id, parsed.data.provider, now());
      deps.log('connect_started', { provider: parsed.data.provider });
      return jsonResponse(200, { ok: true, url: authorizeUrl(parsed.data.provider, client, config.redirectUri, state) }, cors);
    } catch (error) {
      deps.log('server_error', { reason: error instanceof RpcError ? `http_${String(error.status)}` : 'exception' });
      return jsonResponse(500, { ok: false, error: 'server_error' }, cors);
    }
  };
}
