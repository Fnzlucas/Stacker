import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { createHandler, sha256Hex } from './handler.ts';
import { adminDeleteUser, fetchAuthUser, lastAuthenticationAt } from '../_shared/rest.ts';

const ORIGIN = 'https://stacker.example';
const URL_BASE = 'https://proj.supabase.co';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = 1_800_000_000;

const ENV = {
  SUPABASE_URL: `${URL_BASE}/`,
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_service_role_key_123',
  SUPABASE_ANON_KEY: 'sb_publishable_test_anon_key_1234',
  ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:4174`,
  RATE_LIMIT_PEPPER: 'pepper-0123456789abcdef',
};

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (payload: Record<string, unknown>) => `${b64url({ alg: 'HS256' })}.${b64url(payload)}.signature`;
const freshToken = token({ sub: USER_ID, amr: [{ method: 'password', timestamp: NOW - 60 }] });

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Scenario {
  user?: Response;
  rate?: Response;
  erase?: Response;
  del?: Response;
  throwOn?: string;
}

function setup(scenario: Scenario = {}, env: Record<string, string | undefined> = ENV) {
  const calls: { url: string; method: string; headers: Headers; body: unknown }[] = [];
  const logs: string[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    if (scenario.throwOn && url.includes(scenario.throwOn)) throw new Error('réseau');
    if (url === `${URL_BASE}/auth/v1/user`) return scenario.user ?? jsonResponse(200, { id: USER_ID, email: 'ines@exemple.fr' });
    if (url === `${URL_BASE}/rest/v1/rpc/rate_limit_hit`) return scenario.rate ?? jsonResponse(200, true);
    if (url === `${URL_BASE}/rest/v1/rpc/account_erase_prepare`) return scenario.erase ?? jsonResponse(200, true);
    if (url === `${URL_BASE}/auth/v1/admin/users/${USER_ID}`) return scenario.del ?? jsonResponse(200, {});
    return jsonResponse(404, {});
  };
  const handle = createHandler({ config: loadConfig(env), fetch: fetchFn, log: (e) => logs.push(e), now: () => NOW });
  return { handle, calls, logs };
}

function request(opts: { method?: string; origin?: string | null; auth?: string | null; body?: string; type?: string; length?: string } = {}) {
  const headers = new Headers();
  if (opts.origin !== null) headers.set('origin', opts.origin ?? ORIGIN);
  if (opts.auth !== null) headers.set('authorization', opts.auth ?? `Bearer ${freshToken}`);
  headers.set('content-type', opts.type ?? 'application/json');
  if (opts.length) headers.set('content-length', opts.length);
  const method = opts.method ?? 'POST';
  return new Request(`${URL_BASE}/functions/v1/account-delete`, {
    method,
    headers,
    body: method === 'GET' || method === 'OPTIONS' ? undefined : (opts.body ?? JSON.stringify({ confirm: 'SUPPRIMER' })),
  });
}

const errorOf = async (res: Response) => ((await res.json()) as { error?: string }).error;

describe('account-delete : configuration', () => {
  it('accepte une configuration complète', () => {
    const c = loadConfig(ENV);
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.config.supabaseUrl).toBe(URL_BASE);
      expect([...c.config.allowedOrigins]).toEqual([ORIGIN, 'http://localhost:4174']);
    }
  });
  it('liste les variables manquantes, jamais leurs valeurs', () => {
    const c = loadConfig({ ...ENV, SUPABASE_ANON_KEY: undefined, ALLOWED_ORIGINS: 'pas une url' });
    expect(c).toEqual({ ok: false, missing: ['SUPABASE_ANON_KEY', 'ALLOWED_ORIGINS'] });
  });
  it('répond 503 (fail closed) si la configuration est invalide', async () => {
    const { handle, logs, calls } = setup({}, { ...ENV, RATE_LIMIT_PEPPER: 'court' });
    const res = await handle(request());
    expect(res.status).toBe(503);
    expect(await errorOf(res)).toBe('unavailable');
    expect(logs).toContain('config_invalid');
    expect(calls).toHaveLength(0);
  });
});

describe('account-delete : contrôles HTTP', () => {
  it('refuse une origine inconnue ou absente', async () => {
    const { handle } = setup();
    expect((await handle(request({ origin: 'https://evil.example' }))).status).toBe(403);
    expect((await handle(request({ origin: null }))).status).toBe(403);
  });
  it('répond au pré-vol CORS', async () => {
    const { handle } = setup();
    const res = await handle(request({ method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('vary')).toBe('Origin');
  });
  it('refuse les autres méthodes', async () => {
    const { handle } = setup();
    const res = await handle(request({ method: 'GET' }));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST, OPTIONS');
  });
  it('refuse un corps qui n’est pas du JSON', async () => {
    const { handle } = setup();
    expect((await handle(request({ type: 'text/plain' }))).status).toBe(415);
    expect((await handle(request({ body: '{oops' }))).status).toBe(400);
  });
  it('refuse un corps trop gros (déclaré ou réel)', async () => {
    const { handle } = setup();
    expect((await handle(request({ length: '5000' }))).status).toBe(413);
    expect((await handle(request({ body: JSON.stringify({ confirm: 'SUPPRIMER', pad: 'x'.repeat(2000) }) }))).status).toBe(413);
  });
  it('exige la confirmation exacte « SUPPRIMER », sans champ en plus', async () => {
    const { handle, calls } = setup();
    expect(await errorOf(await handle(request({ body: JSON.stringify({ confirm: 'supprimer' }) })))).toBe('invalid_request');
    expect(await errorOf(await handle(request({ body: JSON.stringify({ confirm: 'SUPPRIMER', userId: 'autre' }) })))).toBe('invalid_request');
    expect(calls).toHaveLength(0);
  });
  it('exige un jeton Bearer', async () => {
    const { handle, calls } = setup();
    expect(await errorOf(await handle(request({ auth: null })))).toBe('unauthorized');
    expect(await errorOf(await handle(request({ auth: 'Bearer pas-un-jwt' })))).toBe('unauthorized');
    expect(calls).toHaveLength(0);
  });
});

describe('account-delete : identité et réauthentification', () => {
  it('jeton refusé par Supabase Auth : 401, rien n’est supprimé', async () => {
    const { handle, calls } = setup({ user: jsonResponse(401, { msg: 'invalid JWT' }) });
    const res = await handle(request());
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toBe('unauthorized');
    expect(calls.map((c) => c.url)).toEqual([`${URL_BASE}/auth/v1/user`]);
  });
  it('valide le jeton avec la clé publique (jamais la clé service_role)', async () => {
    const { handle, calls } = setup();
    await handle(request());
    const userCall = calls[0]!;
    expect(userCall.headers.get('apikey')).toBe(ENV.SUPABASE_ANON_KEY);
    expect(userCall.headers.get('authorization')).toBe(`Bearer ${freshToken}`);
  });
  it('connexion trop ancienne (> 10 min) : réauthentification exigée', async () => {
    const old = token({ sub: USER_ID, amr: [{ method: 'password', timestamp: NOW - 11 * 60 }] });
    const { handle, calls } = setup();
    const res = await handle(request({ auth: `Bearer ${old}` }));
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toBe('reauth_required');
    expect(calls).toHaveLength(1);
  });
  it('jeton sans revendication amr : réauthentification exigée', async () => {
    const { handle } = setup();
    expect(await errorOf(await handle(request({ auth: `Bearer ${token({ sub: USER_ID })}` })))).toBe('reauth_required');
  });
});

describe('account-delete : suppression', () => {
  it('supprime le compte de l’appelant, et seulement le sien', async () => {
    const { handle, calls, logs } = setup();
    const res = await handle(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'deleted' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${URL_BASE}/auth/v1/user`,
      `POST ${URL_BASE}/rest/v1/rpc/rate_limit_hit`,
      `POST ${URL_BASE}/rest/v1/rpc/account_erase_prepare`,
      `DELETE ${URL_BASE}/auth/v1/admin/users/${USER_ID}`,
    ]);
    expect(calls[2]!.body).toEqual({ p_user_id: USER_ID });
    const bucket = (calls[1]!.body as { p_bucket: string }).p_bucket;
    expect(bucket).toBe(`account-delete:${await sha256Hex(`${ENV.RATE_LIMIT_PEPPER}:${USER_ID}`)}`);
    expect(bucket).not.toContain(USER_ID);
    expect(logs).toEqual(['account_deleted']);
  });
  it('rate limit dépassé : 429 avec Retry-After', async () => {
    const { handle, calls } = setup({ rate: jsonResponse(200, false) });
    const res = await handle(request());
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3600');
    expect(calls).toHaveLength(2);
  });
  it('utilisateur déjà supprimé côté Auth (404) : succès idempotent', async () => {
    const { handle } = setup({ del: jsonResponse(404, {}) });
    expect((await handle(request())).status).toBe(200);
  });
  it('échec de l’effacement en base : 500 générique, l’utilisateur n’est pas supprimé', async () => {
    const { handle, calls, logs } = setup({ erase: jsonResponse(500, { code: 'XX000', message: 'boom' }) });
    const res = await handle(request());
    expect(res.status).toBe(500);
    expect(await errorOf(res)).toBe('server_error');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(logs).toEqual(['server_error']);
  });
  it('échec de l’API admin : 500 générique', async () => {
    const { handle } = setup({ del: jsonResponse(500, {}) });
    expect((await handle(request())).status).toBe(500);
  });
  it('Auth indisponible ou réponse illisible : 500', async () => {
    expect((await setup({ user: jsonResponse(502, {}) }).handle(request())).status).toBe(500);
    expect((await setup({ user: jsonResponse(200, { pas: 'un utilisateur' }) }).handle(request())).status).toBe(500);
  });
  it('erreur réseau : 500 sans détail', async () => {
    const { handle } = setup({ throwOn: '/auth/v1/user' });
    const res = await handle(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'server_error' });
  });
});

