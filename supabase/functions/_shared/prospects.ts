/**
 * Règles de la prospection partagées entre le front (Vite) et les Edge
 * Functions (Deno) : requête de recherche, secteurs, tranches d'effectif,
 * score déterministe, transformation des résultats de l'API Recherche
 * d'entreprises. La base (supabase/migrations/20261008090000_prospects.sql)
 * fait foi pour les réservations, statuts et quotas.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------

export const DEPARTMENT_RE = /^(0[1-9]|1[0-9]|2[1-9]|[3-8][0-9]|9[0-5]|2A|2B|97[1-46])$/;
export const NAF_RE = /^\d{2}\.\d{2}[A-Z]$/;
export const PRESET_KEYS = ['batiment', 'restauration', 'beaute', 'auto', 'commerce'] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

/** Secteurs proposés (miroir de la table naf_presets). */
export const PRESETS: Record<PresetKey, { label: string; naf: string[] }> = {
  batiment: { label: 'Artisans du bâtiment', naf: ['43.21A', '43.22A', '43.22B', '43.31Z', '43.32A', '43.33Z', '43.34Z', '43.39Z', '43.91B', '43.99C'] },
  restauration: { label: 'Restaurants et cafés', naf: ['56.10A', '56.10C', '56.30Z'] },
  beaute: { label: 'Coiffure et beauté', naf: ['96.02A', '96.02B', '96.04Z'] },
  auto: { label: 'Garages et auto', naf: ['45.20A', '45.20B', '45.32Z', '45.40Z'] },
  commerce: { label: 'Commerces de proximité', naf: ['10.71C', '10.13B', '47.76Z', '47.71Z', '47.29Z', '47.22Z'] },
};

/** Libellés NAF (rév. 2) des secteurs proposés : l'API ne renvoie que les codes. */
export const NAF_LABELS: Record<string, string> = {
  '43.21A': 'Installation électrique',
  '43.22A': 'Plomberie, eau et gaz',
  '43.22B': 'Chauffage et climatisation',
  '43.31Z': 'Plâtrerie',
  '43.32A': 'Menuiserie bois et PVC',
  '43.33Z': 'Revêtement des sols et des murs',
  '43.34Z': 'Peinture et vitrerie',
  '43.39Z': 'Finition du bâtiment',
  '43.91B': 'Couverture',
  '43.99C': 'Maçonnerie générale',
  '56.10A': 'Restauration traditionnelle',
  '56.10C': 'Restauration rapide',
  '56.30Z': 'Débit de boissons',
  '96.02A': 'Coiffure',
  '96.02B': 'Soins de beauté',
  '96.04Z': 'Entretien corporel',
  '45.20A': 'Entretien de véhicules légers',
  '45.20B': 'Entretien d’autres véhicules',
  '45.32Z': 'Commerce de pièces auto',
  '45.40Z': 'Commerce et réparation de motos',
  '10.71C': 'Boulangerie-pâtisserie',
  '10.13B': 'Charcuterie',
  '47.76Z': 'Fleuriste et animalerie',
  '47.71Z': 'Habillement',
  '47.29Z': 'Commerce alimentaire spécialisé',
  '47.22Z': 'Boucherie',
};

/** Tailles proposées → codes INSEE de tranche d'effectif salarié. */
export const SIZE_KEYS = ['solo', 'tpe', 'pme'] as const;
export type SizeKey = (typeof SIZE_KEYS)[number];
export const SIZES: Record<SizeKey, { label: string; bands: string[] }> = {
  solo: { label: 'Sans salarié', bands: ['NN', '00'] },
  tpe: { label: '1 à 9', bands: ['01', '02', '03'] },
  pme: { label: '10 à 49', bands: ['11', '12'] },
};

export const EMPLOYEE_BAND_LABELS: Record<string, string> = {
  NN: 'Sans salarié',
  '00': 'Sans salarié',
  '01': '1 ou 2 salariés',
  '02': '3 à 5 salariés',
  '03': '6 à 9 salariés',
  '11': '10 à 19 salariés',
  '12': '20 à 49 salariés',
  '21': '50 à 99 salariés',
  '22': '100 à 199 salariés',
};

