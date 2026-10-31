/**
 * Entraînement à l'appel face à une IA : commerçants proposés (fiche
 * publique seulement : ce qu'un stacker verrait en préparant son appel),
 * lecture de la progression (my_roleplay, roleplay_detail) et appels à
 * l'Edge Function « roleplay » (start, say, finish).
 *
 * La fiche complète de chaque commerçant reste côté serveur
 * (supabase/functions/roleplay/scenarios.ts) : un test vérifie que les
 * identifiants correspondent.
 */
import { z } from 'zod';
import { ApiError } from './apiError';
import type { Backend } from './supabase';

export type Difficulty = 'facile' | 'moyen' | 'difficile';

export interface RoleplayScenario {
  id: string;
  business: string;
  contact: string;
  role: string;
  city: string;
  difficulty: Difficulty;
  /** Voix du commerçant (choix de la voix de synthèse). */
  voice: 'f' | 'm';
  /** Ce que tu as remarqué en préparant l'appel (l'audit en 60 secondes). */
  noticed: string[];
  /** Offres qui peuvent correspondre. */
  offers: string;
}

export const ROLEPLAY_SCENARIOS: readonly RoleplayScenario[] = [
  {
    id: 'boulangerie',
    business: 'Boulangerie Martin',
    contact: 'Sophie Martin',
    role: 'gérante',
    city: 'Nîmes',
    difficulty: 'facile',
    voice: 'f',
    noticed: ['Note Google de 4,7, mais le dernier avis date de 11 mois.', 'Aucune photo du magasin sur la fiche.', 'Horaires du dimanche : la fiche indique 19 h.'],
    offers: 'Google My Business, QR Avis Google',
  },
  {
    id: 'garage',
    business: 'Garage du Pont',
    contact: 'Marc Lopez',
    role: 'patron',
    city: 'Avignon',
    difficulty: 'moyen',
    voice: 'm',
    noticed: ['Note Google de 3,9 sur 61 avis.', 'Trois avis négatifs récents, aucune réponse du garage.', 'Pas de site internet à jour.'],
    offers: 'E-Réputation Google, QR Avis Google',
  },
  {
    id: 'menuiserie',
    business: 'Menuiserie Roux',
    contact: 'Thierry Roux',
    role: 'artisan menuisier',
    city: 'Uzès',
    difficulty: 'moyen',
    voice: 'm',
    noticed: ['Aucun site internet.', 'Fiche Google sans photo de réalisations.', 'Quelques avis très élogieux sur la qualité du travail.'],
    offers: 'Site web Alma Company, Pack Site + SEO',
  },
  {
    id: 'coiffure',
    business: 'Salon Inès',
    contact: 'Inès Benali',
    role: 'gérante',
    city: 'Montpellier',
    difficulty: 'difficile',
    voice: 'f',
    noticed: ['Compte Instagram sans publication depuis 8 mois.', 'Belle fiche Google, 4,8 de note.', 'Salon de 2 coiffeuses, clientèle plutôt jeune.'],
    offers: 'Contenu Réseaux Sociaux',
  },
  {
    id: 'hotel',
    business: 'Hôtel du Rhône',
    contact: 'Claire Dumas',
    role: 'directrice',
    city: 'Arles',
    difficulty: 'moyen',
    voice: 'f',
    noticed: ['Hôtel indépendant de 32 chambres.', 'Plusieurs avis : « personnel sympa mais peu de services ».', 'Pas de conciergerie mentionnée sur le site.'],
    offers: 'InRoom (conciergerie en chambre)',
  },
  {
    id: 'restaurant',
    business: 'Le Petit Comptoir',
    contact: 'Karim Haddad',
    role: 'patron',
    city: 'Lyon',
    difficulty: 'difficile',
    voice: 'm',
    noticed: ['4,6 de note sur plus de 300 avis.', 'Instagram actif, site correct.', 'Quatre avis négatifs récents sur l’attente du samedi soir, sans réponse.'],
    offers: 'E-Réputation Google',
  },
];

export const scenarioById = (id: string): RoleplayScenario | undefined => ROLEPLAY_SCENARIOS.find((s) => s.id === id);

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile' };

export const CRITERIA_LABEL: Record<string, string> = {
  presentation: 'Présentation',
  accroche: 'Accroche',
  decouverte: 'Questions et écoute',
  offre: 'Présentation de l’offre',
  conclusion: 'Conclusion',
};

export const OUTCOME_LABEL: Record<string, string> = {
  signe: 'Le commerçant a accepté',
  rendez_vous: 'Rendez-vous obtenu',
  a_rappeler: 'À rappeler',
  refus: 'Refus',
  raccroche: 'Le commerçant a raccroché',
};

// -----------------------------------------------------------------------------
// Lecture (RPC)
// -----------------------------------------------------------------------------

const historySchema = z.object({
  id: z.uuid(),
  scenario: z.string(),
  status: z.enum(['en_cours', 'terminee', 'abandonnee']),
  score: z.number().int().nullable(),
  passed: z.boolean(),
  started_at: z.string(),
});
export const roleplayStateSchema = z.object({
  required: z.boolean(),
  passed: z.boolean(),
  /** Accord donné pour l'envoi de l'appel à l'IA (obligatoire avant le premier appel). */
  consented: z.boolean(),
  pass_score: z.number().int(),
  min_stacker_turns: z.number().int(),
  today: z.object({ used: z.number().int(), limit: z.number().int() }),
  history: z.array(historySchema),
});
export type RoleplayState = z.infer<typeof roleplayStateSchema>;

