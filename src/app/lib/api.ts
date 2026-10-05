/**
 * Accès aux données de l'app connectée. Chaque réponse est validée par Zod
 * (« validation aux deux bouts ») ; chaque écriture passe par une colonne
 * autorisée (RLS + GRANT par colonne) ou une fonction serveur.
 */
import { z } from 'zod';
import { DELETE_CONFIRMATION, type Goal, type ProfileUpdate } from '@shared/account';
import type { Backend } from './supabase';
import { TIER_CODES, tiersSchema, type Tier } from './tiers';

export const profileSchema = z.object({
  id: z.uuid(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  phone: z.string().nullable(),
  department: z.string().nullable(),
  city: z.string().nullable(),
  legal_status: z.enum(['micro_entrepreneur', 'entreprise_individuelle', 'societe', 'sans_statut']).nullable(),
  siret: z.string().nullable(),
  goal: z.enum(['complement', 'activite_principale', 'decouvrir']).nullable(),
  tier: z.enum(TIER_CODES),
  active_clients: z.number().int().min(0),
  xp: z.number().int().min(0),
  adult_declared_at: z.string(),
  launch_priority: z.boolean(),
  waitlist_joined_at: z.string().nullable(),
  onboarding_completed_at: z.string().nullable(),
  created_at: z.string(),
});
export type Profile = z.infer<typeof profileSchema>;

/** Colonnes lues : jamais `*`, pour ne rien recevoir d'imprévu. */
export const PROFILE_COLUMNS =
  'id,first_name,last_name,phone,department,city,legal_status,siret,goal,tier,active_clients,xp,adult_declared_at,launch_priority,waitlist_joined_at,onboarding_completed_at,created_at';
const TIER_COLUMNS = 'code,label,rate_bps,min_active_clients,max_active_clients,sort_order,criteria_provisional';

export type ApiErrorKind = 'network' | 'invalid' | 'forbidden' | 'unauthorized' | 'reauth_required' | 'rate_limited' | 'server';

export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'ApiError';
  }
}

interface PgError {
  code?: string;
  message?: string;
}

function fromPostgrest(error: PgError, status: number): ApiError {
  if (status === 0 || /fetch|network/i.test(error.message ?? '')) return new ApiError('network');
  if (error.code === '23514' || error.code === '22023' || error.code === '22P02') return new ApiError('invalid');
  // PostgREST : 401 = pas (ou plus) de session valide ; 403 = session valide mais action refusée.
  if (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') return new ApiError('unauthorized');
  if (error.code === '42501' || status === 403) return new ApiError('forbidden');
  return new ApiError('server');
}

/** Message affiché pour une erreur d'API (jamais de détail technique). */
export function apiErrorMessage(error: unknown): string {
  const kind = error instanceof ApiError ? error.kind : 'server';
  switch (kind) {
    case 'network':
      return 'Connexion impossible. Vérifie ta connexion internet et réessaie.';
    case 'invalid':
      return 'Une valeur n’a pas été acceptée. Vérifie ta saisie.';
    case 'forbidden':
      return 'Cette action n’est pas autorisée.';
    case 'unauthorized':
      return 'Ta session a expiré. Reconnecte-toi.';
    case 'reauth_required':
      return 'Pour des raisons de sécurité, confirme ton mot de passe.';
    case 'rate_limited':
      return 'Trop de tentatives. Réessaie dans une heure.';
    default:
      return 'Le service est momentanément indisponible. Réessaie dans un instant.';
  }
}

export async function fetchProfile(b: Backend): Promise<Profile> {
  const { data, error, status } = await b.db.from('profiles').select(PROFILE_COLUMNS).single();
  if (error) throw fromPostgrest(error, status);
  const parsed = profileSchema.safeParse(data);
  if (!parsed.success) throw new ApiError('server', 'profil illisible');
  return parsed.data;
}

export async function fetchTiers(b: Backend): Promise<Tier[]> {
  const { data, error, status } = await b.db.from('commission_tiers').select(TIER_COLUMNS).order('sort_order', { ascending: true });
  if (error) throw fromPostgrest(error, status);
  const parsed = tiersSchema.safeParse(data);
  if (!parsed.success) throw new ApiError('server', 'paliers illisibles');
  return parsed.data;
}

export async function updateProfile(b: Backend, userId: string, values: ProfileUpdate): Promise<Profile> {
  const { data, error, status } = await b.db.from('profiles').update(values).eq('id', userId).select(PROFILE_COLUMNS).single();
  if (error) throw fromPostgrest(error, status);
  const parsed = profileSchema.safeParse(data);
  if (!parsed.success) throw new ApiError('server', 'profil illisible');
  return parsed.data;
}

export async function completeOnboarding(b: Backend, input: { firstName: string; department: string; goal: Goal }): Promise<void> {
  const { error, status } = await b.db.rpc('complete_onboarding', { p_first_name: input.firstName, p_department: input.department, p_goal: input.goal });
  if (error) throw fromPostgrest(error, status);
}

const exportSchema = z.object({ format: z.literal('stacker-export-v1') }).loose();

export async function exportMyData(b: Backend): Promise<Record<string, unknown>> {
  const res = await b.db.rpc('export_my_data');
  if (res.error) throw fromPostgrest(res.error, res.status);
  const data: unknown = res.data;
  const parsed = exportSchema.safeParse(data);
  if (!parsed.success) throw new ApiError('server', 'export illisible');
  return parsed.data;
}

const deleteResponseSchema = z.union([
  z.object({ ok: z.literal(true), status: z.literal('deleted') }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

/** Suppression du compte : Edge Function account-delete (identité = jeton, jamais le corps). */
export async function deleteAccount(b: Backend, fetchFn: typeof fetch = fetch): Promise<void> {
  const token = await b.accessToken();
  if (!token) throw new ApiError('unauthorized');
  let res: Response;
  try {
    res = await fetchFn(`${b.url}/functions/v1/account-delete`, {
      method: 'POST',
      headers: { apikey: b.anonKey, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: DELETE_CONFIRMATION }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError('network');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const parsed = deleteResponseSchema.safeParse(body);
  if (res.ok && parsed.success && parsed.data.ok) return;
  const code = parsed.success && !parsed.data.ok ? parsed.data.error : null;
  if (code === 'reauth_required') throw new ApiError('reauth_required');
  if (code === 'unauthorized') throw new ApiError('unauthorized');
  if (code === 'rate_limited' || res.status === 429) throw new ApiError('rate_limited');
  throw new ApiError('server');
}

/** Étapes « pour bien démarrer » calculées sur le profil réel. */
export function profileChecklist(p: Profile): { key: 'identity' | 'zone' | 'status'; label: string; done: boolean }[] {
  return [
    { key: 'identity', label: 'Ajoute ton nom et ton téléphone', done: Boolean(p.last_name && p.phone) },
    { key: 'zone', label: 'Indique ta ville de prospection', done: Boolean(p.department && p.city) },
    { key: 'status', label: 'Déclare ton statut juridique', done: p.legal_status !== null },
  ];
}
