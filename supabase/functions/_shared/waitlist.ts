/**
 * Règles de la liste d'attente partagées entre le front (Vite) et l'Edge
 * Function `waitlist-join` (Deno). Aucune dépendance à Deno ni au DOM.
 * `zod` est résolu par node_modules côté Vite et par l'import map
 * (deno.json) côté Deno.
 */
import { z } from 'zod';

/** Version des CGU et de la politique de confidentialité en vigueur. */
export const LEGAL_VERSION = '2026-10-05';

/** Départements français (métropole, Corse, outre-mer hors collectivités). */
export const DEPARTMENTS = [
  ['01', 'Ain'], ['02', 'Aisne'], ['03', 'Allier'], ['04', 'Alpes-de-Haute-Provence'], ['05', 'Hautes-Alpes'],
  ['06', 'Alpes-Maritimes'], ['07', 'Ardèche'], ['08', 'Ardennes'], ['09', 'Ariège'], ['10', 'Aube'],
  ['11', 'Aude'], ['12', 'Aveyron'], ['13', 'Bouches-du-Rhône'], ['14', 'Calvados'], ['15', 'Cantal'],
  ['16', 'Charente'], ['17', 'Charente-Maritime'], ['18', 'Cher'], ['19', 'Corrèze'], ['2A', 'Corse-du-Sud'],
  ['2B', 'Haute-Corse'], ['21', 'Côte-d’Or'], ['22', 'Côtes-d’Armor'], ['23', 'Creuse'], ['24', 'Dordogne'],
  ['25', 'Doubs'], ['26', 'Drôme'], ['27', 'Eure'], ['28', 'Eure-et-Loir'], ['29', 'Finistère'],
  ['30', 'Gard'], ['31', 'Haute-Garonne'], ['32', 'Gers'], ['33', 'Gironde'], ['34', 'Hérault'],
  ['35', 'Ille-et-Vilaine'], ['36', 'Indre'], ['37', 'Indre-et-Loire'], ['38', 'Isère'], ['39', 'Jura'],
  ['40', 'Landes'], ['41', 'Loir-et-Cher'], ['42', 'Loire'], ['43', 'Haute-Loire'], ['44', 'Loire-Atlantique'],
  ['45', 'Loiret'], ['46', 'Lot'], ['47', 'Lot-et-Garonne'], ['48', 'Lozère'], ['49', 'Maine-et-Loire'],
  ['50', 'Manche'], ['51', 'Marne'], ['52', 'Haute-Marne'], ['53', 'Mayenne'], ['54', 'Meurthe-et-Moselle'],
  ['55', 'Meuse'], ['56', 'Morbihan'], ['57', 'Moselle'], ['58', 'Nièvre'], ['59', 'Nord'],
  ['60', 'Oise'], ['61', 'Orne'], ['62', 'Pas-de-Calais'], ['63', 'Puy-de-Dôme'], ['64', 'Pyrénées-Atlantiques'],
  ['65', 'Hautes-Pyrénées'], ['66', 'Pyrénées-Orientales'], ['67', 'Bas-Rhin'], ['68', 'Haut-Rhin'], ['69', 'Rhône'],
  ['70', 'Haute-Saône'], ['71', 'Saône-et-Loire'], ['72', 'Sarthe'], ['73', 'Savoie'], ['74', 'Haute-Savoie'],
  ['75', 'Paris'], ['76', 'Seine-Maritime'], ['77', 'Seine-et-Marne'], ['78', 'Yvelines'], ['79', 'Deux-Sèvres'],
  ['80', 'Somme'], ['81', 'Tarn'], ['82', 'Tarn-et-Garonne'], ['83', 'Var'], ['84', 'Vaucluse'],
  ['85', 'Vendée'], ['86', 'Vienne'], ['87', 'Haute-Vienne'], ['88', 'Vosges'], ['89', 'Yonne'],
  ['90', 'Territoire de Belfort'], ['91', 'Essonne'], ['92', 'Hauts-de-Seine'], ['93', 'Seine-Saint-Denis'],
  ['94', 'Val-de-Marne'], ['95', 'Val-d’Oise'], ['971', 'Guadeloupe'], ['972', 'Martinique'], ['973', 'Guyane'],
  ['974', 'La Réunion'], ['976', 'Mayotte'],
] as const satisfies readonly (readonly [string, string])[];

export type DepartmentCode = (typeof DEPARTMENTS)[number][0];

const DEPARTMENT_CODES = new Set<string>(DEPARTMENTS.map(([code]) => code));

export const isDepartmentCode = (value: string): value is DepartmentCode => DEPARTMENT_CODES.has(value);

/**
 * Alphabet des codes de parrainage : 32 symboles sans I, O, 0 ni 1
 * (ambiguïtés à l'oral et à l'écrit). 32 divise 256 : tirage sans biais.
 */