const criterionSchema = z.object({ note: z.number(), commentaire: z.string() });
export const feedbackSchema = z.object({
  criteres: z.object({ presentation: criterionSchema, accroche: criterionSchema, decouverte: criterionSchema, offre: criterionSchema, conclusion: criterionSchema }),
  points_forts: z.array(z.string()),
  a_ameliorer: z.array(z.string()),
  phrase_cle: z.string(),
  resume: z.string(),
  faute_grave: z.string().nullable(),
  issue: z.string(),
});
export type Feedback = z.infer<typeof feedbackSchema>;

export const detailSchema = z.object({
  id: z.uuid(),
  scenario: z.string(),
  status: z.enum(['en_cours', 'terminee', 'abandonnee']),
  score: z.number().int().nullable(),
  passed: z.boolean(),
  feedback: feedbackSchema.nullable(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  turns: z.array(z.object({ role: z.enum(['stacker', 'prospect']), text: z.string() })),
});
export type RoleplayDetail = z.infer<typeof detailSchema>;

async function rpc<T>(b: Backend, fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const res = await b.db.rpc(fn, args);
  if (res.error) {
    if (res.status === 0 || /fetch|network/i.test(res.error.message)) throw new ApiError('network');
    if (res.status === 401 || res.error.code === 'PGRST301' || res.error.code === 'PGRST303') throw new ApiError('unauthorized');
    if (res.error.message === 'not_found') throw new RoleplayError('not_found');
    throw new ApiError('server', res.error.message);
  }
  const parsed = schema.safeParse(res.data as unknown);
  if (!parsed.success) throw new ApiError('server', `${fn} illisible`);
  return parsed.data;
}

export const fetchRoleplay = (b: Backend) => rpc(b, 'my_roleplay', {}, roleplayStateSchema);
export const giveRoleplayConsent = (b: Backend) => rpc(b, 'roleplay_consent', { p_accept: true }, z.null());
export const fetchRoleplayDetail = (b: Backend, id: string) => rpc(b, 'roleplay_detail', { p_session: id }, detailSchema);

/** L'entraînement est exigé et pas encore réussi : la signature est bloquée. */
export const needsTraining = (s: RoleplayState | undefined): boolean => Boolean(s?.required && !s.passed);

// -----------------------------------------------------------------------------
// Appels à l'Edge Function
// -----------------------------------------------------------------------------

export class RoleplayError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'RoleplayError';
  }
}

const MESSAGES: Record<string, string> = {
  daily_quota: 'Tu as fait toutes tes simulations du jour. Reviens demain pour continuer à t’entraîner.',
  unavailable: 'L’entraînement est momentanément indisponible. Réessaie un peu plus tard.',
  ai_unavailable: 'Le commerçant n’a pas pu répondre. Réessaie dans un instant.',
  session_closed: 'Cet appel est terminé. Lance une nouvelle simulation.',
  too_long: 'L’appel a atteint sa durée maximale. Raccroche pour voir ton bilan.',
  not_found: 'Cet appel est introuvable. Lance une nouvelle simulation.',
  onboarding_required: 'Termine ton inscription pour t’entraîner.',
  consent_required: 'Donne ton accord (en haut de l’écran) avant ton premier appel.',
  invalid_request: 'Ta phrase est vide ou trop longue.',
};

export function roleplayErrorMessage(error: unknown): string {
  if (error instanceof RoleplayError) return MESSAGES[error.code] ?? 'Une erreur est survenue. Réessaie.';
  if (error instanceof ApiError && error.kind === 'network') return 'Pas de connexion. Vérifie ton réseau et réessaie.';
  return 'Une erreur est survenue. Réessaie.';
}

const startSchema = z.object({ ok: z.literal(true), session_id: z.uuid(), opening: z.string(), max_chars: z.number().int() });
const saySchema = z.object({ ok: z.literal(true), reply: z.string(), hung_up: z.boolean(), turns_left: z.number().int() });
const finishSchema = z.object({
  ok: z.literal(true),
  score: z.number().int(),
  passed: z.boolean(),
  pass_score: z.number().int(),
  stacker_turns: z.number().int(),
  min_stacker_turns: z.number().int(),
  feedback: feedbackSchema,
});
export type StartResult = z.infer<typeof startSchema>;
export type SayResult = z.infer<typeof saySchema>;
export type FinishResult = z.infer<typeof finishSchema>;

const errorSchema = z.object({ ok: z.literal(false), error: z.string() });

async function call<T>(b: Backend, body: Record<string, unknown>, schema: z.ZodType<T>, fetchFn: typeof fetch): Promise<T> {
  const token = await b.accessToken();
  if (!token) throw new ApiError('unauthorized');
  let res: Response;
  try {
    res = await fetchFn(`${b.url}/functions/v1/roleplay`, {
      method: 'POST',
      headers: { apikey: b.anonKey, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new ApiError('network');
  }
  const data: unknown = await res.json().catch(() => null);
  const ok = schema.safeParse(data);
  if (ok.success) return ok.data;
  const err = errorSchema.safeParse(data);
  if (err.success) throw err.data.error === 'unauthorized' ? new ApiError('unauthorized') : new RoleplayError(err.data.error);
  throw new ApiError('server');
}

export const startRoleplay = (b: Backend, scenario: string, fetchFn: typeof fetch = fetch) => call(b, { action: 'start', scenario }, startSchema, fetchFn);
export const sayRoleplay = (b: Backend, sessionId: string, text: string, fetchFn: typeof fetch = fetch) =>
  call(b, { action: 'say', session_id: sessionId, text }, saySchema, fetchFn);
export const finishRoleplay = (b: Backend, sessionId: string, fetchFn: typeof fetch = fetch) => call(b, { action: 'finish', session_id: sessionId }, finishSchema, fetchFn);
