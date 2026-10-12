/**
 * Envoi des emails transactionnels (tâche planifiée toutes les 5 minutes,
 * protégée par CRON_SECRET) : programme les pré-notifications SEPA, prend
 * les prochains emails de la file, les rédige (PDF du contrat joint si
 * besoin), les envoie par Brevo et enregistre le résultat. Journaux sans
 * adresse, nom ni contenu.
 */
import { z } from 'zod';
import { callRpc, RpcError, type FetchLike } from '../_shared/rest.ts';
import { jsonResponse } from '../_shared/http.ts';
import type { EmailConfigResult } from './config.ts';
import { contractPdf, toBase64 } from './pdf.ts';
import { itemSchema, render, RenderError, type EmailItem } from './templates.ts';

export const BATCH = 20;
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

export interface HandlerDeps {
  config: EmailConfigResult;
  fetch: FetchLike;
  log: (event: string, data?: Record<string, string | number | boolean | string[]>) => void;
}

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

class SendError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SendError';
  }
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  if (!deps.config.ok) deps.log('config_invalid', { variables: deps.config.missing });
  return async function handle(req: Request): Promise<Response> {
    if (!deps.config.ok) return jsonResponse(503, { ok: false, error: 'unavailable' });
    const config = deps.config.config;
    if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'method_not_allowed' });
    if (!sameSecret(req.headers.get('x-cron-secret') ?? '', config.cronSecret)) return jsonResponse(403, { ok: false, error: 'forbidden' });
    const rpc = (fn: string, args: Record<string, unknown>) => callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, fn, args);

    async function send(item: EmailItem): Promise<void> {
      if (!item.to) throw new SendError('no_recipient');
      const mail = render(item, { siteUrl: config.siteUrl, contactEmail: config.contactEmail });
      const attachment: { name: string; content: string }[] = [];
      if (mail.contract) {
        const d = item.deal;
        if (!d?.contract_text || !d.contract_sha256 || !d.signature_png) throw new SendError('missing_contract');
        const pdf = await contractPdf({
          reference: d.reference,
          companyName: d.company_name,
          contractText: d.contract_text,
          contractSha256: d.contract_sha256,
          signaturePng: d.signature_png,
          signedAt: d.signed_at,
        });
        attachment.push({ name: `contrat-${d.reference}.pdf`, content: toBase64(pdf) });
      }
      const res = await deps.fetch(BREVO_URL, {
        method: 'POST',
        headers: { 'api-key': config.brevo.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: config.brevo.senderEmail, name: config.brevo.senderName },
          to: [{ email: item.to, ...(item.to_name ? { name: item.to_name } : {}) }],
          replyTo: { email: config.contactEmail },
          subject: mail.subject,
          htmlContent: mail.html,
          textContent: mail.text,
          tags: [item.kind],
          ...(attachment.length ? { attachment } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new SendError(`brevo_${String(res.status)}`);
    }

    const stats = { scheduled: 0, sent: 0, failed: 0 };
    try {
      stats.scheduled = z.number().int().parse(await rpc('email_schedule_prenotifications', {}));
      const items = z.array(itemSchema).parse(await rpc('email_next', { p_limit: BATCH }));
      for (const item of items) {
        try {
          await send(item);
          await rpc('email_result', { p_id: item.id, p_ok: true, p_error: null });
          stats.sent++;
        } catch (error) {
          stats.failed++;
          const code = error instanceof SendError || error instanceof RenderError ? error.code : 'exception';
          deps.log('send_failed', { kind: item.kind, reason: code });
          await rpc('email_result', { p_id: item.id, p_ok: false, p_error: code }).catch(() => undefined);
        }
      }
      deps.log('run_done', stats);
      return jsonResponse(200, { ok: true, ...stats });
    } catch (error) {
      deps.log('server_error', { reason: error instanceof RpcError ? `rpc_${String(error.status)}` : error instanceof z.ZodError ? 'invalid_payload' : 'exception' });
      return jsonResponse(500, { ok: false, error: 'server_error' });
    }
  };
}
