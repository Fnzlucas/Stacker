import { describe, expect, it } from 'vitest';
import { b64url, encryptToken, GMAIL_SEND, GOOGLE_TOKEN, MS_SEND, MS_TOKEN, signState } from '../_shared/mail.ts';
import { loadMailConfig } from '../_shared/mailConfig.ts';
import { createHandler as createRun } from './handler.ts';
import { createHandler as createConnect } from '../mail-connect/handler.ts';
import { createHandler as createCallback } from '../mail-callback/handler.ts';

const SB = 'https://proj.supabase.co';
const ORIGIN = 'https://stacker.example';
const KEY = b64url(new Uint8Array(32).fill(3));
const SKEY = b64url(new Uint8Array(32).fill(4));
const SECRET = 'secret-de-planification-0123456789';
const USER = '11111111-1111-4111-8111-111111111111';
const ENV = {
  SUPABASE_URL: SB,
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-factice-pour-les-tests',
  SUPABASE_ANON_KEY: 'sb_publishable_test_anon_key_1234',
  SITE_URL: 'https://stacker.example',
  ALLOWED_ORIGINS: ORIGIN,
  MAIL_TOKEN_KEY: KEY,
  MAIL_STATE_KEY: SKEY,
  GOOGLE_OAUTH_CLIENT_ID: 'google-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
  MS_OAUTH_CLIENT_ID: 'ms-id',
  MS_OAUTH_CLIENT_SECRET: 'ms-secret',
  CRON_SECRET: SECRET,
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const idToken = (p: Record<string, unknown>) => `x.${b64url(new TextEncoder().encode(JSON.stringify(p)))}.y`;
const config = loadMailConfig(ENV);

describe('mail-connect', () => {
  const run = (opts: { body?: unknown; origin?: string; auth?: string | null; user?: Response; env?: Record<string, string | undefined> } = {}) => {
    const handle = createConnect({ config: loadMailConfig(opts.env ?? ENV), fetch: async () => opts.user ?? json(200, { id: USER, email: 'i@x.fr' }), log: () => undefined, now: () => 1000 });
    const headers = new Headers({ origin: opts.origin ?? ORIGIN, 'content-type': 'application/json' });
    if (opts.auth !== null) headers.set('authorization', opts.auth ?? 'Bearer a.b.c');
    return handle(new Request(`${SB}/functions/v1/mail-connect`, { method: 'POST', headers, body: JSON.stringify(opts.body ?? { provider: 'gmail' }) }));
  };
  it('URL d’autorisation avec un état signé pour CE compte', async () => {
    const r = await run();
    const body = (await r.json()) as { url: string };
    const url = new URL(body.url);
    expect(url.searchParams.get('client_id')).toBe('google-id');
    expect(url.searchParams.get('redirect_uri')).toBe(`${SB}/functions/v1/mail-callback`);
    expect(url.searchParams.get('state')?.split('.')).toHaveLength(2);
  });
  it('refus : origine, jeton, corps, fournisseur non configuré', async () => {
    expect((await run({ origin: 'https://pirate.example' })).status).toBe(403);
    expect((await run({ auth: null })).status).toBe(401);
    expect((await run({ user: json(401, {}) })).status).toBe(401);
    expect((await run({ body: { provider: 'yahoo' } })).status).toBe(400);
    expect((await run({ body: { provider: 'gmail', user: 'autre' } })).status).toBe(400);
    expect((await run({ env: { ...ENV, MS_OAUTH_CLIENT_ID: '' }, body: { provider: 'outlook' } })).status).toBe(503);
    expect((await run({ env: { ...ENV, SUPABASE_ANON_KEY: undefined } })).status).toBe(503);
  });
});

describe('mail-callback', () => {
  const calls: { url: string; body: string }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: ((init?.body as string | undefined) ?? '') });
    if (url === GOOGLE_TOKEN) return json(200, { access_token: 'a', refresh_token: '1//refresh-secret', scope: 'https://www.googleapis.com/auth/gmail.send', id_token: idToken({ email: 'ines@gmail.com', email_verified: true }) });
    if (url.endsWith('/rest/v1/rpc/mail_account_save')) return json(200, null);
    return json(404, {});
  };
  const call = async (qs: string) => {
    const handle = createCallback({ config, fetch: fetchFn, log: () => undefined, now: () => 1100 });
    return handle(new Request(`${SB}/functions/v1/mail-callback?${qs}`));
  };
  it('code valide : jeton chiffré enregistré pour le compte de l’état, retour au profil', async () => {
    calls.length = 0;
    const state = await signState(SKEY, USER, 'gmail', 1000);
    const r = await call(`code=abc&state=${encodeURIComponent(state)}`);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://stacker.example/app/profil?boite=connectee');
    const save = calls.find((c) => c.url.endsWith('mail_account_save'))!;
    const args = JSON.parse(save.body) as Record<string, string>;
    expect(args).toMatchObject({ p_user: USER, p_provider: 'gmail', p_email: 'ines@gmail.com' });
    expect(args['p_token_enc']).toMatch(/^v1\./);
    expect(save.body).not.toContain('refresh-secret');
  });
  it('état faux ou expiré, refus de l’utilisateur, échec : jamais de détail', async () => {
    expect((await call('code=abc&state=faux')).headers.get('location')).toBe('https://stacker.example/app/profil?boite=erreur');
    const old = await signState(SKEY, USER, 'gmail', 0);
    expect((await call(`code=abc&state=${encodeURIComponent(old)}`)).headers.get('location')).toContain('boite=erreur');
    const state = await signState(SKEY, USER, 'gmail', 1000);
    expect((await call(`error=access_denied&state=${encodeURIComponent(state)}`)).headers.get('location')).toContain('boite=refusee');
    expect((await call(`state=${encodeURIComponent(state)}`)).headers.get('location')).toContain('boite=erreur');
    const handle = createCallback({ config, fetch: async () => json(400, { error: 'invalid_grant' }), log: () => undefined, now: () => 1100 });
    expect((await handle(new Request(`${SB}/x?code=c&state=${encodeURIComponent(state)}`))).headers.get('location')).toContain('boite=erreur');
    const scope = createCallback({ config, fetch: async () => json(200, { access_token: 'a', refresh_token: 'r', scope: 'openid' }), log: () => undefined, now: () => 1100 });
    expect((await scope(new Request(`${SB}/x?code=c&state=${encodeURIComponent(state)}`))).headers.get('location')).toContain('boite=refusee');
    expect((await handle(new Request(`${SB}/x`, { method: 'POST' }))).status).toBe(405);
  });
});

