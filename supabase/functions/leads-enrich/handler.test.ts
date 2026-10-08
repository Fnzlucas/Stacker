import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { createHandler } from './handler.ts';
import { FIELD_MASK, PLACES_URL } from './places.ts';

const SB = 'https://proj.supabase.co';
const API = 'http://api.test';
const GEO = 'http://geo.test';
const SECRET = 'secret-de-planification-0123456789';
const ENV = {
  SUPABASE_URL: SB,
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-factice-pour-les-tests',
  GOOGLE_PLACES_SERVER_KEY: 'AIza-cle-serveur-de-test-000000',
  CRON_SECRET: SECRET,
  RECHERCHE_ENTREPRISES_URL: API,
  GEO_API_URL: GEO,
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html' } });

interface Scenario {
  targets?: unknown;
  budget?: boolean;
  queryNew?: boolean;
  places?: Response;
  unseen?: (ids: string[]) => string[];
  slot?: boolean;
}

function setup(s: Scenario = {}, env: Record<string, string | undefined> = ENV) {
  const rpc: { fn: string; args: Record<string, unknown> }[] = [];
  const google: { headers: Headers; body: Record<string, unknown> }[] = [];
  const logs: { event: string; data?: Record<string, unknown> }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (url.startsWith(`${SB}/rest/v1/rpc/`)) {
      const fn = url.slice(`${SB}/rest/v1/rpc/`.length);
      const args = JSON.parse(((init?.body as string | undefined) ?? '{}')) as Record<string, unknown>;
      rpc.push({ fn, args });
      switch (fn) {
        case 'enrich_targets':
          return json(200, s.targets ?? [{ department: '30', preset: 'batiment', missing: 100 }]);
        case 'enrich_query_begin':
          return json(200, s.queryNew ?? true);
        case 'budget_consume':
          return json(200, s.budget ?? true);
        case 'enrich_unseen':
          return json(200, s.unseen ? s.unseen(args['p_place_ids'] as string[]) : args['p_place_ids']);
        case 'rate_limit_hit':
          return json(200, s.slot ?? true);
        default:
          return json(200, null);
      }
    }
    if (url.startsWith(`${GEO}/departements/30/communes`)) return json(200, [{ nom: 'Nîmes', code: '30189', population: 148000 }, { nom: 'Uzès', code: '30334', population: 8000 }]);
    if (url === PLACES_URL) {
      google.push({ headers: new Headers(init?.headers), body: JSON.parse((init?.body as string)) as Record<string, unknown> });
      return (
        s.places?.clone() ??
        json(200, {
          places: [
            { id: 'ChIJ-plomberie-durand', displayName: { text: 'Plomberie Durand' }, websiteUri: 'https://plomberie-durand.fr/', addressComponents: [{ longText: '30000', types: ['postal_code'] }] },
            { id: 'ChIJ-sans-site-00001', displayName: { text: 'Elec Sud' } },
            { id: 'ChIJ-ferme-000000001', displayName: { text: 'Ancien garage' }, websiteUri: 'https://ancien.fr', businessStatus: 'CLOSED_PERMANENTLY' },
            { id: 'ChIJ-site-sans-email', displayName: { text: 'Coiffure Léa' }, websiteUri: 'https://coiffure-lea.fr' },
          ],
        })
      );
    }
    if (url === 'https://plomberie-durand.fr/') return html('<a href="/contact">Contact</a> SIREN 812 345 678');
    if (url === 'https://plomberie-durand.fr/contact') return html('contact@plomberie-durand.fr');
    if (url.startsWith('https://coiffure-lea.fr')) return html('<p>Bienvenue</p>');
    if (url.startsWith(`${API}/search`))
      return json(200, { results: [{ siren: '812345678', nom_complet: 'PLOMBERIE DURAND', activite_principale: '43.22A', statut_diffusion: 'O', siege: { siret: '81234567800011', code_postal: '30000', est_siege: true } }], total_results: 1 });
    return new Response('', { status: 404 });
  };
  let t = 0;
  const handle = createHandler({ config: loadConfig(env), fetch: fetchFn, log: (event, data) => logs.push({ event, data }), resolve: null, now: () => (t += 10), wait: async () => undefined });
  return { handle, rpc, google, logs };
}

const req = (secret: string | null = SECRET, method = 'POST') => new Request(`${SB}/functions/v1/leads-enrich`, { method, headers: secret ? { 'x-cron-secret': secret } : {} });

