import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { createHandler } from './handler.ts';

const ORIGIN = 'https://stacker.example';
const SB = 'https://proj.supabase.co';
const API = 'http://api.test';
const USER_ID = '11111111-1111-4111-8111-111111111111';

const ENV = {
  SUPABASE_URL: `${SB}/`,
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-factice-pour-les-tests',
  SUPABASE_ANON_KEY: 'sb_publishable_test_anon_key_1234',
  ALLOWED_ORIGINS: ORIGIN,
  RATE_LIMIT_PEPPER: 'pepper-0123456789abcdef',
  RECHERCHE_ENTREPRISES_URL: API,
};
const TOKEN = 'aaa.bbb.ccc';

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const apiResult = (i: number) => ({
  siren: `10000000${String(i)}`,
  nom_complet: `ENTREPRISE ${String(i)}`,
  activite_principale: '43.22A',
  date_creation: '2025-02-01',
  tranche_effectif_salarie: i === 1 ? '00' : '11',
  statut_diffusion: 'O',
  siege: { siret: `10000000${String(i)}00011`, code_postal: '30400', libelle_commune: 'VILLENEUVE', est_siege: true },
  dirigeants: [{ nom: 'DUPONT', prenoms: 'Jean', qualite: 'Gérant', date_de_naissance: '1970-01' }],
});

interface Scenario {
  user?: Response;
  userRate?: boolean;
  begin?: Response;
  cache?: unknown;
  globalSlots?: boolean[];
  api?: Response[];
  annotate?: (sirets: string[]) => unknown;
  throwOn?: string;
}

function setup(s: Scenario = {}, env: Record<string, string | undefined> = ENV) {
  const calls: { url: string; body: Record<string, unknown> | null }[] = [];
  const logs: { event: string; data?: Record<string, unknown> }[] = [];
  const waits: number[] = [];
  const slots = [...(s.globalSlots ?? [true, true, true])];
  const api = [...(s.api ?? [res(200, { results: [apiResult(1), apiResult(2), { siren: 'x' }], total_results: 2, page: 1 })])];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, body });
    if (s.throwOn && url.includes(s.throwOn)) throw new Error('réseau');
    if (url === `${SB}/auth/v1/user`) return s.user ?? res(200, { id: USER_ID, email: 'a@b.fr' });
    if (url === `${SB}/rest/v1/rpc/rate_limit_hit`) {
      if (body?.['p_bucket'] === 'reapi:global') return res(200, slots.shift() ?? true);
      return res(200, s.userRate ?? true);
    }
    if (url === `${SB}/rest/v1/rpc/prospects_search_begin`) return s.begin ?? res(200, { used: 3, limit: 30 });
    if (url === `${SB}/rest/v1/rpc/prospects_cache_get`) return res(200, s.cache ?? null);
    if (url === `${SB}/rest/v1/rpc/prospects_cache_put`) return res(200, null);
    if (url === `${SB}/rest/v1/rpc/prospects_annotate`) {
      const sirets = body?.['p_sirets'] as string[];
      return res(200, s.annotate ? s.annotate(sirets) : sirets.map((siret, i) => annotated(siret, i === 0 ? 'libre' : 'deja_suivie')));
    }
    if (url.startsWith(API)) return api.shift() ?? res(500, {});
    return res(404, {});
  };
  const handle = createHandler({
    config: loadConfig(env),
    fetch: fetchFn,
    log: (event, data) => logs.push({ event, data }),
    now: () => new Date('2026-10-20T00:00:00Z'),
    wait: async (ms) => {
      waits.push(ms);
    },
  });
  return { handle, calls, logs, waits };
}

const annotated = (siret: string, state: string) => ({
  siret,
  name: `ENTREPRISE ${siret}`,
  naf: '43.22A',
  naf_label: 'Plomberie, eau et gaz',
  city: 'VILLENEUVE',
  postcode: '30400',
  employee_band: '00',
  created_on: '2025-02-01',
  is_head_office: true,
  is_sole_trader: false,
  state,
  claim_id: null,
  cooldown_until: null,
});

const BODY = { zone: { type: 'departement', value: '30' }, preset: 'batiment', page: 1 };

