/**
 * Appels réseau de la fonction : Cloudflare Turnstile, PostgREST (RPC
 * Supabase) et Brevo. Chaque appel a un délai maximal et ne journalise
 * jamais de donnée personnelle.
 */
import { z } from 'zod';

import type { FetchLike } from '../_shared/rest.ts';

export { RpcError, callRpc, supabaseAuthHeaders, type FetchLike } from '../_shared/rest.ts';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

const turnstileResponseSchema = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).optional(),
  action: z.string().optional(),
  hostname: z.string().optional(),
});

export interface TurnstileResult {
  success: boolean;
  errorCodes: string[];
}

/** Vérifie un jeton Turnstile côté serveur (siteverify). Toute erreur réseau = échec. */
export async function verifyTurnstile(
  fetchFn: FetchLike,
  secret: string,
  token: string,
  remoteIp: string | null,
  idempotencyKey: string,
): Promise<TurnstileResult> {
  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token);
  body.set('idempotency_key', idempotencyKey);
  if (remoteIp) body.set('remoteip', remoteIp);
  try {
    const res = await fetchFn(TURNSTILE_VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { success: false, errorCodes: [`http_${String(res.status)}`] };
    const parsed = turnstileResponseSchema.safeParse(await res.json());
    if (!parsed.success) return { success: false, errorCodes: ['invalid_response'] };
    return { success: parsed.data.success, errorCodes: parsed.data['error-codes'] ?? [] };
  } catch {
    return { success: false, errorCodes: ['network_error'] };
  }
}

export interface EmailMessage {
  to: { email: string; name: string };
  subject: string;
  html: string;
  text: string;
  tags: string[];
}

/** Envoie un email transactionnel via l'API Brevo. Lève une erreur si Brevo refuse. */
export async function sendBrevoEmail(
  fetchFn: FetchLike,
  brevo: { apiKey: string; senderEmail: string; senderName: string },
  message: EmailMessage,
): Promise<void> {
  const res = await fetchFn(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': brevo.apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: brevo.senderEmail, name: brevo.senderName },
      to: [message.to],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
      tags: message.tags,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`brevo http ${String(res.status)}`);
}
