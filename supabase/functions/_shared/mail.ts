/**
 * Boîtes mail des stackers (Gmail, Outlook) : OAuth « envoi seulement »,
 * chiffrement des jetons, état signé, envoi d'un message texte.
 *
 * Sécurité :
 *   - le jeton de rafraîchissement n'est stocké que CHIFFRÉ (AES-256-GCM,
 *     clé MAIL_TOKEN_KEY hors base) ; il ne quitte jamais les Edge Functions ;
 *   - l'aller-retour OAuth porte un état signé (HMAC-SHA256, 10 minutes) qui
 *     désigne le compte Stacker : personne ne peut rattacher sa boîte au
 *     compte d'un autre ;
 *   - périmètres minimaux : Gmail `gmail.send`, Outlook `Mail.Send`
 *     (aucune lecture des emails).
 */
import { z } from 'zod';
import type { FetchLike } from './rest.ts';

export type Provider = 'gmail' | 'outlook';

export const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
export const GOOGLE_SCOPES = 'openid email https://www.googleapis.com/auth/gmail.send';
export const GMAIL_SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
export const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
export const MS_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
export const MS_SCOPES = 'offline_access openid email User.Read Mail.Send';
export const MS_ME = 'https://graph.microsoft.com/v1.0/me';
export const MS_SEND = 'https://graph.microsoft.com/v1.0/me/sendMail';

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

// ---------------------------------------------------------------------------
// Encodages
// ---------------------------------------------------------------------------

/** Base64 brut par blocs : pas de dépassement de pile sur un gros message. */
function b64bytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const b64url = (bytes: Uint8Array): string => b64bytes(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Encodage base64 standard d'une chaîne UTF-8 (MIME). */
export function b64utf8(s: string): string {
  return b64bytes(utf8(s));
}

// ---------------------------------------------------------------------------
// Chiffrement des jetons (AES-256-GCM)
// ---------------------------------------------------------------------------

async function aesKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromB64url(keyB64);
  if (raw.byteLength !== 32) throw new Error('MAIL_TOKEN_KEY doit faire 32 octets');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptToken(keyB64: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), utf8(plain)));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

export async function decryptToken(keyB64: string, enc: string): Promise<string> {
  const [v, iv, ct] = enc.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('jeton chiffré illisible');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await aesKey(keyB64), fromB64url(ct));
  return new TextDecoder().decode(plain);
}

// ---------------------------------------------------------------------------
// État OAuth signé
// ---------------------------------------------------------------------------

const stateSchema = z.object({ u: z.uuid(), p: z.enum(['gmail', 'outlook']), e: z.number().int(), n: z.string().min(8) });

async function hmac(keyB64: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', fromB64url(keyB64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(data))));
}

export async function signState(keyB64: string, userId: string, provider: Provider, nowSec: number): Promise<string> {
  const payload = b64url(utf8(JSON.stringify({ u: userId, p: provider, e: nowSec + 600, n: b64url(crypto.getRandomValues(new Uint8Array(12))) })));
  return `${payload}.${await hmac(keyB64, payload)}`;
}

