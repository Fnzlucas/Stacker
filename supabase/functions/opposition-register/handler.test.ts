import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { createHandler } from './handler.ts';

const ORIGIN = 'https://stacker.example';
const SB = 'https://proj.supabase.co';
const ENV = {
  SUPABASE_URL: SB,
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-factice-pour-les-tests',
  ALLOWED_ORIGINS: ORIGIN,
  RATE_LIMIT_PEPPER: 'pepper-0123456789abcdef',
  TURNSTILE_SECRET_KEY: 'turnstile-secret-test',
};
const TOKEN = 'ab'.repeat(24);

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(s: { rate?: boolean; tokenResult?: boolean; turnstile?: boolean; throwOn?: string } = {}, env: Record<string, string | undefined> = ENV) {
  const calls: { url: string; body: unknown }[] = [];
  const logs: { event: string; data?: Record<string, unknown> }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? null });
    if (s.throwOn && url.includes(s.throwOn)) throw new Error('réseau');
    if (url.endsWith('/rpc/rate_limit_hit')) return res(200, s.rate ?? true);
    if (url.endsWith('/rpc/opposition_register_token')) return res(200, s.tokenResult ?? true);
    if (url.endsWith('/rpc/opposition_register_form')) return res(200, true);
    if (url.includes('turnstile')) return res(200, { success: s.turnstile ?? true });
    return res(404, {});
  };
  return { handle: createHandler({ config: loadConfig(env), fetch: fetchFn, log: (event, data) => logs.push({ event, data }), uuid: () => 'id' }), calls, logs };
}

function request(body: unknown, opts: { origin?: string | null; method?: string } = {}) {
  const headers = new Headers({ 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
  if (opts.origin !== null) headers.set('origin', opts.origin ?? ORIGIN);
  const method = opts.method ?? 'POST';
  return new Request(`${SB}/functions/v1/opposition-register`, { method, headers, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
}

const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe('opposition-register', () => {
  it('lien de l’email : réponse identique, jeton valide ou non (pas d’énumération)', async () => {
    const valid = setup({ tokenResult: true });
    const unknown = setup({ tokenResult: false });
    const a = await valid.handle(request({ token: TOKEN }));
    const b = await unknown.handle(request({ token: TOKEN }));
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await json(a)).toEqual(await json(b));
    expect(valid.calls.some((c) => c.url.includes('turnstile'))).toBe(false);
  });

  it('jeton mal formé ⇒ 400 sans appel', async () => {
    const { handle, calls } = setup();
    expect((await handle(request({ token: 'xyz' }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('formulaire : Turnstile vérifié, puis enregistrement', async () => {
    const { handle, calls, logs } = setup();
    const r = await handle(request({ siren: '123 456 789', email: 'Contact@Exemple.fr', turnstileToken: 'tok' }));
    expect(r.status).toBe(200);
    expect(calls.find((c) => c.url.endsWith('/rpc/opposition_register_form'))?.body).toEqual({ p_siren: '123456789', p_email: 'contact@exemple.fr' });
    expect(JSON.stringify(logs)).not.toMatch(/123456789|exemple|203\.0/);
  });

  it('formulaire : Turnstile refusé ⇒ 403, rien d’enregistré', async () => {
    const { handle, calls } = setup({ turnstile: false });
    const r = await handle(request({ siren: '123456789', turnstileToken: 'tok' }));
    expect(await json(r)).toEqual({ ok: false, error: 'captcha_failed' });
    expect(calls.some((c) => c.url.endsWith('/rpc/opposition_register_form'))).toBe(false);
  });

  it('formulaire vide ⇒ 400', async () => {
    expect((await setup().handle(request({ turnstileToken: 'tok' }))).status).toBe(400);
  });

  it('rate limit par IP (hachée)', async () => {
    const { handle, calls } = setup({ rate: false });
    const r = await handle(request({ token: TOKEN }));
    expect(r.status).toBe(429);
    const bucket = (calls[0]?.body as { p_bucket: string }).p_bucket;
    expect(bucket).toMatch(/^opposition:[0-9a-f]{64}$/);
    expect(bucket).not.toContain('203.0.113.7');
  });

  it('refus : origine, méthode, type, taille', async () => {
    const { handle } = setup();
    expect((await handle(request({ token: TOKEN }, { origin: 'https://pirate.example' }))).status).toBe(403);
    expect((await handle(request({}, { method: 'OPTIONS' }))).status).toBe(204);
    expect((await handle(request({}, { method: 'GET' }))).status).toBe(405);
    expect((await handle(request('x'.repeat(7000)))).status).toBe(413);
    expect((await handle(request('{'))).status).toBe(400);
  });

  it('panne serveur ⇒ 500 ; configuration : Turnstile obligatoire sauf désactivation explicite', async () => {
    expect((await setup({ throwOn: 'opposition_register_token' }).handle(request({ token: TOKEN }))).status).toBe(500);
    expect(loadConfig({ ...ENV, TURNSTILE_SECRET_KEY: '' })).toEqual({ ok: false, missing: ['TURNSTILE_SECRET_KEY'] });
    const off = setup({}, { ...ENV, TURNSTILE_SECRET_KEY: undefined, TURNSTILE_DISABLED: '1' });
    expect((await off.handle(request({ siren: '123456789', turnstileToken: '' }))).status).toBe(200);
    expect(off.calls.some((c) => c.url.includes('turnstile'))).toBe(false);
    const broken = setup({}, { ...ENV, SUPABASE_URL: 'pas-une-url' });
    expect((await broken.handle(request({ token: TOKEN }))).status).toBe(503);
  });
});
