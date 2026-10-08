/**
 * Moteur de prospection (« moteur Huntlist », côté serveur). Appelé par une
 * tâche planifiée, jamais par le navigateur. À chaque passage :
 *   1. zones à alimenter (campagnes actives qui manquent d'entreprises) ;
 *   2. communes du département (geo.api.gouv.fr), des plus peuplées aux
 *      moins peuplées, × mots-clés du secteur ; chaque requête n'est jouée
 *      qu'une fois tous les 90 jours et passe par le coupe-circuit budgétaire ;
 *   3. Google Maps (une requête = 20 lieux avec leur site) ;
 *   4. pour chaque lieu nouveau : lecture du site (adresse générique publiée,
 *      SIREN des mentions légales) puis rattachement SIRENE ;
 *   5. enregistrement de l'entreprise SIRENE et de l'adresse avec sa page
 *      source. Aucun contenu Google n'est conservé (place_id seulement).
 * Durée bornée ; journaux sans donnée personnelle ni nom d'entreprise.
 */
import { z } from 'zod';
import { RpcError, callRpc, type FetchLike } from '../_shared/rest.ts';
import { jsonResponse, sha256Hex, sleep } from '../_shared/http.ts';
import type { ConfigResult } from './config.ts';
import { matchCompany } from './match.ts';
import { PLACES_COST_MICRO_USD, PlacesError, searchPlaces, type Place } from './places.ts';
import { scrapeSite, type Resolver } from './scrape.ts';

/** Mots-clés Google Maps par secteur (mêmes secteurs que naf_presets). */
export const KEYWORDS: Record<string, string[]> = {
  batiment: ['plombier', 'électricien', 'chauffagiste', 'menuisier', 'peintre en bâtiment', 'maçon', 'couvreur', 'carreleur', 'plaquiste'],
  restauration: ['restaurant', 'pizzeria', 'bar', 'traiteur'],
  beaute: ['coiffeur', 'institut de beauté', 'barbier', 'onglerie'],
  auto: ['garage automobile', 'carrosserie', 'réparation moto'],
  commerce: ['boulangerie', 'fleuriste', 'boucherie', 'charcuterie', 'boutique de vêtements'],
};

export const TIME_BUDGET_MS = 110_000;
export const MAX_QUERIES_PER_RUN = 12;
export const SITE_CONCURRENCY = 5;

