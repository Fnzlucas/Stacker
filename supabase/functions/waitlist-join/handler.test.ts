import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.ts';
import { buildConfirmationEmail } from './email.ts';
import { clientIp, createHandler, sha256Hex, type HandlerDeps } from './handler.ts';
import { RpcError, callRpc, supabaseAuthHeaders, verifyTurnstile } from './services.ts';

const ORIGIN = 'https://stacker.example';

const ENV = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'eyJfake.service.role.for.tests',
  SITE_URL: 'https://stacker.example/',
  ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:5173`,
  TURNSTILE_SECRET_KEY: 'turnstile-secret',
  RATE_LIMIT_PEPPER: 'pepper-0123456789abcdef',
  BREVO_API_KEY: 'brevo-key',
  BREVO_SENDER_EMAIL: 'bonjour@stacker.example',
  BREVO_SENDER_NAME: '',
  CONTACT_EMAIL: 'contact@stacker.example',
};

const BODY = {
  firstName: 'Inès',
  email: '  INES@exemple.fr ',
  department: '84',
  ageConfirmed: true,
  termsAccepted: true,
  marketingOptIn: true,
  referralCode: 'k7m2p9qr',
  turnstileToken: 'tok',
};

type Route = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

interface Scenario {
  rateLimit?: boolean | Response;
  turnstile?: unknown;
  join?: Response | Response[];
  brevo?: Response | Error;
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(scenario: Scenario = {}, env: Record<string, string | undefined> = ENV) {
  const calls: { url: string; body: unknown; headers: Headers }[] = [];
  const joins = Array.isArray(scenario.join) ? [...scenario.join] : null;
  const routes: Record<string, Route> = {
    'https://proj.supabase.co/rest/v1/rpc/rate_limit_hit': () =>
      scenario.rateLimit instanceof Response ? scenario.rateLimit : jsonResponse(200, scenario.rateLimit ?? true),
    'https://challenges.cloudflare.com/turnstile/v0/siteverify': () =>
      jsonResponse(200, scenario.turnstile ?? { success: true }),
    'https://proj.supabase.co/rest/v1/rpc/waitlist_join': () =>
      joins
        ? (joins.shift() ?? jsonResponse(500, {}))
        : ((scenario.join as Response | undefined) ?? jsonResponse(200, [{ queue_position: 42, code: 'ABCDEFGH', created: true }])),
    'https://api.brevo.com/v3/smtp/email': () => {
      if (scenario.brevo instanceof Error) throw scenario.brevo;
      return scenario.brevo ?? jsonResponse(201, { messageId: 'x' });
    },
  };
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body instanceof FormData ? Object.fromEntries(init.body) : init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, body, headers: new Headers(init?.headers) });
    const route = routes[url];
    if (!route) throw new Error(`URL inattendue : ${url}`);
    return route(url, init);
  });
  const pending: Promise<unknown>[] = [];
  const logs: { event: string; data?: Record<string, unknown> }[] = [];
  const deps: HandlerDeps = {
    config: loadConfig(env),
    fetch: fetchFn,
    waitUntil: (p) => pending.push(p),
    log: (event, data) => logs.push(data ? { event, data } : { event }),
    randomBytes: () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
    uuid: () => '00000000-0000-4000-8000-000000000000',
  };
  const handler = createHandler(deps);
  const urls = () => calls.map((c) => c.url);
  return { handler, calls, urls, logs, settle: () => Promise.all(pending), fetchFn };
}

function request(init: { method?: string; origin?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7, 10.0.0.1', ...init.headers });
  if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
  const method = init.method ?? 'POST';
  return new Request('https://proj.supabase.co/functions/v1/waitlist-join', {
    method,
    headers,
    body: method === 'GET' || method === 'OPTIONS' ? null : (init.raw ?? JSON.stringify(init.body ?? BODY)),
  });
}

describe('waitlist-join : succès', () => {
  it('inscrit, renvoie position et lien de parrainage, envoie l’email', async () => {
    const t = setup();
    const res = await t.handler(request());
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      ok: true,
      status: 'joined',
      position: 42,
      referralCode: 'ABCDEFGH',
      referralUrl: 'https://stacker.example/liste-attente?ref=ABCDEFGH',
    });

    await t.settle();
    expect(t.urls()).toEqual([
      'https://proj.supabase.co/rest/v1/rpc/rate_limit_hit',
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      'https://proj.supabase.co/rest/v1/rpc/waitlist_join',
      'https://api.brevo.com/v3/smtp/email',
    ]);

    const [rate, captcha, join, email] = t.calls;
    expect(rate?.body).toMatchObject({ p_max: 10, p_window_seconds: 600 });
    expect((rate?.body as { p_bucket: string }).p_bucket).toMatch(/^waitlist-join:[0-9a-f]{64}$/);
    expect(JSON.stringify(rate?.body)).not.toContain('203.0.113.7');
    expect(rate?.headers.get('apikey')).toBe(ENV.SUPABASE_SERVICE_ROLE_KEY);
    expect(rate?.headers.get('authorization')).toBe(`Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);

    expect(captcha?.body).toEqual({
      secret: 'turnstile-secret',
      response: 'tok',
      idempotency_key: '00000000-0000-4000-8000-000000000000',
      remoteip: '203.0.113.7',
    });

    expect(join?.body).toEqual({
      p_email: 'ines@exemple.fr',
      p_first_name: 'Inès',
      p_department: '84',
      p_age_confirmed: true,
      p_terms_accepted: true,
      p_marketing_opt_in: true,
      p_legal_version: '2026-10-05',
      p_referral_code: 'K7M2P9QR',
      p_new_referral_code: 'ABCDEFGH',
    });

    expect(email?.headers.get('api-key')).toBe('brevo-key');
    expect(email?.body).toMatchObject({
      sender: { email: 'bonjour@stacker.example', name: 'Stacker' },
      to: [{ email: 'ines@exemple.fr', name: 'Inès' }],
      tags: ['waitlist-confirmation'],
    });
    expect(t.logs.map((l) => l.event)).toEqual(['joined', 'email_sent']);
  });

  it('réinscription : aucune donnée de l’inscription existante (ni position, ni code), aucun email', async () => {
    const t = setup({ join: jsonResponse(200, [{ queue_position: 7, code: 'K7M2P9QR', created: false }]) });
    const res = await t.handler(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, status: 'already_registered' });
    expect(text).not.toContain('K7M2P9QR');
    await t.settle();
    expect(t.urls()).not.toContain('https://api.brevo.com/v3/smtp/email');
    expect(t.logs.map((l) => l.event)).toEqual(['rejoined']);
  });

  it('Brevo non configuré : inscription réussie, email ignoré et journalisé', async () => {
    const t = setup({}, { ...ENV, BREVO_API_KEY: '' });
    const res = await t.handler(request());
    expect(res.status).toBe(200);
    expect(t.urls()).not.toContain('https://api.brevo.com/v3/smtp/email');
    expect(t.logs.map((l) => l.event)).toEqual(['config_warning', 'joined', 'email_logged']);
    expect(t.logs.at(-1)).toEqual({ event: 'email_logged', data: { mode: 'log', template: 'waitlist-confirmation' } });
  });

  it('Turnstile absent sans désactivation explicite : 503 (fail closed), aucun appel', async () => {
    const t = setup({}, { ...ENV, TURNSTILE_SECRET_KEY: '' });
    const res = await t.handler(request());
    expect(res.status).toBe(503);
    expect(t.urls()).toEqual([]);
    expect(t.logs[0]).toEqual({ event: 'config_invalid', data: { variables: ['TURNSTILE_SECRET_KEY'] } });
  });

  it('Turnstile désactivé explicitement (TURNSTILE_DISABLED=1) : aucun appel à Cloudflare, jeton facultatif', async () => {
    const t = setup({}, { ...ENV, TURNSTILE_SECRET_KEY: '', TURNSTILE_DISABLED: '1' });
    const { turnstileToken: _omit, ...body } = BODY;
    const res = await t.handler(request({ body }));
    expect(res.status).toBe(200);
    expect(t.urls()).not.toContain('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(t.logs[0]).toEqual({ event: 'config_warning', data: { warning: 'TURNSTILE_DISABLED=1 : vérification anti-robot désactivée (interdit en production)' } });
  });

  it('échec Brevo : la réponse reste 200 et l’échec est journalisé', async () => {
    const t = setup({ brevo: jsonResponse(400, { code: 'invalid' }) });
    expect((await t.handler(request())).status).toBe(200);
    await t.settle();
    expect(t.logs.at(-1)).toEqual({ event: 'email_failed', data: { reason: 'brevo http 400' } });
  });

  it('erreur réseau Brevo : journalisée sans casser la réponse', async () => {
    const t = setup({ brevo: new Error('boom') });
    expect((await t.handler(request())).status).toBe(200);
    await t.settle();
    expect(t.logs.at(-1)).toEqual({ event: 'email_failed', data: { reason: 'boom' } });
  });

  it('collision du code de parrainage : réessaie avec un nouveau code', async () => {
    const collision = jsonResponse(400, { code: 'P0001', message: 'referral_code_collision' });
    const t = setup({ join: [collision, jsonResponse(200, [{ queue_position: 3, code: 'ABCDEFGH', created: true }])] });
    const res = await t.handler(request());
    expect(res.status).toBe(200);
    expect(t.urls().filter((u) => u.endsWith('waitlist_join'))).toHaveLength(2);
    expect(t.logs.map((l) => l.event)).toContain('referral_code_retry');
  });

  it('collisions répétées : abandonne après 3 essais (500)', async () => {
    const collision = () => jsonResponse(400, { code: 'P0001', message: 'referral_code_collision' });
    const t = setup({ join: [collision(), collision(), collision()] });
    const res = await t.handler(request());
    expect(res.status).toBe(500);
    expect(t.urls().filter((u) => u.endsWith('waitlist_join'))).toHaveLength(3);
  });

  it('sans code de parrainage ni département', async () => {
    const t = setup();
    const res = await t.handler(request({ body: { ...BODY, referralCode: undefined, department: '' } }));
    expect(res.status).toBe(200);
    expect(t.calls[2]?.body).toMatchObject({ p_referral_code: null, p_department: null });
  });
});

