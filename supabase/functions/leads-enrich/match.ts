/**
 * Rattachement d'un lieu trouvé sur Google Maps à l'entreprise SIRENE
 * correspondante (API Recherche d'entreprises) : par le SIREN lu dans les
 * mentions légales du site si possible, sinon par le nom et le code postal,
 * avec un seuil de ressemblance strict (jamais « au plus proche »).
 */
import { apiResponseSchema, toCompanyRow, type CompanyRow } from '../_shared/prospects.ts';
import type { FetchLike } from '../_shared/rest.ts';

const LEGAL = new Set(['sarl', 'sas', 'sasu', 'eurl', 'sa', 'sci', 'snc', 'ei', 'eirl', 'ets', 'etablissements', 'entreprise', 'societe', 'et', 'de', 'du', 'des', 'la', 'le', 'les', 'l', 'd']);

export function tokens(name: string): Set<string> {
  return new Set(
    name
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && !LEGAL.has(t)),
  );
}

/** Part des mots du nom le plus court présents dans l'autre (0 à 1). */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.min(ta.size, tb.size);
}

export const MIN_SIMILARITY = 0.6;

export async function matchCompany(
  fetchFn: FetchLike,
  apiBase: string,
  place: { name: string; postcode: string | null },
  siren: string | null,
): Promise<CompanyRow | null> {
  const params = new URLSearchParams({ minimal: 'true', include: 'siege,dirigeants,complements,matching_etablissements', limite_matching_etablissements: '1', per_page: '5' });
  if (siren) params.set('q', siren);
  else {
    if (!place.postcode || !/^\d{5}$/.test(place.postcode) || !place.name) return null;
    params.set('q', place.name.slice(0, 100));
    params.set('code_postal', place.postcode);
    params.set('etat_administratif', 'A');
  }
  const res = await fetchFn(`${apiBase}/search?${params.toString()}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = apiResponseSchema.safeParse(await res.json());
  if (!data.success) return null;
  const rows = data.data.results.map(toCompanyRow).filter((r): r is CompanyRow => r !== null);
  if (siren) return rows.find((r) => r.siret.startsWith(siren)) ?? null;
  const scored = rows
    .filter((r) => r.postcode === place.postcode)
    .map((r) => ({ r, s: similarity(place.name, r.name) }))
    .filter((x) => x.s >= MIN_SIMILARITY)
    .sort((x, y) => y.s - x.s);
  // Deux candidats aussi ressemblants : ambigu, on s'abstient.
  const [first, second] = scored;
  if (first && second?.s === first.s) return null;
  return scored[0]?.r ?? null;
}