export async function verifyState(keyB64: string, state: string, nowSec: number): Promise<{ userId: string; provider: Provider } | null> {
  const [payload, sig] = state.split('.');
  if (!payload || !sig) return null;
  const expected = await hmac(keyB64, payload);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const data = stateSchema.parse(JSON.parse(new TextDecoder().decode(fromB64url(payload))));
    if (data.e < nowSec) return null;
    return { userId: data.u, provider: data.p };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function authorizeUrl(provider: Provider, client: OAuthClient, redirectUri: string, state: string): string {
  if (provider === 'gmail') {
    const q = new URLSearchParams({ client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code', scope: GOOGLE_SCOPES, access_type: 'offline', prompt: 'consent', state });
    return `${GOOGLE_AUTH}?${q.toString()}`;
  }
  const q = new URLSearchParams({ client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code', response_mode: 'query', scope: MS_SCOPES, prompt: 'select_account', state });
  return `${MS_AUTH}?${q.toString()}`;
}

const tokenSchema = z.object({ access_token: z.string(), refresh_token: z.string().optional(), id_token: z.string().optional(), scope: z.string().optional() }).loose();

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    /** true : le jeton est refusé (révoqué, expiré) ; la boîte doit être reconnectée. */
    readonly revoked = false,
  ) {
    super(code);
    this.name = 'OAuthError';
  }
}

async function tokenRequest(fetchFn: FetchLike, url: string, form: Record<string, string>): Promise<z.infer<typeof tokenSchema>> {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(10000),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = z.object({ error: z.string() }).loose().safeParse(body);
    const code = err.success ? err.data.error : `http_${String(res.status)}`;
    throw new OAuthError(code, code === 'invalid_grant' || code === 'unauthorized_client' || code === 'invalid_client');
  }
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success) throw new OAuthError('invalid_token_response');
  return parsed.data;
}

function idTokenEmail(idToken: string | undefined): string | null {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try {
    const data = z.object({ email: z.string().optional(), email_verified: z.boolean().optional(), preferred_username: z.string().optional() }).loose().parse(JSON.parse(new TextDecoder().decode(fromB64url(payload))));
    if (data.email && data.email_verified !== false) return data.email.toLowerCase();
    return null;
  } catch {
    return null;
  }
}

/** Échange le code contre les jetons ; renvoie l'adresse de la boîte et le jeton de rafraîchissement. */
export async function exchangeCode(fetchFn: FetchLike, provider: Provider, client: OAuthClient, redirectUri: string, code: string): Promise<{ email: string; refreshToken: string }> {
  const form = { code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' };
  if (provider === 'gmail') {
    const t = await tokenRequest(fetchFn, GOOGLE_TOKEN, form);
    if (!t.refresh_token) throw new OAuthError('no_refresh_token');
    if (!(t.scope ?? '').split(' ').includes('https://www.googleapis.com/auth/gmail.send')) throw new OAuthError('scope_refused');
    const email = idTokenEmail(t.id_token);
    if (!email) throw new OAuthError('no_email');
    return { email, refreshToken: t.refresh_token };
  }
  const t = await tokenRequest(fetchFn, MS_TOKEN, { ...form, scope: MS_SCOPES });
  if (!t.refresh_token) throw new OAuthError('no_refresh_token');
  const me = await fetchFn(MS_ME, { headers: { Authorization: `Bearer ${t.access_token}`, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  const profile = z.object({ mail: z.string().nullish(), userPrincipalName: z.string().nullish() }).loose().safeParse(me.ok ? await me.json() : null);
  const email = (profile.success ? (profile.data.mail ?? profile.data.userPrincipalName) : null)?.toLowerCase() ?? idTokenEmail(t.id_token);
  if (!email || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) throw new OAuthError('no_email');
  return { email, refreshToken: t.refresh_token };
}

export async function refreshAccessToken(fetchFn: FetchLike, provider: Provider, client: OAuthClient, refreshToken: string): Promise<string> {
  const form = { client_id: client.clientId, client_secret: client.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' };
  const t = await tokenRequest(fetchFn, provider === 'gmail' ? GOOGLE_TOKEN : MS_TOKEN, provider === 'gmail' ? form : { ...form, scope: MS_SCOPES });
  return t.access_token;
}

// ---------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------

export interface OutgoingMail {
  from: string;
  /** Nom affiché (« Inès Martin ») ; null : adresse seule. */
  fromName?: string | null;
  to: string;
  subject: string;
  text: string;
  /** Lien de désinscription (en-tête List-Unsubscribe, Gmail). */
  unsubscribeUrl: string | null;
}

const encodedWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64utf8(s)}?=`);
const noCrlf = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

/** « Nom <adresse> », nom encodé (RFC 2047) ou entre guillemets, protégé contre l'injection. */
export function formatAddress(email: string, name?: string | null): string {
  const addr = noCrlf(email);
  const clean = noCrlf(name ?? '').replace(/["\\<>]/g, '').slice(0, 80).trim();
  if (!clean) return addr;
  return /^[\x20-\x7e]*$/.test(clean) ? `"${clean}" <${addr}>` : `=?UTF-8?B?${b64utf8(clean)}?= <${addr}>`;
}

/** Message RFC 5322 texte (UTF-8, base64), en-têtes protégés contre l'injection. */
export function buildMime(mail: OutgoingMail, messageId: string): string {
  const headers = [
    `From: ${formatAddress(mail.from, mail.fromName)}`,
    `To: ${noCrlf(mail.to)}`,
    `Subject: ${encodedWord(noCrlf(mail.subject))}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  if (mail.unsubscribeUrl) headers.push(`List-Unsubscribe: <${noCrlf(mail.unsubscribeUrl)}>`);
  const body = (b64utf8(mail.text).match(/.{1,76}/g) ?? []).join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

export class SendError extends Error {
  constructor(
    readonly code: string,
    /** true : la boîte refuse l'accès (jeton révoqué, droits retirés) ; à reconnecter. */
    readonly revoked: boolean,
    /** Limite du fournisseur : réessayer après ce délai (secondes), sans compter d'échec. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = 'SendError';
  }
}

/** Pause après une limite de débit (par minute) ou de volume (par jour). */
export const RATE_PAUSE_SECONDS = 900;
export const DAILY_PAUSE_SECONDS = 86400;

const RATE_REASONS = new Set(['userRateLimitExceeded', 'rateLimitExceeded', 'concurrentLimitExceeded', 'ApplicationThrottled', 'MailboxConcurrency', 'TooManyRequests']);
const DAILY_REASONS = new Set(['dailyLimitExceeded', 'quotaExceeded', 'ErrorExceededMessageLimit', 'ErrorQuotaExceeded', 'ErrorMessageSubmissionBlocked']);

const providerErrorSchema = z
  .object({
    error: z
      .object({
        code: z.union([z.string(), z.number()]).optional(),
        status: z.string().optional(),
        errors: z.array(z.object({ reason: z.string().optional() }).loose()).optional(),
      })
      .loose(),
  })
  .loose();

function retryAfterHeader(res: Response): number | null {
  const v = res.headers.get('retry-after');
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/**
 * Classe une réponse en erreur de Gmail ou d'Outlook (Graph).
 *   - limite de débit ou de volume (429, 403 rateLimit, dailyLimit…) → pause ;
 *   - 401, ou 403 d'accès refusé → boîte à reconnecter ;
 *   - le reste → échec ordinaire (réessayé 3 fois).
 */
export async function classifySendFailure(res: Response): Promise<SendError> {
  const code = `http_${String(res.status)}`;
  const parsed = providerErrorSchema.safeParse(await res.json().catch(() => null));
  const reasons = new Set<string>();
  if (parsed.success) {
    const e = parsed.data.error;
    if (typeof e.code === 'string') reasons.add(e.code);
    if (e.status) reasons.add(e.status);
    for (const r of e.errors ?? []) if (r.reason) reasons.add(r.reason);
  }
  const has = (set: Set<string>) => [...reasons].some((r) => set.has(r));
  if (has(DAILY_REASONS)) return new SendError('daily_limit', false, DAILY_PAUSE_SECONDS);
  if (res.status === 429 || has(RATE_REASONS) || reasons.has('RESOURCE_EXHAUSTED')) {
    return new SendError('rate_limited', false, Math.max(retryAfterHeader(res) ?? RATE_PAUSE_SECONDS, 60));
  }
  if (res.status === 401 || res.status === 403) return new SendError(code, true);
  return new SendError(code, false);
}

/** Envoie le message depuis la boîte du stacker. Renvoie l'identifiant du fournisseur. */
export async function sendMail(fetchFn: FetchLike, provider: Provider, accessToken: string, mail: OutgoingMail, messageId: string): Promise<string> {
  const res =
    provider === 'gmail'
      ? await fetchFn(GMAIL_SEND, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ raw: b64url(utf8(buildMime(mail, messageId))) }),
          signal: AbortSignal.timeout(15000),
        })
      : await fetchFn(MS_SEND, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: { subject: mail.subject, body: { contentType: 'Text', content: mail.text }, toRecipients: [{ emailAddress: { address: mail.to } }] },
            saveToSentItems: true,
          }),
          signal: AbortSignal.timeout(15000),
        });
  if (!res.ok) throw await classifySendFailure(res);
  if (provider === 'gmail') {
    const body = z.object({ id: z.string() }).loose().safeParse(await res.json().catch(() => null));
    return body.success ? body.data.id : messageId;
  }
  return messageId;
}

/** Lien d'opposition présent dans le pied (pour l'en-tête List-Unsubscribe). */
export function unsubscribeUrlFrom(text: string): string | null {
  return /https?:\/\/[^\s]+\/opposition\?t=[0-9a-f]{48}/.exec(text)?.[0] ?? null;
}