describe('waitlist-join : refus', () => {
  it('OPTIONS (pré-vol CORS) : 204 avec en-têtes CORS', async () => {
    const t = setup();
    const res = await t.handler(request({ method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toContain('apikey');
    expect(res.headers.get('vary')).toBe('Origin');
    expect(t.fetchFn).not.toHaveBeenCalled();
  });

  it.each([['https://evil.example'], [null]])('origine %j : 403 sans en-tête CORS', async (origin) => {
    const t = setup();
    const res = await t.handler(request({ origin }));
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(await res.json()).toEqual({ ok: false, error: 'forbidden_origin' });
    expect(t.fetchFn).not.toHaveBeenCalled();
  });

  it('méthode GET : 405', async () => {
    const res = await setup().handler(request({ method: 'GET' }));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST, OPTIONS');
  });

  it('type de contenu non JSON : 415', async () => {
    const res = await setup().handler(request({ headers: { 'content-type': 'text/plain' } }));
    expect(res.status).toBe(415);
  });

  it('corps trop gros (déclaré ou réel) : 413', async () => {
    const big = JSON.stringify({ ...BODY, turnstileToken: 'x'.repeat(9000) });
    const t = setup();
    expect((await t.handler(request({ raw: big }))).status).toBe(413);
    expect((await t.handler(request({ raw: '{}', headers: { 'content-length': '999999' } }))).status).toBe(413);
    expect(t.fetchFn).not.toHaveBeenCalled();
  });

  it('JSON invalide : 400 avec CORS', async () => {
    const res = await setup().handler(request({ raw: '{pas du json' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_request' });
  });

  it('validation Zod : 400 avec erreurs par champ, aucun appel réseau', async () => {
    const t = setup();
    const res = await t.handler(request({ body: { ...BODY, email: 'nope', ageConfirmed: false } }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fields: Record<string, string> };
    expect(body.error).toBe('invalid_request');
    expect(Object.keys(body.fields).sort()).toEqual(['ageConfirmed', 'email']);
    expect(t.fetchFn).not.toHaveBeenCalled();
  });

  it('Turnstile activé mais jeton absent : 403 sans appeler Cloudflare ni insérer', async () => {
    const t = setup();
    const { turnstileToken: _omit, ...body } = BODY;
    const res = await t.handler(request({ body }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'captcha_failed' });
    expect(t.urls()).toEqual(['https://proj.supabase.co/rest/v1/rpc/rate_limit_hit']);
  });

  it('rate limit dépassé : 429 avec Retry-After, Turnstile non appelé', async () => {
    const t = setup({ rateLimit: false });
    const res = await t.handler(request());
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('600');
    expect(t.urls()).toEqual(['https://proj.supabase.co/rest/v1/rpc/rate_limit_hit']);
  });

  it('rate limiter indisponible : 500 (fail closed)', async () => {
    const t = setup({ rateLimit: jsonResponse(503, { message: 'down' }) });
    const res = await t.handler(request());
    expect(res.status).toBe(500);
    expect(t.logs.at(-1)).toEqual({ event: 'server_error', data: { reason: 'rpc_503_none' } });
  });

  it.each([
    [{ success: false, 'error-codes': ['invalid-input-response'] }],
    [{ unexpected: true }],
  ])('Turnstile refusé (%j) : 403, aucune insertion', async (turnstile) => {
    const t = setup({ turnstile });
    const res = await t.handler(request());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'captcha_failed' });
    expect(t.urls()).not.toContain('https://proj.supabase.co/rest/v1/rpc/waitlist_join');
  });

  it('contrainte refusée par la base (23514) : 400', async () => {
    const t = setup({ join: jsonResponse(400, { code: '23514', message: 'check violation' }) });
    expect((await t.handler(request())).status).toBe(400);
  });

  it('réponse de la base inattendue : 500', async () => {
    const t = setup({ join: jsonResponse(200, [{ queue_position: 'x' }]) });
    expect((await t.handler(request())).status).toBe(500);
    expect(t.logs.at(-1)).toEqual({ event: 'server_error', data: { reason: 'exception' } });
  });

  it('configuration incomplète : 503 (fail closed) et noms des variables journalisés', async () => {
    const t = setup({}, { ...ENV, SUPABASE_SERVICE_ROLE_KEY: undefined, RATE_LIMIT_PEPPER: 'court' });
    const res = await t.handler(request());
    expect(res.status).toBe(503);
    expect(t.logs[0]).toEqual({ event: 'config_invalid', data: { variables: ['SUPABASE_SERVICE_ROLE_KEY', 'RATE_LIMIT_PEPPER'] } });
    expect(t.fetchFn).not.toHaveBeenCalled();
  });

  it('les journaux ne contiennent ni email, ni prénom, ni IP', async () => {
    const t = setup();
    await t.handler(request());
    await t.handler(request({ body: { ...BODY, email: 'bad' } }));
    await t.settle();
    const dump = JSON.stringify(t.logs);
    expect(dump).not.toMatch(/ines@|Inès|203\.0\.113\.7/i);
  });
});

describe('configuration', () => {
  it('refuse une origine qui contient un chemin', () => {
    const res = loadConfig({ ...ENV, ALLOWED_ORIGINS: 'https://stacker.example/app' });
    expect(res).toEqual({ ok: false, missing: ['ALLOWED_ORIGINS'] });
  });
  it('refuse une origine illisible', () => {
    expect(loadConfig({ ...ENV, ALLOWED_ORIGINS: 'pas une url' }).ok).toBe(false);
  });
  it('accepte une origine avec « / » final et retire le « / » du SITE_URL', () => {
    const res = loadConfig({ ...ENV, ALLOWED_ORIGINS: 'https://stacker.example/' });
    expect(res.ok && [...res.config.allowedOrigins]).toEqual(['https://stacker.example']);
    expect(res.ok && res.config.siteUrl).toBe('https://stacker.example');
  });
  it('désactive Brevo sans expéditeur', () => {
    const res = loadConfig({ ...ENV, BREVO_SENDER_EMAIL: undefined });
    expect(res.ok && res.config.brevo).toBeNull();
  });
});

describe('services', () => {
  it('clientIp : premier saut de x-forwarded-for, puis cf-connecting-ip, sinon null', () => {
    const r = (h: Record<string, string>) => new Request('https://x.example', { headers: h });
    expect(clientIp(r({ 'x-forwarded-for': ' 198.51.100.1 , 10.0.0.1' }))).toBe('198.51.100.1');
    expect(clientIp(r({ 'cf-connecting-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIp(r({}))).toBeNull();
  });

  it('sha256Hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('en-têtes : Authorization seulement pour une clé JWT', () => {
    expect(supabaseAuthHeaders('sb_secret_abc')).toEqual({ apikey: 'sb_secret_abc' });
    expect(supabaseAuthHeaders('eyJabc')).toEqual({ apikey: 'eyJabc', Authorization: 'Bearer eyJabc' });
  });

  it('verifyTurnstile : HTTP en erreur, réseau coupé, sans IP', async () => {
    expect(await verifyTurnstile(async () => new Response('', { status: 500 }), 's', 't', null, 'k')).toEqual({
      success: false,
      errorCodes: ['http_500'],
    });
    expect(
      await verifyTurnstile(
        async () => {
          throw new Error('offline');
        },
        's',
        't',
        null,
        'k',
      ),
    ).toEqual({ success: false, errorCodes: ['network_error'] });
    let sent: FormData | undefined;
    await verifyTurnstile(
      async (_url, init) => {
        sent = init?.body as FormData;
        return jsonResponse(200, { success: true });
      },
      's',
      't',
      null,
      'k',
    );
    expect(sent?.has('remoteip')).toBe(false);
  });

  it('callRpc : corps d’erreur illisible → RpcError générique', async () => {
    const promise = callRpc(async () => new Response('<html>', { status: 502 }), 'https://p.supabase.co', 'k', 'f', {});
    await expect(promise).rejects.toBeInstanceOf(RpcError);
    await expect(callRpc(async () => new Response('<html>', { status: 502 }), 'https://p.supabase.co', 'k', 'f', {})).rejects.toMatchObject({
      status: 502,
      code: null,
      message: 'rpc f http 502',
    });
  });
});

describe('email de confirmation', () => {
  it('échappe le prénom et ne contient aucune promesse de gain', () => {
    const msg = buildConfirmationEmail({
      email: 'a@b.fr',
      firstName: '<b>Zoé</b>',
      position: 1234,
      referralUrl: 'https://s.example/liste-attente?ref=ABCDEFGH',
      siteUrl: 'https://s.example',
      contactEmail: null,
    });
    expect(msg.html).toContain('&lt;b&gt;Zoé&lt;/b&gt;');
    expect(msg.html).not.toContain('<b>Zoé</b>');
    expect(msg.subject).toMatch(/n° 1\s234/);
    expect(msg.text).toContain('consulte https://s.example/confidentialite');
    for (const banned of [/garanti/i, /immédiat/i, /24 ?h/i, /€/]) {
      expect(msg.html).not.toMatch(banned);
      expect(msg.text).not.toMatch(banned);
    }
  });

  it('indique l’adresse de contact quand elle existe', () => {
    const msg = buildConfirmationEmail({
      email: 'a@b.fr',
      firstName: 'Zoé',
      position: 1,
      referralUrl: 'https://s.example/liste-attente?ref=ABCDEFGH',
      siteUrl: 'https://s.example',
      contactEmail: 'dpo@s.example',
    });
    expect(msg.text).toContain('écris à dpo@s.example');
    expect(msg.html).toContain('écris à dpo@s.example');
  });
});