export const zoneSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('departement'), value: z.string().regex(DEPARTMENT_RE) }),
  z.strictObject({ type: z.literal('code_postal'), value: z.string().regex(/^\d{5}$/) }),
  z.strictObject({
    type: z.literal('autour'),
    lat: z.number().min(41).max(51.5),
    lng: z.number().min(-5.5).max(10),
    radius_km: z.union([z.literal(5), z.literal(10), z.literal(20)]),
  }),
]);
export type Zone = z.infer<typeof zoneSchema>;

export const MAX_PAGE = 40;
export const PER_PAGE = 25;

export const searchRequestSchema = z.strictObject({
  zone: zoneSchema,
  preset: z.enum(PRESET_KEYS).optional(),
  sizes: z.array(z.enum(SIZE_KEYS)).max(3).optional(),
  page: z.number().int().min(1).max(MAX_PAGE),
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;

/** Paramètres normalisés (ordre fixe, tris) : base de la clé de cache. */
export function normalizeSearch(req: SearchRequest): Record<string, unknown> {
  const zone =
    req.zone.type === 'autour'
      ? { type: 'autour', lat: Math.round(req.zone.lat * 1000) / 1000, lng: Math.round(req.zone.lng * 1000) / 1000, radius_km: req.zone.radius_km }
      : { type: req.zone.type, value: req.zone.value };
  return {
    zone,
    preset: req.preset ?? null,
    sizes: [...new Set(req.sizes ?? [])].sort(),
    page: req.page,
  };
}

/** URL de l'API Recherche d'entreprises pour une recherche donnée. */
export function buildSearchUrl(req: SearchRequest, base = 'https://recherche-entreprises.api.gouv.fr'): string {
  const n = normalizeSearch(req);
  const params = new URLSearchParams();
  let path = '/search';
  if (req.zone.type === 'autour') {
    path = '/near_point';
    const zone = n['zone'] as { lat: number; lng: number; radius_km: number };
    params.set('lat', String(zone.lat));
    params.set('long', String(zone.lng));
    params.set('radius', String(zone.radius_km));
  } else if (req.zone.type === 'departement') {
    params.set('departement', req.zone.value);
  } else {
    params.set('code_postal', req.zone.value);
  }
  if (req.preset) params.set('activite_principale', PRESETS[req.preset].naf.join(','));
  const sizes = n['sizes'] as SizeKey[];
  if (sizes.length && req.zone.type !== 'autour') params.set('tranche_effectif_salarie', sizes.flatMap((s) => SIZES[s].bands).join(','));
  if (req.zone.type !== 'autour') params.set('etat_administratif', 'A');
  params.set('minimal', 'true');
  params.set('include', 'siege,dirigeants,complements,matching_etablissements');
  params.set('limite_matching_etablissements', '1');
  params.set('per_page', String(PER_PAGE));
  params.set('page', String(req.page));
  return `${base}${path}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Résultats de l'API → lignes « companies »
// ---------------------------------------------------------------------------

const etabSchema = z
  .object({
    siret: z.string().nullish(),
    adresse: z.string().nullish(),
    code_postal: z.string().nullish(),
    libelle_commune: z.string().nullish(),
    departement: z.string().nullish(),
    latitude: z.union([z.string(), z.number()]).nullish(),
    longitude: z.union([z.string(), z.number()]).nullish(),
    activite_principale: z.string().nullish(),
    tranche_effectif_salarie: z.string().nullish(),
    date_creation: z.string().nullish(),
    est_siege: z.boolean().nullish(),
    etat_administratif: z.string().nullish(),
  })
  .loose();

const dirigeantSchema = z
  .object({
    nom: z.string().nullish(),
    prenoms: z.string().nullish(),
    denomination: z.string().nullish(),
    qualite: z.string().nullish(),
  })
  .loose();

export const apiResultSchema = z
  .object({
    siren: z.string(),
    nom_complet: z.string().nullish(),
    nom_raison_sociale: z.string().nullish(),
    activite_principale: z.string().nullish(),
    date_creation: z.string().nullish(),
    nature_juridique: z.string().nullish(),
    tranche_effectif_salarie: z.string().nullish(),
    statut_diffusion: z.string().nullish(),
    etat_administratif: z.string().nullish(),
    siege: etabSchema.nullish(),
    matching_etablissements: z.array(etabSchema).nullish(),
    dirigeants: z.array(dirigeantSchema).nullish(),
    complements: z.object({ est_entrepreneur_individuel: z.boolean().nullish() }).loose().nullish(),
  })
  .loose();

export const apiResponseSchema = z
  .object({
    results: z.array(z.unknown()),
    total_results: z.number().int().min(0),
    page: z.number().int().optional(),
    total_pages: z.number().int().optional(),
  })
  .loose();

export interface CompanyRow {
  siret: string;
  name: string;
  naf: string | null;
  naf_label: string | null;
  employee_band: string | null;
  legal_category: string | null;
  is_sole_trader: boolean;
  created_on: string | null;
  is_head_office: boolean | null;
  address: string | null;
  postcode: string | null;
  city: string | null;
  department: string | null;
  latitude: number | null;
  longitude: number | null;
  officers: { nom?: string; prenoms?: string; denomination?: string; qualite?: string }[];
}

const clean = (v: string | null | undefined, max = 300): string | null => {
  const s = (v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const num = (v: string | number | null | undefined): number | null => {
  const n = typeof v === 'number' ? v : Number.parseFloat(v ?? '');
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
};
const isoDate = (v: string | null | undefined): string | null => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Département déduit du code postal (Corse : 2A/2B selon le code). */
export function departmentFromPostcode(postcode: string | null): string | null {
  if (!postcode || !/^\d{5}$/.test(postcode)) return null;
  if (postcode.startsWith('97')) return postcode.slice(0, 3);
  if (postcode.startsWith('20')) return Number(postcode) < 20200 ? '2A' : '2B';
  return postcode.slice(0, 2);
}

/**
 * Transforme un résultat de l'API en ligne « companies ». Renvoie null si
 * l'entreprise ne doit pas être proposée : non diffusible, fermée, sans
 * établissement actif ou SIRET invalide.
 */
export function toCompanyRow(raw: unknown): CompanyRow | null {
  const parsed = apiResultSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (r.statut_diffusion && r.statut_diffusion !== 'O') return null;
  if (r.etat_administratif && r.etat_administratif !== 'A') return null;
  // L'établissement qui correspond au filtre géographique, sinon le siège.
  const etab = r.matching_etablissements?.find((e) => e.etat_administratif !== 'F') ?? r.siege ?? null;
  if (!etab || etab.etat_administratif === 'F') return null;
  const siret = etab.siret ?? '';
  if (!/^\d{14}$/.test(siret) || !siret.startsWith(r.siren)) return null;
  const name = clean(r.nom_complet ?? r.nom_raison_sociale);
  if (!name) return null;
  const naf = r.activite_principale && NAF_RE.test(r.activite_principale) ? r.activite_principale : null;
  const postcode = clean(etab.code_postal, 5);
  return {
    siret,
    name,
    naf,
    naf_label: naf ? (NAF_LABELS[naf] ?? null) : null,
    employee_band: clean(r.tranche_effectif_salarie ?? etab.tranche_effectif_salarie, 2),
    legal_category: clean(r.nature_juridique, 4),
    is_sole_trader: r.complements?.est_entrepreneur_individuel === true,
    created_on: isoDate(r.date_creation ?? etab.date_creation),
    is_head_office: etab.est_siege ?? null,
    address: clean(etab.adresse),
    postcode,
    city: clean(etab.libelle_commune, 100),
    department: clean(etab.departement, 3) ?? departmentFromPostcode(postcode),
    latitude: num(etab.latitude),
    longitude: num(etab.longitude),
    // Jamais la date ni l'année de naissance : nom, prénoms, qualité seulement.
    officers: (r.dirigeants ?? []).slice(0, 5).map((d) =>
      d.denomination
        ? { denomination: clean(d.denomination, 200) ?? '', qualite: clean(d.qualite, 100) ?? '' }
        : { nom: clean(d.nom, 100) ?? '', prenoms: clean(d.prenoms, 100) ?? '', qualite: clean(d.qualite, 100) ?? '' },
    ),
  };
}

// ---------------------------------------------------------------------------
// Score (déterministe : même entrée, même score ; jamais de hasard)
// ---------------------------------------------------------------------------

const SMALL_BANDS = new Set(['NN', '00', '01', '02', '03']);

/**
 * Probabilité qu'une entreprise ait besoin des services proposés, de 0 à 100 :
 * jeune entreprise (moins de 3 ans), petite structure, établissement
 * principal. Indicatif ; la date de référence est passée en paramètre.
 */
export function prospectScore(
  c: { created_on: string | null; employee_band: string | null; is_head_office: boolean | null },
  today: Date,
): number {
  let score = 30;
  if (c.created_on) {
    const years = (today.getTime() - new Date(`${c.created_on}T00:00:00Z`).getTime()) / (365.25 * 86_400_000);
    if (years < 3) score += 35;
    else if (years < 10) score += 15;
  }
  if (c.employee_band === null || SMALL_BANDS.has(c.employee_band)) score += 20;
  else if (c.employee_band === '11' || c.employee_band === '12') score += 10;
  if (c.is_head_office) score += 15;
  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Réponse de prospects-search (validée par le front)
// ---------------------------------------------------------------------------

export const SEARCH_ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'forbidden_origin',
  'method_not_allowed',
  'unsupported_media_type',
  'payload_too_large',
  'rate_limited',
  'quota_exceeded',
  'onboarding_required',
  'disabled',
  'source_busy',
  'unavailable',
  'server_error',
] as const;
export type SearchErrorCode = (typeof SEARCH_ERROR_CODES)[number];

export const searchItemSchema = z.object({
  siret: z.string().regex(/^\d{14}$/),
  name: z.string(),
  naf: z.string().nullable(),
  naf_label: z.string().nullable(),
  city: z.string().nullable(),
  postcode: z.string().nullable(),
  employee_band: z.string().nullable(),
  created_on: z.string().nullable(),
  is_head_office: z.boolean().nullable(),
  is_sole_trader: z.boolean(),
  state: z.enum(['libre', 'a_moi', 'deja_suivie', 'en_pause']),
  claim_id: z.string().nullable(),
  cooldown_until: z.string().nullable(),
  score: z.number().int().min(0).max(100),
});
export type SearchItem = z.infer<typeof searchItemSchema>;

export const searchResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    page: z.number().int(),
    total: z.number().int(),
    has_more: z.boolean(),
    items: z.array(searchItemSchema),
    quota: z.object({ used: z.number().int(), limit: z.number().int() }),
  }),
  z.object({ ok: z.literal(false), error: z.enum(SEARCH_ERROR_CODES) }),
]);
export type SearchResponse = z.infer<typeof searchResponseSchema>;

// ---------------------------------------------------------------------------
// Opposition (formulaire public et lien des emails)
// ---------------------------------------------------------------------------

export const oppositionRequestSchema = z.union([
  z.strictObject({ token: z.string().regex(/^[0-9a-f]{48}$/) }),
  z.strictObject({
    siren: z
      .string()
      .transform((s) => s.replace(/\s/g, ''))
      .pipe(z.string().regex(/^\d{9}$/))
      .optional(),
    email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
    turnstileToken: z.string().max(4096),
  }).refine((v) => v.siren !== undefined || v.email !== undefined, { message: 'SIREN ou email requis' }),
]);
export type OppositionRequest = z.input<typeof oppositionRequestSchema>;