describe('leads-enrich', () => {
  it('Google Maps → site → email générique → SIRENE ; rien de Google n’est enregistré', async () => {
    const { handle, rpc, google, logs } = setup({ targets: [{ department: '30', preset: 'batiment', missing: 1 }] });
    const r = await handle(req());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, queries: 1, places: 3, contacts: 1, no_site: 1, no_email: 1, no_match: 0 });
    // Requête Google : clé serveur, masque de champs minimal, commune la plus peuplée d'abord.
    expect(google[0]?.headers.get('x-goog-api-key')).toBe(ENV.GOOGLE_PLACES_SERVER_KEY);
    expect(google[0]?.headers.get('x-goog-fieldmask')).toBe(FIELD_MASK);
    expect(google[0]?.body).toEqual({ textQuery: 'plombier Nîmes', languageCode: 'fr', regionCode: 'FR', pageSize: 20 });
    const save = rpc.find((c) => c.fn === 'enrich_save_contact')!;
    expect(save.args['p_email']).toBe('contact@plomberie-durand.fr');
    expect(save.args['p_source_url']).toBe('https://plomberie-durand.fr/contact');
    expect((save.args['p_company'] as { siret: string }).siret).toBe('81234567800011');
    // Ni nom Google, ni site, ni téléphone Google en base : seulement l'entreprise SIRENE et l'adresse du site.
    expect(JSON.stringify(save.args)).not.toContain('ChIJ');
    const seen = rpc.filter((c) => c.fn === 'enrich_mark_seen').map((c) => [c.args['p_place_id'], c.args['p_outcome']]);
    expect(seen).toEqual(expect.arrayContaining([['ChIJ-plomberie-durand', 'contact'], ['ChIJ-sans-site-00001', 'no_site'], ['ChIJ-site-sans-email', 'no_email']]));
    expect(seen.some(([id]) => id === 'ChIJ-ferme-000000001')).toBe(false);
    expect(rpc.find((c) => c.fn === 'enrich_query_done')?.args).toMatchObject({ p_results: 1 });
    expect(JSON.stringify(logs)).not.toMatch(/Plomberie|plomberie-durand|812345678/i);
  });

  it('requête déjà jouée : Google n’est pas appelé', async () => {
    const { handle, google } = setup({ queryNew: false });
    await handle(req());
    expect(google).toHaveLength(0);
  });

  it('budget du mois épuisé : arrêt immédiat, Google n’est pas appelé', async () => {
    const { handle, google, logs } = setup({ budget: false });
    expect(await (await handle(req())).json()).toMatchObject({ ok: true, budget_stop: true, queries: 0 });
    expect(google).toHaveLength(0);
    expect(logs.some((l) => l.event === 'budget_exhausted')).toBe(true);
  });

  it('lieux déjà traités : ignorés (pas de nouvelle lecture de site)', async () => {
    const { handle, rpc } = setup({ unseen: () => [] });
    await handle(req());
    expect(rpc.some((c) => c.fn === 'enrich_save_contact' || c.fn === 'enrich_mark_seen')).toBe(false);
  });

  it('Google refuse (clé, quota) : arrêt propre', async () => {
    const { handle, google } = setup({ places: json(403, { error: {} }) });
    expect((await handle(req())).status).toBe(200);
    expect(google).toHaveLength(1);
  });

  it('limiteur de l’API publique saturé : le lieu est marqué en erreur, pas de rattachement', async () => {
    const { handle, rpc } = setup({ slot: false, targets: [{ department: '30', preset: 'batiment', missing: 1 }] });
    await handle(req());
    expect(rpc.some((c) => c.fn === 'enrich_mark_seen' && c.args['p_outcome'] === 'error')).toBe(true);
    expect(rpc.some((c) => c.fn === 'enrich_save_contact')).toBe(false);
  });

  it('nombre de requêtes par passage borné', async () => {
    const { handle, google } = setup({ targets: [{ department: '30', preset: 'batiment', missing: 10_000 }] });
    await handle(req());
    expect(google.length).toBeLessThanOrEqual(12);
  });

  it('secteur inconnu, aucune zone : rien à faire', async () => {
    expect(await (await setup({ targets: [{ department: '30', preset: 'inconnu', missing: 5 }] }).handle(req())).json()).toMatchObject({ queries: 0 });
    expect(await (await setup({ targets: [] }).handle(req())).json()).toMatchObject({ queries: 0 });
  });

  it('accès : secret de planification obligatoire, POST seulement ; configuration incomplète ⇒ 503', async () => {
    const { handle, rpc } = setup();
    expect((await handle(req(null))).status).toBe(403);
    expect((await handle(req('mauvais-secret-0123456789abcdef'))).status).toBe(403);
    expect((await handle(req(SECRET, 'GET'))).status).toBe(405);
    expect(rpc).toHaveLength(0);
    const off = setup({}, { ...ENV, GOOGLE_PLACES_SERVER_KEY: undefined });
    expect((await off.handle(req())).status).toBe(503);
    expect(off.logs[0]).toEqual({ event: 'config_invalid', data: { variables: ['GOOGLE_PLACES_SERVER_KEY'] } });
  });

  it('réponse invalide de la base : 500 sans détail', async () => {
    const { handle } = setup({ targets: 'pas une liste' });
    const r = await handle(req());
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ ok: false, error: 'server_error' });
  });
});
