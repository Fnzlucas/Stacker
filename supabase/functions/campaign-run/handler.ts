/**
 * Envoi des emails de campagne (tâche planifiée, toutes les 2 minutes en
 * semaine). Prend les prochains emails dus (au plus un par stacker et par
 * passage, espacement et plafond calculés en base), rafraîchit l'accès à la
 * boîte du stacker, envoie, puis enregistre le résultat. Une boîte refusée
 * (jeton révoqué) passe en erreur : le stacker est invité à la reconnecter.
 * Journaux sans destinataire, objet ni identifiant.
 */
import { z } from 'zod';
import { callRpc, RpcError, type FetchLike } from '../_shared/rest.ts';
import { jsonResponse } from '../_shared/http.ts';
import { OAuthError, SendError, decryptToken, refreshAccessToken, sendMail, unsubscribeUrlFrom } from '../_shared/mail.ts';
import type { MailConfigResult } from '../_shared/mailConfig.ts';

export const BATCH = 50;
export const CONCURRENCY = 5;

export interface HandlerDeps {
  config: MailConfigResult;
  fetch: FetchLike;
  log: (event: string, data?: Record<string, string | number | boolean | string[]>) => void;
  uuid?: () => string;
}

const messagesSchema = z.array(
  z.object({
    id: z.uuid(),
    stacker_id: z.uuid(),
    provider: z.enum(['gmail', 'outlook']),
    from_email: z.string(),
    token_enc: z.string(),
    recipient: z.string(),
    subject: z.string(),
    text: z.string(),
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
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  if (!deps.config.ok) deps.log('config_invalid', { variables: deps.config.missing });
  return async function handle(req: Request): Promise<Response> {
    if (!deps.config.ok) return jsonResponse(503, { ok: false, error: 'unavailable' });
    const config = deps.config.config;
    const cronSecret = config.cronSecret;
    if (!cronSecret) return jsonResponse(503, { ok: false, error: 'unavailable' });
    if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'method_not_allowed' });
    if (!sameSecret(req.headers.get('x-cron-secret') ?? '', cronSecret)) return jsonResponse(403, { ok: false, error: 'forbidden' });
    const rpc = (fn: string, args: Record<string, unknown>) => callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, fn, args);
    const stats = { sent: 0, failed: 0, revoked: 0 };
    try {
      const messages = messagesSchema.parse(await rpc('campaign_next_messages', { p_limit: BATCH }));
      for (let i = 0; i < messages.length; i += CONCURRENCY) {
        await Promise.all(
          messages.slice(i, i + CONCURRENCY).map(async (m) => {
            const client = config.clients[m.provider];
            try {
              if (!client) throw new SendError('provider_unavailable', false);
              const refresh = await decryptToken(config.tokenKey, m.token_enc);
              const access = await refreshAccessToken(deps.fetch, m.provider, client, refresh);
              const domain = m.from_email.split('@')[1] ?? 'stacker.local';
              const providerId = await sendMail(deps.fetch, m.provider, access, { from: m.from_email, to: m.recipient, subject: m.subject, text: m.text, unsubscribeUrl: unsubscribeUrlFrom(m.text) }, `${uuid()}@${domain}`);
              await rpc('campaign_message_result', { p_id: m.id, p_ok: true, p_provider_id: providerId, p_error: null, p_auth_error: false });
              stats.sent++;
            } catch (error) {
              const revoked = (error instanceof OAuthError || error instanceof SendError) && error.revoked;
              const code = error instanceof OAuthError || error instanceof SendError ? error.code : 'exception';
              if (revoked) stats.revoked++;
              else stats.failed++;
              await rpc('campaign_message_result', { p_id: m.id, p_ok: false, p_provider_id: null, p_error: code, p_auth_error: revoked }).catch(() => undefined);
            }
          }),
        );
      }
      deps.log('run_done', stats);
      return jsonResponse(200, { ok: true, ...stats });
    } catch (error) {
      deps.log('server_error', { reason: error instanceof RpcError ? `http_${String(error.status)}` : error instanceof z.ZodError ? 'invalid_payload' : 'exception' });
      return jsonResponse(500, { ok: false, error: 'server_error' });
    }
  };
}
