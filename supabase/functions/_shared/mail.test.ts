import { describe, expect, it } from 'vitest';
import {
  GMAIL_SEND,
  GOOGLE_TOKEN,
  MS_ME,
  MS_SEND,
  MS_TOKEN,
  OAuthError,
  SendError,
  authorizeUrl,
  b64url,
  buildMime,
  decryptToken,
  encryptToken,
  exchangeCode,
  fromB64url,
  refreshAccessToken,
  sendMail,
  signState,
  unsubscribeUrlFrom,
  verifyState,
} from './mail.ts';
import { loadMailConfig } from './mailConfig.ts';

const KEY = b64url(new Uint8Array(32).fill(7));
const KEY2 = b64url(new Uint8Array(32).fill(9));
const USER = '11111111-1111-4111-8111-111111111111';
const CLIENT = { clientId: 'client-id', clientSecret: 'client-secret' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const idToken = (payload: Record<string, unknown>) => `x.${b64url(new TextEncoder().encode(JSON.stringify(payload)))}.y`;

describe('chiffrement des jetons', () => {
  it('aller-retour, iv aléatoire, clé fausse ou format altéré refusés', async () => {
    const a = await encryptToken(KEY, '1//jeton-de-rafraichissement');
    const b = await encryptToken(KEY, '1//jeton-de-rafraichissement');
    expect(a).not.toBe(b);
    expect(a).not.toContain('jeton');
    expect(await decryptToken(KEY, a)).toBe('1//jeton-de-rafraichissement');
    await expect(decryptToken(KEY2, a)).rejects.toThrow();
    // Un caractère du MILIEU du chiffré altéré (le dernier peut ne porter que des bits de remplissage).
    const parts = a.split('.');
    const ct = parts[2] ?? '';
    const i = Math.floor(ct.length / 2);
    const tampered = `${parts[0] ?? ''}.${parts[1] ?? ''}.${ct.slice(0, i)}${ct[i] === 'A' ? 'B' : 'A'}${ct.slice(i + 1)}`;
    await expect(decryptToken(KEY, tampered)).rejects.toThrow();
    await expect(decryptToken(KEY, 'v2.x.y')).rejects.toThrow();
    await expect(encryptToken(b64url(new Uint8Array(16)), 'x')).rejects.toThrow();
  });
});

describe('état OAuth signé', () => {
  it('valide 10 minutes, infalsifiable', async () => {
    const s = await signState(KEY, USER, 'gmail', 1000);
    expect(await verifyState(KEY, s, 1500)).toEqual({ userId: USER, provider: 'gmail' });
    expect(await verifyState(KEY, s, 1700)).toBeNull();
    expect(await verifyState(KEY2, s, 1500)).toBeNull();
    const [payload] = s.split('.');
    const forged = b64url(new TextEncoder().encode(JSON.stringify({ u: '22222222-2222-4222-8222-222222222222', p: 'gmail', e: 9999, n: 'abcdefghij' })));
    expect(await verifyState(KEY, `${forged}.${s.split('.')[1] ?? ''}`, 1500)).toBeNull();
    expect(await verifyState(KEY, `${payload ?? ''}.court`, 1500)).toBeNull();
    expect(await verifyState(KEY, 'n-importe-quoi', 1500)).toBeNull();
    const bad = b64url(new TextEncoder().encode('{"u":"pas-un-uuid"}'));
    const { webcrypto } = await import('node:crypto');
    const k = await webcrypto.subtle.importKey('raw', fromB64url(KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = b64url(new Uint8Array(await webcrypto.subtle.sign('HMAC', k, new TextEncoder().encode(bad))));
    expect(await verifyState(KEY, `${bad}.${sig}`, 1500)).toBeNull();
  });
});

describe('OAuth', () => {
  it('URL d’autorisation : périmètres minimaux', () => {
    const g = new URL(authorizeUrl('gmail', CLIENT, 'https://p.supabase.co/functions/v1/mail-callback', 'etat'));
    expect(g.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/gmail.send');
    expect(g.searchParams.get('access_type')).toBe('offline');
    expect(g.searchParams.get('state')).toBe('etat');
    const m = new URL(authorizeUrl('outlook', CLIENT, 'https://p.supabase.co/functions/v1/mail-callback', 'etat'));
    expect(m.searchParams.get('scope')).toBe('offline_access openid email User.Read Mail.Send');
    expect(m.origin).toBe('https://login.microsoftonline.com');
  });

  it('Gmail : échange du code, adresse vérifiée, périmètre exigé', async () => {
    const ok = await exchangeCode(async (url, init) => {
      expect(url).toBe(GOOGLE_TOKEN);
      expect((init?.body as string)).toContain('grant_type=authorization_code');
      return json(200, { access_token: 'a', refresh_token: 'r', scope: 'openid https://www.googleapis.com/auth/gmail.send', id_token: idToken({ email: 'Ines@Gmail.com', email_verified: true }) });
    }, 'gmail', CLIENT, 'https://cb', 'code');
    expect(ok).toEqual({ email: 'ines@gmail.com', refreshToken: 'r' });
    await expect(exchangeCode(async () => json(200, { access_token: 'a', scope: 'https://www.googleapis.com/auth/gmail.send' }), 'gmail', CLIENT, 'https://cb', 'c')).rejects.toMatchObject({ code: 'no_refresh_token' });
    await expect(exchangeCode(async () => json(200, { access_token: 'a', refresh_token: 'r', scope: 'openid email' }), 'gmail', CLIENT, 'https://cb', 'c')).rejects.toMatchObject({ code: 'scope_refused' });
    await expect(
      exchangeCode(async () => json(200, { access_token: 'a', refresh_token: 'r', scope: 'https://www.googleapis.com/auth/gmail.send', id_token: idToken({ email: 'x@y.fr', email_verified: false }) }), 'gmail', CLIENT, 'https://cb', 'c'),
    ).rejects.toMatchObject({ code: 'no_email' });
    await expect(exchangeCode(async () => json(400, { error: 'invalid_grant' }), 'gmail', CLIENT, 'https://cb', 'c')).rejects.toMatchObject({ code: 'invalid_grant', revoked: true });
    await expect(exchangeCode(async () => new Response('<html>', { status: 502 }), 'gmail', CLIENT, 'https://cb', 'c')).rejects.toMatchObject({ code: 'http_502' });
    await expect(exchangeCode(async () => json(200, { pas: 'un jeton' }), 'gmail', CLIENT, 'https://cb', 'c')).rejects.toMatchObject({ code: 'invalid_token_response' });
  });

  it('Outlook : adresse lue sur /me', async () => {
    const r = await exchangeCode(async (url) => (url === MS_TOKEN ? json(200, { access_token: 'a', refresh_token: 'r' }) : url === MS_ME ? json(200, { mail: 'Ines@Outlook.fr' }) : json(404, {})), 'outlook', CLIENT, 'https://cb', 'c');
    expect(r).toEqual({ email: 'ines@outlook.fr', refreshToken: 'r' });
    await expect(exchangeCode(async (url) => (url === MS_TOKEN ? json(200, { access_token: 'a', refresh_token: 'r' }) : json(500, {})), 'outlook', CLIENT, 'https://cb', 'c')).rejects.toMatchObject({ code: 'no_email' });
    await expect(exchangeCode(async () => json(200, { access_token: 'a' }), 'outlook', CLIENT, 'https://cb', 'c')).rejects.toMatchObject({ code: 'no_refresh_token' });
  });

  it('rafraîchissement', async () => {
    expect(await refreshAccessToken(async () => json(200, { access_token: 'nouveau' }), 'gmail', CLIENT, 'r')).toBe('nouveau');
    expect(await refreshAccessToken(async (_u, init) => ((init?.body as string).includes('Mail.Send') ? json(200, { access_token: 'ms' }) : json(400, {})), 'outlook', CLIENT, 'r')).toBe('ms');
    await expect(refreshAccessToken(async () => json(400, { error: 'invalid_grant' }), 'gmail', CLIENT, 'r')).rejects.toBeInstanceOf(OAuthError);
  });
});

describe('envoi', () => {
  const mail = { from: 'ines@gmail.com', to: 'contact@plomberie-durand.fr', subject: 'Plomberie Durand : votre visibilité', text: 'Bonjour,\n\nPour ne plus être contacté : https://s.fr/opposition?t=' + 'a'.repeat(48), unsubscribeUrl: 'https://s.fr/opposition?t=' + 'a'.repeat(48) };

  it('MIME : UTF-8, objet encodé, désinscription, injection d’en-têtes impossible', () => {
    const mime = buildMime({ ...mail, to: 'x@y.fr\r\nBcc: victime@z.fr' }, 'id@gmail.com');
    expect(mime).toContain('Subject: =?UTF-8?B?');
    expect(mime).toContain('List-Unsubscribe: <https://s.fr/opposition?t=');
    expect(mime).not.toMatch(/\r\nBcc:/);
    expect(mime).toContain('To: x@y.fr Bcc: victime@z.fr');
    const body = mime.split('\r\n\r\n')[1] ?? '';
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe(mail.text);
    expect(buildMime({ ...mail, subject: 'ascii', unsubscribeUrl: null }, 'id')).toContain('Subject: ascii');
  });

  it('Gmail et Outlook', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const ok = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse((init?.body as string)) });
      return url === GMAIL_SEND ? json(200, { id: 'gmail-id' }) : new Response(null, { status: 202 });
    };
    expect(await sendMail(ok, 'gmail', 'acc', mail, 'm1@gmail.com')).toBe('gmail-id');
    expect(await sendMail(ok, 'outlook', 'acc', mail, 'm2@outlook.fr')).toBe('m2@outlook.fr');
    expect(calls[0]?.url).toBe(GMAIL_SEND);
    expect(calls[1]).toMatchObject({ url: MS_SEND, body: { message: { subject: mail.subject, toRecipients: [{ emailAddress: { address: mail.to } }] }, saveToSentItems: true } });
    await expect(sendMail(async () => json(401, {}), 'gmail', 'acc', mail, 'm')).rejects.toMatchObject({ revoked: true });
    await expect(sendMail(async () => json(429, {}), 'outlook', 'acc', mail, 'm')).rejects.toEqual(new SendError('http_429', false));
    expect(await sendMail(async () => new Response('pas json', { status: 200 }), 'gmail', 'acc', mail, 'm3')).toBe('m3');
  });

  it('lien de désinscription extrait du pied', () => {
    expect(unsubscribeUrlFrom(mail.text)).toBe(mail.unsubscribeUrl);
    expect(unsubscribeUrlFrom('rien')).toBeNull();
  });
});

describe('configuration', () => {
  const ENV = { SUPABASE_URL: 'https://p.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'cle-service-factice-pour-les-tests', SITE_URL: 'https://s.fr/', MAIL_TOKEN_KEY: KEY, MAIL_STATE_KEY: KEY2 };
  it('fournisseurs facultatifs, clés obligatoires', () => {
    const c = loadMailConfig({ ...ENV, GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', ALLOWED_ORIGINS: 'https://s.fr' });
    expect(c).toMatchObject({ ok: true, config: { redirectUri: 'https://p.supabase.co/functions/v1/mail-callback', siteUrl: 'https://s.fr', cronSecret: null, anonKey: null } });
    expect(c.ok && Object.keys(c.config.clients)).toEqual(['gmail']);
    expect(loadMailConfig({ ...ENV, MAIL_TOKEN_KEY: 'trop-court' })).toEqual({ ok: false, missing: ['MAIL_TOKEN_KEY'] });
    expect(loadMailConfig({ ...ENV, MAIL_STATE_KEY: '***' }).ok).toBe(false);
  });
});