function request(opts: { body?: unknown; origin?: string | null; auth?: string | null; method?: string; type?: string } = {}) {
  const headers = new Headers({ 'content-type': opts.type ?? 'application/json' });
  if (opts.origin !== null) headers.set('origin', opts.origin ?? ORIGIN);
  if (opts.auth !== null) headers.set('authorization', opts.auth ?? `Bearer ${TOKEN}`);
  const method = opts.method ?? 'POST';
  return new Request(`${SB}/functions/v1/prospects-search`, {
    method,
    headers,
    body: method === 'POST' ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? BODY)) : undefined,
  });
}

const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe('prospects-search', () => {
  it('cache vide : appel de l’API (URL exacte), enregistrement, annotation, score', async () => {
    const { handle, calls, logs } = setup();
    const r = await handle(request());
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const body = await json(r);
    expect(body).toMatchObject({ ok: true, page: 1, total: 2, has_more: false, quota: { used: 3, limit: 30 } });
    const items = body['items'] as Record<string, unknown>[];
    expect(items.map((i) => i['state'])).toEqual(['libre', 'deja_suivie']);
    expect(items[0]?.['score']).toBe(100);
    const apiCall = calls.find((c) => c.url.startsWith(API))!;
    const u = new URL(apiCall.url);
    expect(u.pathname).toBe('/search');
    expect(u.searchParams.get('etat_administratif')).toBe('A');
    expect(u.searchParams.get('minimal')).toBe('true');
    expect(u.searchParams.get('per_page')).toBe('25');
    const put = calls.find((c) => c.url.endsWith('/prospects_cache_put'))!;
    const companies = put.body?.['p_companies'] as Record<string, unknown>[];
    expect(companies).toHaveLength(2);
    expect(JSON.stringify(companies)).not.toContain('1970');
    expect(put.body?.['p_key']).toMatch(/^[0-9a-f]{64}$/);
    // Journaux : aucun nom, SIRET ni identifiant.
    expect(JSON.stringify(logs)).not.toMatch(/ENTREPRISE|10000000|1111-4111/);
    expect(logs.at(-1)).toEqual({ event: 'search_ok', data: { source: 'api', items: 2, page: 1 } });
  });

  it('cache valide : 0 appel à l’API, 0 consommation du limiteur global', async () => {
    const { handle, calls } = setup({ cache: { sirets: ['10000000100011'], total: 60 } });
    const r = await handle(request({ body: { ...BODY, page: 2 } }));
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ total: 60, has_more: true, page: 2 });
    expect(calls.some((c) => c.url.startsWith(API))).toBe(false);
    expect(calls.some((c) => c.body?.['p_bucket'] === 'reapi:global')).toBe(false);
  });

  it('même requête ⇒ même clé de cache', async () => {
    const a = setup();
    await a.handle(request({ body: { zone: { type: 'departement', value: '30' }, sizes: ['tpe', 'solo'], page: 1 } }));
    const b = setup();
    await b.handle(request({ body: { zone: { type: 'departement', value: '30' }, sizes: ['solo', 'tpe'], page: 1 } }));
    const key = (calls: { url: string; body: Record<string, unknown> | null }[]) => calls.find((c) => c.url.endsWith('/prospects_cache_get'))?.body?.['p_key'];
    expect(key(a.calls)).toBe(key(b.calls));
  });

  it('aucun résultat : pas d’annotation', async () => {
    const { handle, calls } = setup({ cache: { sirets: [], total: 0 } });
    const r = await handle(request());
    expect(await json(r)).toMatchObject({ ok: true, total: 0, items: [] });
    expect(calls.some((c) => c.url.endsWith('/prospects_annotate'))).toBe(false);
  });

  it('429 + Retry-After de l’API : attente puis nouvel essai', async () => {
    const { handle, waits } = setup({ api: [res(429, {}, { 'retry-after': '1' }), res(200, { results: [apiResult(1)], total_results: 1 })] });
    const r = await handle(request());
    expect(r.status).toBe(200);
    expect(waits).toEqual([1000]);
  });

  it('429 répété ou Retry-After trop long ⇒ 503 source_busy', async () => {
    const twice = setup({ api: [res(429, {}, { 'retry-after': '1' }), res(429, {}, { 'retry-after': '1' })] });
    expect(await json(await twice.handle(request()))).toEqual({ ok: false, error: 'source_busy' });
    const long = setup({ api: [res(429, {}, { 'retry-after': '30' })] });
    const r = await long.handle(request());
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('2');
  });

  it('limiteur global refusé 3 fois ⇒ 503, sans appel à l’API', async () => {
    const { handle, calls, waits } = setup({ globalSlots: [false, false, false] });
    const r = await handle(request());
    expect(await json(r)).toEqual({ ok: false, error: 'source_busy' });
    expect(calls.some((c) => c.url.startsWith(API))).toBe(false);
    expect(waits).toEqual([200, 200]);
  });

  it('limiteur global libéré au 2e essai : l’appel part', async () => {
    const { handle } = setup({ globalSlots: [false, true] });
    expect((await handle(request())).status).toBe(200);
  });

  it('API en panne, coupée ou réponse illisible ⇒ 503 source_busy', async () => {
    expect((await setup({ api: [res(500, {})] }).handle(request())).status).toBe(503);
    expect((await setup({ api: [res(200, { pas: 'attendu' })] }).handle(request())).status).toBe(503);
    expect((await setup({ throwOn: API }).handle(request())).status).toBe(503);
  });

  it('autour de moi : /near_point, filtre d’effectif appliqué après coup', async () => {
    const { handle, calls } = setup();
    const r = await handle(request({ body: { zone: { type: 'autour', lat: 43.96, lng: 4.79, radius_km: 10 }, sizes: ['solo'], page: 1 } }));
    expect(r.status).toBe(200);
    expect(new URL(calls.find((c) => c.url.startsWith(API))!.url).pathname).toBe('/near_point');
    const put = calls.find((c) => c.url.endsWith('/prospects_cache_put'))!;
    expect((put.body?.['p_companies'] as unknown[]).length).toBe(1);
  });

  it('quotas et état du compte', async () => {
    const err = (message: string) => res(400, { code: 'P0001', message });
    expect(await json(await setup({ begin: err('daily_quota') }).handle(request()))).toEqual({ ok: false, error: 'quota_exceeded' });
    expect((await setup({ begin: err('onboarding_required') }).handle(request())).status).toBe(403);
    expect(await json(await setup({ begin: err('disabled') }).handle(request()))).toEqual({ ok: false, error: 'disabled' });
    expect((await setup({ begin: err('autre') }).handle(request())).status).toBe(500);
    const limited = await setup({ userRate: false }).handle(request());
    expect(limited.status).toBe(429);
    expect(await json(limited)).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('refus : origine, méthode, corps, jeton', async () => {
    const { handle, calls } = setup();
    expect((await handle(request({ origin: 'https://pirate.example' }))).status).toBe(403);
    expect((await handle(request({ origin: null }))).status).toBe(403);
    expect((await handle(request({ method: 'OPTIONS' }))).status).toBe(204);
    expect((await handle(request({ method: 'GET' }))).status).toBe(405);
    expect((await handle(request({ type: 'text/plain' }))).status).toBe(415);
    expect((await handle(request({ body: 'x'.repeat(3000) }))).status).toBe(413);
    expect((await handle(request({ body: '{oups' }))).status).toBe(400);
    expect((await handle(request({ body: { ...BODY, naf: ['43.22A'] } }))).status).toBe(400);
    expect((await handle(request({ body: { ...BODY, page: 41 } }))).status).toBe(400);
    expect((await handle(request({ auth: null }))).status).toBe(401);
    expect(calls).toHaveLength(0);
    expect((await setup({ user: res(401, {}) }).handle(request())).status).toBe(401);
  });

  it('erreurs serveur : 500 sans détail', async () => {
    const down = setup({ throwOn: '/rpc/prospects_cache_get' });
    const r = await down.handle(request());
    expect(r.status).toBe(500);
    expect(await json(r)).toEqual({ ok: false, error: 'server_error' });
    const bad = setup({ annotate: () => [{ siret: 'faux' }] });
    expect((await bad.handle(request())).status).toBe(500);
    expect(bad.logs.at(-1)).toEqual({ event: 'server_error', data: { reason: 'invalid_payload' } });
  });

  it('configuration incomplète ⇒ 503, noms des variables seulement', async () => {
    const { handle, logs } = setup({}, { ...ENV, SUPABASE_SERVICE_ROLE_KEY: undefined });
    expect((await handle(request())).status).toBe(503);
    expect(logs[0]).toEqual({ event: 'config_invalid', data: { variables: ['SUPABASE_SERVICE_ROLE_KEY'] } });
    expect(loadConfig({ ...ENV, RECHERCHE_ENTREPRISES_URL: undefined })).toMatchObject({ ok: true, config: { apiBase: 'https://recherche-entreprises.api.gouv.fr' } });
    expect(loadConfig({ ...ENV, ALLOWED_ORIGINS: 'https://x.fr/chemin' }).ok).toBe(false);
  });
});
