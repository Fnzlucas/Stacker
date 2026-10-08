/**
 * Prospection : accès aux données (fonctions serveur prospect_* et Edge
 * Function prospects-search), libellés, et préparation de l'envoi depuis la
 * messagerie du stacker. Chaque réponse est validée par Zod. Rien n'est
 * envoyé par l'app : le stacker envoie lui-même, depuis sa boîte.
 */
import { z } from 'zod';
import { searchResponseSchema, type SearchItem, type SearchRequest } from '@shared/prospects';
import { ApiError } from './apiError';
import type { Backend } from './supabase';

export const PROSPECTING_RULES_VERSION = '2026-10-08';

export const STATUSES = ['a_contacter', 'contacte', 'a_repondu', 'rdv', 'signe', 'pas_interesse'] as const;
export type ProspectStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<ProspectStatus, string> = {
  a_contacter: 'À contacter',
  contacte: 'Contacté',
  a_repondu: 'A répondu',
  rdv: 'RDV',
  signe: 'Signé',
  pas_interesse: 'Pas intéressé',
};

export const STATUS_CHIP: Record<ProspectStatus, string> = {
  a_contacter: 'chip',
  contacte: 'chip chip-violet',
  a_repondu: 'chip chip-orange',
  rdv: 'chip chip-green',
  signe: 'chip chip-dark',
  pas_interesse: 'chip chip-red',
};

/** Miroir de public.prospect_transition_allowed (la base fait foi). */
export function transitionAllowed(from: ProspectStatus, to: ProspectStatus): boolean {
  if (to === 'pas_interesse') return ['a_contacter', 'contacte', 'a_repondu', 'rdv'].includes(from);
  if (from === 'a_contacter') return ['contacte', 'a_repondu', 'rdv'].includes(to);
  if (from === 'contacte') return ['contacte', 'a_repondu', 'rdv'].includes(to);
  if (from === 'a_repondu') return to === 'rdv';
  if (from === 'rdv') return to === 'a_repondu';
  return false;
}

export const CALL_OUTCOMES = [
  ['pas_de_reponse', 'Pas de réponse'],
  ['messagerie', 'Messagerie'],
  ['barrage', 'Barrage (secrétariat)'],
  ['rappeler', 'À rappeler'],
  ['interesse', 'Intéressé'],
  ['pas_interesse', 'Pas intéressé'],
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number][0];

const iso = z.string();

export const prospectRowSchema = z.object({
  id: z.uuid(),
  siret: z.string(),
  status: z.enum(STATUSES),
  claimed_at: iso,
  expires_at: iso.nullable(),
  next_action_at: iso.nullable(),
  has_phone: z.boolean(),
  has_email: z.boolean(),
  name: z.string(),
  naf_label: z.string().nullable(),
  city: z.string().nullable(),
  postcode: z.string().nullable(),
});
export type ProspectRow = z.infer<typeof prospectRowSchema>;

const officerSchema = z.object({ nom: z.string().optional(), prenoms: z.string().optional(), denomination: z.string().optional(), qualite: z.string().optional() });

export const prospectDetailSchema = z.object({
  claim: z.object({
    id: z.uuid(),
    status: z.enum(STATUSES),
    claimed_at: iso,
    expires_at: iso.nullable(),
    extended: z.boolean(),
    next_action_at: iso.nullable(),
    contact_phone: z.string().nullable(),
    contact_email: z.string().nullable(),
    contact_email_kind: z.enum(['generique', 'nominatif']).nullable(),
    contact_source: z.string().nullable(),
  }),
  company: z.object({
    siret: z.string(),
    siren: z.string(),
    name: z.string(),
    naf: z.string().nullable(),
    naf_label: z.string().nullable(),
    employee_band: z.string().nullable(),
    is_sole_trader: z.boolean(),
    created_on: z.string().nullable(),
    address: z.string().nullable(),
    postcode: z.string().nullable(),
    city: z.string().nullable(),
    officers: z.array(officerSchema),
  }),
  notes: z.array(z.object({ id: z.uuid(), body: z.string(), created_at: iso })),
  events: z.array(z.object({ kind: z.string(), payload: z.record(z.string(), z.unknown()), created_at: iso })),
  emails: z.array(z.object({ id: z.uuid(), template_key: z.string().nullable(), subject: z.string(), marked_sent_at: iso.nullable(), created_at: iso })),
});
export type ProspectDetail = z.infer<typeof prospectDetailSchema>;

