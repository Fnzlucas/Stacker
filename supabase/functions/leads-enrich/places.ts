/**
 * Google Places API (New) — Text Search, côté serveur uniquement (clé serveur
 * restreinte à cette API). UNE requête renvoie jusqu'à 20 lieux avec site et
 * téléphone (SKU Enterprise, ~35 $ / 1 000 requêtes au tarif public).
 * Rien de ce qui est renvoyé n'est stocké, sauf le place_id (autorisé).
 */
import { z } from 'zod';
import type { FetchLike } from '../_shared/rest.ts';

export const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
export const FIELD_MASK = 'places.id,places.displayName,places.addressComponents,places.websiteUri,places.businessStatus';
/** Coût estimé d'une requête (micro-dollars), pour le coupe-circuit. */
export const PLACES_COST_MICRO_USD = 35_000;

const placeSchema = z
  .object({
    id: z.string().min(10).max(300),
    displayName: z.object({ text: z.string() }).loose().optional(),
    websiteUri: z.string().optional(),
    businessStatus: z.string().optional(),
    addressComponents: z.array(z.object({ longText: z.string().optional(), shortText: z.string().optional(), types: z.array(z.string()).optional() }).loose()).optional(),
  })
  .loose();

const responseSchema = z.object({ places: z.array(placeSchema).optional() }).loose();

export interface Place {
  id: string;
  name: string;
  website: string | null;
  postcode: string | null;
  operational: boolean;
}

export class PlacesError extends Error {
  constructor(readonly status: number) {
    super(`places http ${String(status)}`);
    this.name = 'PlacesError';
  }
}

export async function searchPlaces(fetchFn: FetchLike, apiKey: string, textQuery: string): Promise<Place[]> {
  const res = await fetchFn(PLACES_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify({ textQuery, languageCode: 'fr', regionCode: 'FR', pageSize: 20 }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new PlacesError(res.status);
  const parsed = responseSchema.safeParse(await res.json());
  if (!parsed.success) throw new PlacesError(502);
  return (parsed.data.places ?? []).map((p) => ({
    id: p.id,
    name: (p.displayName?.text ?? '').trim(),
    website: p.websiteUri ?? null,
    postcode: p.addressComponents?.find((c) => c.types?.includes('postal_code'))?.longText ?? null,
    operational: !p.businessStatus || p.businessStatus === 'OPERATIONAL',
  }));
}
