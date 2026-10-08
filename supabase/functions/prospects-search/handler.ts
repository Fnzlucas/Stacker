/**
 * Recherche d'entreprises à prospecter (onglet « Trouver »). Logique HTTP
 * testée par Vitest ; index.ts branche l'environnement Deno.
 *
 * Contrôles, dans l'ordre : configuration → origine (CORS) → méthode →
 * corps (taille, JSON, Zod strict) → jeton utilisateur validé par Supabase
 * Auth → rate limit par compte (10/min) → prospects_search_begin (compte
 * onboardé, interrupteur, quota du jour) → cache mutualisé → sinon API
 * Recherche d'entreprises, sous un limiteur GLOBAL de 5 appels/s et dans le
 * respect de Retry-After → enregistrement (entreprises + cache 7 jours) →
 * annotation pour l'appelant (opposés retirés, état de chaque entreprise) →
 * score déterministe.
 *
 * Journaux sans donnée personnelle : ni nom d'entreprise, ni SIRET, ni
 * identifiant d'utilisateur.
 */
import { z } from 'zod';
import { RpcError, callRpc, fetchAuthUser, type FetchLike } from '../_shared/rest.ts';
import { bearer, corsHeaders, jsonResponse, readJson, sha256Hex, sleep } from '../_shared/http.ts';
import {
  MAX_PAGE,
  PER_PAGE,
  SIZES,
  apiResponseSchema,
  buildSearchUrl,
  normalizeSearch,
  prospectScore,
  searchItemSchema,
  searchRequestSchema,
  toCompanyRow,
  type CompanyRow,
  type SearchErrorCode,
  type SearchItem,
  type SearchRequest,
} from '../_shared/prospects.ts';
import type { ConfigResult } from './config.ts';

export const MAX_BODY_BYTES = 2048;
export const USER_RATE = { max: 10, windowSeconds: 60 } as const;
/** Limite publique : 7 appels/s par IP. Les Edge Functions partagent leurs IP : on reste à 5. */
export const GLOBAL_RATE = { bucket: 'reapi:global', max: 5, windowSeconds: 1 } as const;
export const GLOBAL_TRIES = 3;
export const MAX_RETRY_AFTER_MS = 2000;

export interface HandlerDeps {
  config: ConfigResult;
  fetch: FetchLike;
  log: (event: string, data?: Record<string, string | number | boolean | string[]>) => void;
  /** Horloge injectable (date du jour pour le score). */
  now?: () => Date;
  /** Attente injectable (tests). */
  wait?: (ms: number) => Promise<void>;
}

const fail = (status: number, error: SearchErrorCode, extra: Record<string, string> = {}): Response => jsonResponse(status, { ok: false, error }, extra);

const cacheSchema = z.object({ sirets: z.array(z.string()), total: z.number().int() }).nullable();
const beginSchema = z.object({ used: z.number().int(), limit: z.number().int() });
const annotatedSchema = z.array(searchItemSchema.omit({ score: true }).loose());

class SourceBusy extends Error {}