describe('campaign-run', () => {
  async function setup(opts: { refresh?: Response; send?: Response; batch?: unknown } = {}) {
    const enc = await encryptToken(KEY, '1//refresh');
    const results: Record<string, unknown>[] = [];
    const sends: { url: string; auth: string | null }[] = [];
    const logs: string[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      if (url.endsWith('/rest/v1/rpc/campaign_next_messages'))
        return json(200, opts.batch ?? [
          { id: '22222222-2222-4222-8222-222222222222', stacker_id: USER, provider: 'gmail', from_email: 'ines@gmail.com', token_enc: enc, recipient: 'contact@plomberie.fr', subject: 'Objet', text: `Bonjour\n—\nPour ne plus être contacté par Stacker : https://s.fr/opposition?t=${'b'.repeat(48)}` },
          { id: '33333333-3333-4333-8333-333333333333', stacker_id: '44444444-4444-4444-8444-444444444444', provider: 'outlook', from_email: 'bob@outlook.fr', token_enc: enc, recipient: 'contact@garage.fr', subject: 'Objet', text: 'Bonjour' },
        ]);
      if (url.endsWith('/rest/v1/rpc/campaign_message_result')) {
        results.push(JSON.parse((init?.body as string)) as Record<string, unknown>);
        return json(200, null);
      }
      if (url === GOOGLE_TOKEN || url === MS_TOKEN) return opts.refresh?.clone() ?? json(200, { access_token: 'acc' });
      if (url === GMAIL_SEND || url === MS_SEND) {
        sends.push({ url, auth: new Headers(init?.headers).get('authorization') });
        return opts.send?.clone() ?? (url === GMAIL_SEND ? json(200, { id: 'g-1' }) : new Response(null, { status: 202 }));
      }
      return json(404, {});
    };
    const handle = createRun({ config, fetch: fetchFn, log: (e, d) => logs.push(`${e} ${JSON.stringify(d ?? {})}`), uuid: () => 'uuid' });
    const req = (secret: string | null = SECRET) => new Request(`${SB}/functions/v1/campaign-run`, { method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {} });
    return { handle, req, results, sends, logs };
  }

  it('envoie depuis la boîte de chaque stacker et enregistre le résultat', async () => {
    const { handle, req, results, sends, logs } = await setup();
    expect(await (await handle(req())).json()).toEqual({ ok: true, sent: 2, failed: 0, revoked: 0 });
    expect(sends.map((s) => s.url).sort()).toEqual([GMAIL_SEND, MS_SEND].sort());
    expect(sends.every((s) => s.auth === 'Bearer acc')).toBe(true);
    expect(results.map((r) => r['p_ok'])).toEqual([true, true]);
    expect(results.find((r) => r['p_id'] === '22222222-2222-4222-8222-222222222222')?.['p_provider_id']).toBe('g-1');
    expect(logs.join()).not.toMatch(/plomberie|garage|ines|bob/);
  });

  it('jeton révoqué : boîte mise en erreur (et non échec d’envoi)', async () => {
    const { handle, req, results } = await setup({ refresh: json(400, { error: 'invalid_grant' }) });
    expect(await (await handle(req())).json()).toMatchObject({ sent: 0, revoked: 2 });
    expect(results.every((r) => r['p_auth_error'] === true && r['p_error'] === 'invalid_grant')).toBe(true);
  });

  it('refus temporaire du fournisseur : échec ordinaire (nouvel essai plus tard)', async () => {
    const { handle, req, results } = await setup({ send: json(429, {}) });
    expect(await (await handle(req())).json()).toMatchObject({ failed: 2 });
    expect(results.every((r) => r['p_ok'] === false && r['p_auth_error'] === false)).toBe(true);
  });

  it('accès : secret obligatoire ; file illisible ⇒ 500', async () => {
    const { handle, req } = await setup({ batch: [{ id: 'x' }] });
    expect((await handle(req(null))).status).toBe(403);
    expect((await handle(req())).status).toBe(500);
    const off = createRun({ config: loadMailConfig({ ...ENV, CRON_SECRET: undefined }), fetch: async () => json(200, []), log: () => undefined });
    expect((await off(req())).status).toBe(503);
    expect((await handle(new Request(`${SB}/x`, { method: 'GET', headers: { 'x-cron-secret': SECRET } }))).status).toBe(405);
  });
});