const counter = z.object({ used: z.number().int(), limit: z.number().int() });
export const quotasSchema = z.object({
  enabled: z.boolean(),
  rules_version: z.string().nullable(),
  searches: counter,
  claims_today: counter,
  emails_today: counter,
  active: counter,
});
export type ProspectQuotas = z.infer<typeof quotasSchema>;

export const preparedEmailSchema = z.object({ id: z.uuid(), recipient: z.string(), subject: z.string(), body: z.string(), footer: z.string() });
export type PreparedEmail = z.infer<typeof preparedEmailSchema>;

export const emailTemplateSchema = z.object({ key: z.string(), label: z.string() });

// ---------------------------------------------------------------------------
// Erreurs : code SQL (raise exception '<code>') → message pour le stacker
// ---------------------------------------------------------------------------

export class ProspectError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ProspectError';
  }
}

const MESSAGES: Record<string, string> = {
  already_claimed: 'Un autre stacker vient de réserver cette entreprise.',
  opposed: 'Cette entreprise ou cette coordonnée a demandé à ne plus être contactée.',
  cooldown: 'Cette entreprise a dit non récemment : elle est en pause pour tout le monde.',
  company_quota: 'Cette entreprise a déjà été sollicitée plusieurs fois cette année : on la laisse tranquille.',
  reclaim_blocked: 'Tu as déjà suivi cette entreprise récemment. Tu pourras la reprendre dans 30 jours.',
  max_active: 'Tu suis déjà le maximum d’entreprises. Avance ou libère des prospects pour en réserver d’autres.',
  daily_quota: 'Limite du jour atteinte. Elle se réinitialise demain matin.',
  quota_exceeded: 'Tu as atteint ta limite de recherches pour aujourd’hui. Elle se réinitialise demain matin.',
  disabled: 'La prospection est momentanément suspendue. Réessaie un peu plus tard.',
  onboarding_required: 'Termine ton inscription pour accéder à la prospection.',
  not_found: 'Ce prospect n’est plus dans ta liste (libéré ou expiré).',
  invalid_transition: 'Ce changement de statut n’est pas possible.',
  forbidden_status: 'Ce statut est posé automatiquement par Stacker.',
  invalid_phone: 'Numéro de téléphone invalide.',
  invalid_email: 'Adresse email invalide.',
  source_required: 'Indique où tu as trouvé cette coordonnée.',
  invalid_note: 'Ta note est vide ou trop longue (2 000 caractères maximum).',
  no_email: 'Ajoute d’abord l’adresse email de l’entreprise.',
  profile_incomplete: 'Ajoute ton nom de famille dans ton profil : il apparaît dans la signature de tes emails.',
  already_extended: 'Tu as déjà prolongé cette réservation.',
  too_early: 'Tu pourras prolonger après le premier contact.',
  invalid_next_action: 'Choisis une date dans les quatre prochains mois.',
  rate_limited: 'Trop de recherches d’affilée. Attends une minute.',
  source_busy: 'Le registre des entreprises est très sollicité. Réessaie dans quelques secondes.',
  unauthorized: 'Ta session a expiré. Reconnecte-toi.',
  network: 'Connexion impossible. Vérifie ta connexion internet et réessaie.',
};

export function prospectErrorMessage(error: unknown): string {
  if (error instanceof ProspectError) return MESSAGES[error.code] ?? 'Le service est momentanément indisponible. Réessaie dans un instant.';
  if (error instanceof ApiError) return MESSAGES[error.kind] ?? 'Le service est momentanément indisponible. Réessaie dans un instant.';
  return 'Le service est momentanément indisponible. Réessaie dans un instant.';
}

interface PgError {
  code?: string;
  message?: string;
}