export const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REFERRAL_LENGTH = 8;
export const REFERRAL_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

/** Prénom : lettres (toutes langues), espaces, apostrophes, traits d'union, points. */
export const FIRST_NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} '’.-]*$/u;

/**
 * Normalise une adresse email pour l'unicité : NFKC, espaces de bord retirés,
 * minuscules. On ne retire ni les points ni les « +étiquettes » : ce sont des
 * adresses distinctes pour le fournisseur de messagerie.
 */
export function normalizeEmail(input: string): string {
  return input.normalize('NFKC').trim().toLowerCase();
}

/** Normalise un prénom : NFC, espaces de bord retirés, espaces multiples réduits. */
export function normalizeFirstName(input: string): string {
  return input.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

/** Code de parrainage valide normalisé, ou null (un code invalide est ignoré, jamais bloquant). */
export function normalizeReferralCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase();
  return REFERRAL_CODE_RE.test(code) ? code : null;
}

/**
 * Génère un code de parrainage aléatoire (CSPRNG).
 * @param randomBytes source d'aléa injectable pour les tests.
 */
export function generateReferralCode(
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  const bytes = randomBytes(REFERRAL_LENGTH);
  if (bytes.length !== REFERRAL_LENGTH) throw new Error('randomBytes: longueur inattendue');
  let code = '';
  for (const b of bytes) code += REFERRAL_ALPHABET.charAt(b % REFERRAL_ALPHABET.length);
  return code;
}

/** Lien de parrainage public. */
export function buildReferralUrl(siteUrl: string, code: string): string {
  const url = new URL('/liste-attente', siteUrl);
  url.searchParams.set('ref', code);
  return url.toString();
}

const MESSAGES = {
  firstName: 'Indique ton prénom (50 caractères maximum, lettres uniquement).',
  email: 'Indique une adresse email valide.',
  department: 'Choisis un département dans la liste.',
  ageConfirmed: 'Stacker est réservé aux personnes majeures.',
  termsAccepted: 'Tu dois accepter les CGU et la politique de confidentialité.',
} as const;

/** Champs saisis par la personne (validés à l'identique côté navigateur et côté serveur). */
export const waitlistFieldsSchema = z.strictObject({
  firstName: z
    .string({ error: MESSAGES.firstName })
    .max(200, { error: MESSAGES.firstName })
    .transform(normalizeFirstName)
    .pipe(z.string().min(1, { error: MESSAGES.firstName }).max(50, { error: MESSAGES.firstName }).regex(FIRST_NAME_RE, { error: MESSAGES.firstName })),
  email: z
    .string({ error: MESSAGES.email })
    .max(320, { error: MESSAGES.email })
    .transform(normalizeEmail)
    .pipe(z.email({ error: MESSAGES.email }).max(254, { error: MESSAGES.email })),
  department: z
    .string({ error: MESSAGES.department })
    .max(3, { error: MESSAGES.department })
    .nullish()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value))
    .refine((value) => value === null || isDepartmentCode(value), { error: MESSAGES.department }),
  ageConfirmed: z.literal(true, { error: MESSAGES.ageConfirmed }),
  termsAccepted: z.literal(true, { error: MESSAGES.termsAccepted }),
  marketingOptIn: z.boolean().default(false),
  referralCode: z.unknown().optional().transform(normalizeReferralCode),
});

/** Corps de la requête envoyée à l'Edge Function. */
export const waitlistJoinRequestSchema = waitlistFieldsSchema.extend({
  // Facultatif : exigé par le serveur seulement si Turnstile est activé (TURNSTILE_SECRET_KEY).
  turnstileToken: z.string({ error: 'Vérification anti-robot invalide.' }).min(1).max(2048).optional(),
});

export type WaitlistFieldsInput = z.input<typeof waitlistFieldsSchema>;
export type WaitlistJoinRequest = z.output<typeof waitlistJoinRequestSchema>;

/** Réponse de succès de l'Edge Function. */
export const waitlistJoinResponseSchema = z.strictObject({
  ok: z.literal(true),
  position: z.number().int().positive(),
  referralCode: z.string().regex(REFERRAL_CODE_RE),
  referralUrl: z.url(),
});

export type WaitlistJoinResponse = z.output<typeof waitlistJoinResponseSchema>;

export type WaitlistErrorCode =
  | 'invalid_request'
  | 'captcha_failed'
  | 'rate_limited'
  | 'forbidden_origin'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'unavailable'
  | 'server_error';

export interface WaitlistErrorBody {
  ok: false;
  error: WaitlistErrorCode;
  fields?: Partial<Record<keyof WaitlistFieldsInput, string>>;
}

/** Première erreur de chaque champ, au format { champ: message }. */
export function fieldErrors(error: z.ZodError): Partial<Record<keyof WaitlistFieldsInput, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !(key in out)) out[key] = issue.message;
  }
  return out;
}