/** Message d'erreur SQL levé par une fonction (raise exception '<code>'). */
const sqlCode = (error: unknown): string | null => (error instanceof RpcError ? error.message : null);

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const wait = deps.wait ?? sleep;
  if (!deps.config.ok) deps.log('config_invalid', { variables: deps.config.missing });

  return async function handle(req: Request): Promise<Response> {
    if (!deps.config.ok) return fail(503, 'unavailable');
    const config = deps.config.config;
    const rpc = (fn: string, args: Record<string, unknown>) => callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, fn, args);

    const origin = req.headers.get('origin');
    if (!origin || !config.allowedOrigins.has(origin)) {
      deps.log('forbidden_origin');
      return fail(403, 'forbidden_origin');
    }
    const cors = corsHeaders(origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', { ...cors, Allow: 'POST, OPTIONS' });

    const body = await readJson(req, MAX_BODY_BYTES);
    if (!body.ok) return fail(body.status, body.status === 415 ? 'unsupported_media_type' : body.status === 413 ? 'payload_too_large' : 'invalid_request', cors);
    const parsed = searchRequestSchema.safeParse(body.value);
    if (!parsed.success) return fail(400, 'invalid_request', cors);
    const input = parsed.data;

    const token = bearer(req);
    if (!token) return fail(401, 'unauthorized', cors);

    try {
      const user = await fetchAuthUser(deps.fetch, config.supabaseUrl, config.anonKey, token);
      if (!user) {
        deps.log('unauthorized');
        return fail(401, 'unauthorized', cors);
      }

      const bucket = `prospects-search:${await sha256Hex(`${config.rateLimitPepper}:${user.id}`)}`;
      const allowed = await rpc('rate_limit_hit', { p_bucket: bucket, p_max: USER_RATE.max, p_window_seconds: USER_RATE.windowSeconds });
      if (allowed !== true) {
        deps.log('rate_limited');
        return fail(429, 'rate_limited', { ...cors, 'Retry-After': String(USER_RATE.windowSeconds) });
      }

      let quota: z.infer<typeof beginSchema>;
      try {
        quota = beginSchema.parse(await rpc('prospects_search_begin', { p_user: user.id }));
      } catch (error) {
        const code = sqlCode(error);
        if (code === 'daily_quota') return fail(429, 'quota_exceeded', cors);
        if (code === 'onboarding_required') return fail(403, 'onboarding_required', cors);
        if (code === 'disabled') return fail(503, 'disabled', cors);
        throw error;
      }

      const key = await sha256Hex(JSON.stringify(normalizeSearch(input)));
      let page = cacheSchema.parse(await rpc('prospects_cache_get', { p_key: key }));
      let source: 'cache' | 'api' = 'cache';
      if (!page) {
        source = 'api';
        let rows: CompanyRow[];
        let total: number;
        try {
          ({ rows, total } = await fetchFromApi(input));
        } catch (error) {
          if (error instanceof SourceBusy) {
            deps.log('source_busy');
            return fail(503, 'source_busy', { ...cors, 'Retry-After': '2' });
          }
          throw error;
        }
        await rpc('prospects_cache_put', { p_key: key, p_params: normalizeSearch(input), p_total: total, p_companies: rows });
        page = { sirets: rows.map((r) => r.siret), total };
      }

      const annotated = annotatedSchema.parse(page.sirets.length ? await rpc('prospects_annotate', { p_user: user.id, p_sirets: page.sirets }) : []);
      const today = now();
      const items: SearchItem[] = annotated.map((a) => ({
        siret: a.siret,
        name: a.name,
        naf: a.naf,
        naf_label: a.naf_label,
        city: a.city,
        postcode: a.postcode,
        employee_band: a.employee_band,
        created_on: a.created_on,
        is_head_office: a.is_head_office,
        is_sole_trader: a.is_sole_trader,
        state: a.state,
        claim_id: a.claim_id,
        cooldown_until: a.cooldown_until,
        score: prospectScore(a, today),
      }));
      const total = Math.min(page.total, MAX_PAGE * PER_PAGE);
      deps.log('search_ok', { source, items: items.length, page: input.page });
      return jsonResponse(200, { ok: true, page: input.page, total, has_more: input.page * PER_PAGE < total && input.page < MAX_PAGE, items, quota }, cors);
    } catch (error) {
      deps.log('server_error', { reason: error instanceof RpcError ? `http_${String(error.status)}_${error.code ?? 'none'}` : error instanceof z.ZodError ? 'invalid_payload' : 'exception' });
      return fail(500, 'server_error', cors);
    }

    /** Appel de l'API publique : limiteur global, Retry-After, validation. */
    async function fetchFromApi(input: SearchRequest): Promise<{ rows: CompanyRow[]; total: number }> {
      for (let attempt = 0; ; attempt++) {
        let slot = false;
        for (let i = 0; i < GLOBAL_TRIES && !slot; i++) {
          slot = (await rpc('rate_limit_hit', { p_bucket: GLOBAL_RATE.bucket, p_max: GLOBAL_RATE.max, p_window_seconds: GLOBAL_RATE.windowSeconds })) === true;
          if (!slot && i < GLOBAL_TRIES - 1) await wait(200);
        }
        if (!slot) throw new SourceBusy();

        let res: Response;
        try {
          res = await deps.fetch(buildSearchUrl(input, config.apiBase), {
            method: 'GET',
            headers: { accept: 'application/json', 'user-agent': 'Stacker/1.0 (prospection B2B ; contact via le site)' },
            signal: AbortSignal.timeout(8000),
          });
        } catch {
          throw new SourceBusy();
        }
        if (res.status === 429 && attempt === 0) {
          const retryAfter = Number(res.headers.get('retry-after') ?? '1');
          const ms = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000;
          if (ms > MAX_RETRY_AFTER_MS) throw new SourceBusy();
          await wait(ms);
          continue;
        }
        if (!res.ok) throw new SourceBusy();
        const data = apiResponseSchema.safeParse(await res.json());
        if (!data.success) throw new SourceBusy();
        let rows = data.data.results.map(toCompanyRow).filter((r): r is CompanyRow => r !== null);
        // /near_point n'accepte pas le filtre d'effectif : il est appliqué ici.
        if (input.zone.type === 'autour' && input.sizes?.length) {
          const bands = new Set(input.sizes.flatMap((s) => SIZES[s].bands));
          rows = rows.filter((r) => r.employee_band !== null && bands.has(r.employee_band));
        }
        const seen = new Set<string>();
        rows = rows.filter((r) => !seen.has(r.siret) && seen.add(r.siret));
        return { rows, total: data.data.total_results };
      }
    }
  };
}