export interface HandlerDeps {
  config: ConfigResult;
  fetch: FetchLike;
  log: (event: string, data?: Record<string, string | number | boolean | string[]>) => void;
  resolve?: Resolver | null;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

const targetsSchema = z.array(z.object({ department: z.string(), preset: z.string(), missing: z.number() }));
const communesSchema = z.array(z.object({ nom: z.string(), code: z.string(), population: z.number().optional() }).loose());

/** Comparaison en temps constant (secret de planification). */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => Date.now());
  const wait = deps.wait ?? sleep;
  if (!deps.config.ok) deps.log('config_invalid', { variables: deps.config.missing });

  return async function handle(req: Request): Promise<Response> {
    if (!deps.config.ok) return jsonResponse(503, { ok: false, error: 'unavailable' });
    const config = deps.config.config;
    if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'method_not_allowed' });
    if (!sameSecret(req.headers.get('x-cron-secret') ?? '', config.cronSecret)) {
      deps.log('forbidden');
      return jsonResponse(403, { ok: false, error: 'forbidden' });
    }
    const rpc = (fn: string, args: Record<string, unknown>) => callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, fn, args);
    const started = now();
    const stats = { queries: 0, places: 0, contacts: 0, no_site: 0, no_email: 0, no_match: 0, budget_stop: false };

    try {
      const targets = targetsSchema.parse(await rpc('enrich_targets', { p_limit: 3 }));
      outer: for (const target of targets) {
        const keywords = KEYWORDS[target.preset];
        if (!keywords) continue;
        const communes = await fetchCommunes(target.department);
        let found = 0;
        for (const commune of communes) {
          for (const keyword of keywords) {
            if (now() - started > TIME_BUDGET_MS || stats.queries >= MAX_QUERIES_PER_RUN) break outer;
            if (found >= target.missing) continue outer;
            const key = `${target.department}|${target.preset}|${commune.code}|${await sha256Hex(keyword).then((h) => h.slice(0, 12))}`;
            if ((await rpc('enrich_query_begin', { p_key: key, p_department: target.department, p_preset: target.preset })) !== true) continue;
            if ((await rpc('budget_consume', { p_metric: 'places', p_micro_usd: PLACES_COST_MICRO_USD })) !== true) {
              stats.budget_stop = true;
              deps.log('budget_exhausted');
              break outer;
            }
            stats.queries++;
            let places: Place[];
            try {
              places = await searchPlaces(deps.fetch, config.placesKey, `${keyword} ${commune.nom}`);
            } catch (error) {
              deps.log('places_error', { status: error instanceof PlacesError ? error.status : 0 });
              if (error instanceof PlacesError && (error.status === 403 || error.status === 429)) break outer;
              continue;
            }
            const unseen = new Set(z.array(z.string()).parse(await rpc('enrich_unseen', { p_place_ids: places.map((p) => p.id) })));
            const todo = places.filter((p) => unseen.has(p.id) && p.operational);
            let contacts = 0;
            for (let i = 0; i < todo.length; i += SITE_CONCURRENCY) {
              const batch = todo.slice(i, i + SITE_CONCURRENCY);
              const results = await Promise.all(batch.map((p) => processPlace(p)));
              contacts += results.filter(Boolean).length;
            }
            stats.places += todo.length;
            stats.contacts += contacts;
            found += contacts;
            await rpc('enrich_query_done', { p_key: key, p_results: contacts });
          }
        }
      }
      deps.log('enrich_done', { ...stats, ms: now() - started });
      return jsonResponse(200, { ok: true, ...stats });
    } catch (error) {
      deps.log('server_error', { reason: error instanceof RpcError ? `http_${String(error.status)}_${error.code ?? 'none'}` : error instanceof z.ZodError ? 'invalid_payload' : 'exception' });
      return jsonResponse(500, { ok: false, error: 'server_error' });
    }

    async function fetchCommunes(department: string) {
      const res = await deps.fetch(`${config.geoBase}/departements/${encodeURIComponent(department)}/communes?fields=nom,code,population`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const list = communesSchema.safeParse(await res.json());
      if (!list.success) return [];
      return [...list.data].sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
    }

    /** true si une adresse a été enregistrée. */
    async function processPlace(place: Place): Promise<boolean> {
      try {
        if (!place.website) {
          stats.no_site++;
          await rpc('enrich_mark_seen', { p_place_id: place.id, p_siret: null, p_outcome: 'no_site' });
          return false;
        }
        const site = await scrapeSite(deps.fetch, place.website, place.name, deps.resolve ?? null);
        if (!site.email || !site.sourceUrl) {
          stats.no_email++;
          await rpc('enrich_mark_seen', { p_place_id: place.id, p_siret: null, p_outcome: 'no_email' });
          return false;
        }
        // Même limiteur global que prospects-search (API publique : 7 appels/s par IP).
        let slot = false;
        for (let i = 0; i < 5 && !slot; i++) {
          slot = (await rpc('rate_limit_hit', { p_bucket: 'reapi:global', p_max: 5, p_window_seconds: 1 })) === true;
          if (!slot) await wait(250);
        }
        if (!slot) throw new Error('source_busy');
        const company = await matchCompany(deps.fetch, config.apiBase, place, site.siren);
        if (!company) {
          stats.no_match++;
          await rpc('enrich_mark_seen', { p_place_id: place.id, p_siret: null, p_outcome: 'no_match' });
          return false;
        }
        await rpc('enrich_save_contact', { p_company: company, p_email: site.email, p_phone: site.phone, p_source_url: site.sourceUrl });
        await rpc('enrich_mark_seen', { p_place_id: place.id, p_siret: company.siret, p_outcome: 'contact' });
        return true;
      } catch {
        await rpc('enrich_mark_seen', { p_place_id: place.id, p_siret: null, p_outcome: 'error' }).catch(() => undefined);
        return false;
      }
    }
  };
}