describe('helpers Auth partagés', () => {
  it('lastAuthenticationAt : prend la méthode la plus récente', () => {
    expect(lastAuthenticationAt(token({ amr: [{ method: 'password', timestamp: 10 }, { method: 'otp', timestamp: 20 }] }))).toBe(20);
  });
  it('lastAuthenticationAt : null sur un jeton mal formé', () => {
    expect(lastAuthenticationAt('abc')).toBeNull();
    expect(lastAuthenticationAt('a.%%%.c')).toBeNull();
    expect(lastAuthenticationAt(token({ amr: 'non' }))).toBeNull();
    expect(lastAuthenticationAt(token({ amr: [] }))).toBeNull();
    expect(lastAuthenticationAt(`a.${Buffer.from('42').toString('base64url')}.c`)).toBeNull();
  });
  it('fetchAuthUser : email absent toléré', async () => {
    const user = await fetchAuthUser(async () => jsonResponse(200, { id: USER_ID }), URL_BASE, 'k', 't');
    expect(user).toEqual({ id: USER_ID, email: null });
    expect(await fetchAuthUser(async () => jsonResponse(403, {}), URL_BASE, 'k', 't')).toBeNull();
  });
  it('adminDeleteUser : encode l’identifiant et lève sur erreur', async () => {
    let seen = '';
    await adminDeleteUser(async (u) => ((seen = u), jsonResponse(200, {})), URL_BASE, 'key', 'a/b');
    expect(seen).toBe(`${URL_BASE}/auth/v1/admin/users/a%2Fb`);
    await expect(adminDeleteUser(async () => jsonResponse(500, {}), URL_BASE, 'key', 'x')).rejects.toThrow('auth admin delete http 500');
  });
});