function toError(error: PgError, status: number): Error {
  if (status === 0 || /fetch|network/i.test(error.message ?? '')) return new ApiError('network');
  if (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') return new ApiError('unauthorized');
  const code = error.message ?? '';
  if (/^[a-z_]{3,40}$/.test(code)) return new ProspectError(code);
  return new ApiError('server');
}

async function rpc<T>(b: Backend, fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const res = await b.db.rpc(fn, args);
  if (res.error) throw toError(res.error, res.status);
  const data: unknown = res.data;
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiError('server', `${fn} illisible`);
  return parsed.data;
}

const voidish = z.unknown();

export const fetchMyProspects = (b: Backend) => rpc(b, 'my_prospects', {}, z.array(prospectRowSchema));
export const fetchProspect = (b: Backend, claimId: string) => rpc(b, 'prospect_detail', { p_claim: claimId }, prospectDetailSchema);
export const fetchQuotas = (b: Backend) => rpc(b, 'my_prospect_quotas', {}, quotasSchema);
export const acceptRules = (b: Backend) => rpc(b, 'accept_prospecting_rules', { p_version: PROSPECTING_RULES_VERSION }, voidish);
export const claimProspect = (b: Backend, siret: string) => rpc(b, 'prospect_claim', { p_siret: siret }, z.uuid());
export const setStatus = (b: Backend, claimId: string, status: ProspectStatus, nextActionAt: string | null) =>
  rpc(b, 'prospect_set_status', { p_claim: claimId, p_status: status, p_next_action_at: nextActionAt }, voidish);
export const setContact = (b: Backend, claimId: string, input: { phone: string | null; email: string | null; source: string | null }) =>
  rpc(b, 'prospect_set_contact', { p_claim: claimId, p_phone: input.phone, p_email: input.email, p_source: input.source }, z.enum(['generique', 'nominatif']).nullable());
export const addNote = (b: Backend, claimId: string, body: string) => rpc(b, 'prospect_add_note', { p_claim: claimId, p_body: body }, z.uuid());
export const deleteNote = (b: Backend, noteId: string) => rpc(b, 'prospect_delete_note', { p_note: noteId }, voidish);
export const logCall = (b: Backend, claimId: string, outcome: CallOutcome, nextActionAt: string | null) =>
  rpc(b, 'prospect_log_call', { p_claim: claimId, p_outcome: outcome, p_next_action_at: nextActionAt }, z.enum(STATUSES));
export const extendClaim = (b: Backend, claimId: string) => rpc(b, 'prospect_extend', { p_claim: claimId }, z.string());
export const releaseClaim = (b: Backend, claimId: string, reason: 'manuel' | 'opposition') => rpc(b, 'prospect_release', { p_claim: claimId, p_reason: reason }, voidish);
export const prepareEmail = (b: Backend, claimId: string, templateKey: string) =>
  rpc(b, 'prospect_prepare_email', { p_claim: claimId, p_template_key: templateKey }, preparedEmailSchema);
export const markEmailSent = (b: Backend, emailId: string) => rpc(b, 'prospect_mark_email_sent', { p_email: emailId }, z.enum(STATUSES));

export async function fetchTemplates(b: Backend): Promise<z.infer<typeof emailTemplateSchema>[]> {
  const { data, error, status } = await b.db.from('email_templates').select('key,label').order('sort_order', { ascending: true });
  if (error) throw toError(error, status);
  const parsed = z.array(emailTemplateSchema).safeParse(data);
  if (!parsed.success) throw new ApiError('server', 'modèles illisibles');
  return parsed.data;
}

/** Recherche (Edge Function prospects-search, identité = jeton). */
export async function searchProspects(
  b: Backend,
  input: SearchRequest,
  fetchFn: typeof fetch = fetch,
): Promise<{ items: SearchItem[]; total: number; hasMore: boolean; page: number; quota: { used: number; limit: number } }> {
  const token = await b.accessToken();
  if (!token) throw new ApiError('unauthorized');
  let res: Response;
  try {
    res = await fetchFn(`${b.url}/functions/v1/prospects-search`, {
      method: 'POST',
      headers: { apikey: b.anonKey, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
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
  const parsed = searchResponseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError('server');
  if (!parsed.data.ok) {
    if (parsed.data.error === 'unauthorized') throw new ApiError('unauthorized');
    throw new ProspectError(parsed.data.error);
  }
  return { items: parsed.data.items, total: parsed.data.total, hasMore: parsed.data.has_more, page: parsed.data.page, quota: parsed.data.quota };
}

// ---------------------------------------------------------------------------
// Envoi depuis la messagerie du stacker
// ---------------------------------------------------------------------------

/** Taille maximale d'un lien mailto: fiable sur tous les clients mail. */
export const MAILTO_MAX = 1900;

export function fullEmailBody(email: Pick<PreparedEmail, 'body' | 'footer'>): string {
  return `${email.body}\n\n—\n${email.footer}`;
}

const enc = (v: string) => encodeURIComponent(v);
const encTo = (v: string) => enc(v).replace(/%40/g, '@');

/**
 * Lien mailto: (objet + corps + pied légal). Si le lien dépasse la taille
 * fiable, renvoie null : le stacker utilise alors « Copier ».
 */
export function buildProspectMailto(email: PreparedEmail): string | null {
  const url = `mailto:${encTo(email.recipient)}?subject=${enc(email.subject)}&body=${enc(fullEmailBody(email))}`;
  return url.length <= MAILTO_MAX ? url : null;
}

export function gmailComposeUrl(email: PreparedEmail): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encTo(email.recipient)}&su=${enc(email.subject)}&body=${enc(fullEmailBody(email))}`;
}

export function outlookComposeUrl(email: PreparedEmail): string {
  return `https://outlook.office.com/mail/deeplink/compose?to=${encTo(email.recipient)}&subject=${enc(email.subject)}&body=${enc(fullEmailBody(email))}`;
}

/** Texte complet à coller dans n'importe quelle messagerie. */
export function copyText(email: PreparedEmail): string {
  return `À : ${email.recipient}\nObjet : ${email.subject}\n\n${fullEmailBody(email)}`;
}

/** Recherche Google simple (lien ouvert par le stacker ; aucune API). */
export function googleSearchUrl(name: string, city: string | null): string {
  return `https://www.google.com/search?q=${enc([name, city].filter(Boolean).join(' '))}`;
}

export function annuaireUrl(siren: string): string {
  return `https://annuaire-entreprises.data.gouv.fr/entreprise/${enc(siren)}`;
}

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------

/** « PLOMBERIE DURAND » → « Plomberie Durand » (les sigles courts restent en capitales). */
export function displayName(name: string): string {
  return name
    .toLocaleLowerCase('fr-FR')
    .replace(/(^|[\s'’(-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('fr-FR'))
    .replace(/\b(Sarl|Sas|Sasu|Eurl|Sa|Sci|Snc|Ei|Eirl)\b/g, (m) => m.toUpperCase());
}

/** Ancienneté lisible : « créée en 2024 », « créée il y a 12 ans ». */
export function ageLabel(createdOn: string | null, now: Date): string | null {
  if (!createdOn) return null;
  const created = new Date(`${createdOn}T00:00:00Z`);
  if (Number.isNaN(created.getTime())) return null;
  const years = Math.floor((now.getTime() - created.getTime()) / (365.25 * 86_400_000));
  if (years < 3) return `créée en ${String(created.getUTCFullYear())}`;
  return `${String(years)} ans d’activité`;
}

/** Jours restants avant l'échéance (arrondi au-dessus), ou null. */
export function daysLeft(expiresAt: string | null, now: Date): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return Number.isNaN(ms) ? null : Math.max(0, Math.ceil(ms / 86_400_000));
}

/** Prochaine action due aujourd'hui ou en retard (heure de Paris). */
export function isDueToday(nextActionAt: string | null, now: Date): boolean {
  if (!nextActionAt) return false;
  const day = (d: Date) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(d);
  return day(new Date(nextActionAt)) <= day(now);
}

/** Valeur d'un <input type="date"> (AAAA-MM-JJ) → ISO à 9 h, heure de Paris approximée (UTC+1/+2). */
export function dateInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T09:00:00+02:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function isoToDateInput(isoValue: string | null): string {
  if (!isoValue) return '';
  const d = new Date(isoValue);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(d);
}

const EVENT_LABELS: Record<string, string> = {
  reserve: 'Réservée',
  statut: 'Statut changé',
  note: 'Note ajoutée',
  appel: 'Appel',
  email_prepare: 'Email préparé',
  email_envoye: 'Email envoyé',
  prolonge: 'Réservation prolongée',
  coordonnees: 'Coordonnées mises à jour',
  libere: 'Libérée',
  expire: 'Expirée',
  opposition: 'Ne veut plus être contactée',
  signe: 'Client signé',
};

export function eventLabel(e: { kind: string; payload: Record<string, unknown> }): string {
  if (e.kind === 'statut' && typeof e.payload['to'] === 'string' && e.payload['to'] in STATUS_LABELS) return `Statut : ${STATUS_LABELS[e.payload['to'] as ProspectStatus]}`;
  if (e.kind === 'appel' && typeof e.payload['outcome'] === 'string') {
    const label = CALL_OUTCOMES.find(([k]) => k === e.payload['outcome'])?.[1];
    if (label) return `Appel : ${label.toLocaleLowerCase('fr-FR')}`;
  }
  return EVENT_LABELS[e.kind] ?? 'Mise à jour';
}
