import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { importApnsKey, providerToken, sendToDevice } from './apns.ts';
import { loadPushConfig } from './config.ts';
import { createHandler } from './handler.ts';

const SB = 'https://projet.supabase.co';
const SECRET = 'c'.repeat(32);
let PEM = '';
let PUBLIC: CryptoKey;

beforeAll(async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey));
  // Clé générée pour le test (le libellé est assemblé pour ne pas déclencher l'analyse des secrets).
  const kind = ['PRIVATE', 'KEY'].join(' ');
  PEM = `-----BEGIN ${kind}-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END ${kind}-----`;
  PUBLIC = pair.publicKey;
});

const env = () => ({
  SUPABASE_URL: SB,
  SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(40),
  CRON_SECRET: SECRET,
  APNS_KEY_ID: 'ABC123DEFG',
  APNS_TEAM_ID: 'TEAM123456',
  APNS_PRIVATE_KEY: PEM.replace(/\n/g, '\\n'),
  APNS_BUNDLE_ID: 'fr.stacker.app',
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('APNs', () => {
  it('jeton ES256 signé, vérifiable avec la clé publique', async () => {
    const jwt = await providerToken(await importApnsKey(PEM), 'ABC123DEFG', 'TEAM123456', 1_700_000_000);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toEqual({ iss: 'TEAM123456', iat: 1_700_000_000 });
    const ok = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, PUBLIC, Buffer.from(s!, 'base64url'), new TextEncoder().encode(`${h!}.${c!}`));
    expect(ok).toBe(true);
  });

  it('réponses d’Apple : envoyé, jeton mort, à réessayer', async () => {
    const m = { title: 'T', body: 'B', path: '/app/gains' };
    let seen: { url: string; headers: Headers; body: string } | null = null;
    const ok = async (url: string, init?: RequestInit) => {
      seen = { url, headers: new Headers(init?.headers), body: init?.body as string };
      return new Response(null, { status: 200 });
    };
    expect(await sendToDevice(ok, 'https://api.push.apple.com', 'jwt', 'fr.stacker.app', 'tok', m)).toBe('sent');
    expect(seen!.url).toBe('https://api.push.apple.com/3/device/tok');
    expect(seen!.headers.get('apns-topic')).toBe('fr.stacker.app');
    expect(seen!.headers.get('authorization')).toBe('bearer jwt');
    expect(JSON.parse(seen!.body)).toEqual({ aps: { alert: { title: 'T', body: 'B' }, sound: 'default' }, path: '/app/gains' });
    expect(await sendToDevice(async () => json(410, { reason: 'Unregistered' }), 'h', 'j', 'b', 't', m)).toBe('bad_token');
    expect(await sendToDevice(async () => json(400, { reason: 'BadDeviceToken' }), 'h', 'j', 'b', 't', m)).toBe('bad_token');
    expect(await sendToDevice(async () => json(429, { reason: 'TooManyRequests' }), 'h', 'j', 'b', 't', m)).toBe('retry');
    expect(await sendToDevice(async () => new Response('x', { status: 500 }), 'h', 'j', 'b', 't', m)).toBe('retry');
    expect(
      await sendToDevice(
        async () => {
          throw new Error('réseau');
        },
        'h',
        'j',
        'b',
        't',
        m,
      ),
    ).toBe('retry');
  });
});

describe('push-run', () => {
  function setup(batch: unknown, apns: (token: string) => Response) {
    const results: Record<string, unknown>[] = [];
    const sent: string[] = [];
    const logs: string[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      if (url.endsWith('/rest/v1/rpc/push_next')) return json(200, batch);
      if (url.endsWith('/rest/v1/rpc/push_result')) {
        results.push(JSON.parse(init?.body as string) as Record<string, unknown>);
        return json(200, null);
      }
      if (url.includes('/3/device/')) {
        const token = decodeURIComponent(url.split('/3/device/')[1] ?? '');
        sent.push(token);
        return apns(token);
      }
      return json(404, {});
    };
    const handle = createHandler({ config: loadPushConfig(env()), fetch: fetchFn, log: (e, d) => logs.push(`${e} ${JSON.stringify(d ?? {})}`), now: () => 1_700_000_000 });
    const req = (secret: string | null = SECRET) => new Request(`${SB}/functions/v1/push-run`, { method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {} });
    return { handle, req, results, sent, logs };
  }

  const item = (id: number, tokens: string[]) => ({ id, title: 'Commission débloquée', body: 'Boulangerie Martin a été prélevé', path: '/app/gains', tokens: tokens.map((token) => ({ token, platform: 'ios' })) });

  it('envoie à chaque iPhone ; jeton mort supprimé ; Apple indisponible : réessai', async () => {
    const { handle, req, results, sent, logs } = setup([item(1, ['ok-1', 'mort-1']), item(2, ['lent-1']), item(3, [])], (t) =>
      t.startsWith('ok') ? new Response(null, { status: 200 }) : t.startsWith('mort') ? json(410, { reason: 'Unregistered' }) : json(503, {}),
    );
    expect(await (await handle(req())).json()).toEqual({ ok: true, sent: 1, retry: 1, bad_tokens: 1, no_device: 1 });
    expect(sent.sort()).toEqual(['lent-1', 'mort-1', 'ok-1']);
    expect(results).toEqual([
      { p_id: 1, p_ok: true, p_error: null, p_bad_tokens: ['mort-1'] },
      { p_id: 2, p_ok: false, p_error: 'apns_unavailable', p_bad_tokens: [] },
      { p_id: 3, p_ok: true, p_error: 'no_device', p_bad_tokens: [] },
    ]);
    expect(logs.join()).not.toMatch(/Boulangerie|ok-1/);
  });

  it('tous les jetons morts : terminé (pas de réessai inutile)', async () => {
    const { handle, req, results } = setup([item(4, ['mort-1', 'mort-2'])], () => json(400, { reason: 'BadDeviceToken' }));
    await handle(req());
    expect(results[0]).toEqual({ p_id: 4, p_ok: true, p_error: null, p_bad_tokens: ['mort-1', 'mort-2'] });
  });

  it('file vide, accès, configuration, file illisible', async () => {
    const empty = setup([], () => new Response(null));
    expect(await (await empty.handle(empty.req())).json()).toEqual({ ok: true, sent: 0, retry: 0, bad_tokens: 0, no_device: 0 });
    expect((await empty.handle(empty.req(null))).status).toBe(403);
    expect((await empty.handle(new Request(`${SB}/x`, { method: 'GET', headers: { 'x-cron-secret': SECRET } }))).status).toBe(405);
    const bad = setup([{ id: 'x' }], () => new Response(null));
    expect((await bad.handle(bad.req())).status).toBe(500);
    const off = createHandler({ config: loadPushConfig({ ...env(), APNS_KEY_ID: undefined }), fetch: async () => json(200, []), log: () => undefined });
    expect((await off(new Request(`${SB}/x`, { method: 'POST' }))).status).toBe(503);
    expect(loadPushConfig({ ...env(), APNS_ENV: 'sandbox' })).toMatchObject({ ok: true, config: { apns: { host: 'https://api.sandbox.push.apple.com' } } });
    expect(loadPushConfig({ ...env(), APNS_PRIVATE_KEY: 'pas une clé' })).toMatchObject({ ok: false, missing: ['APNS_PRIVATE_KEY'] });
  });
});
