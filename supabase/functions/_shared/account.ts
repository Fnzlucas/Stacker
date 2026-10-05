/**
 * Règles des comptes stackers partagées entre le front (Vite) et les Edge
 * Functions (Deno). Elles reflètent les contraintes de la base
 * (supabase/migrations/20261006090000_accounts.sql) : le navigateur valide
 * pour le confort, la base et Supabase Auth font foi.
 */
import { z } from 'zod';
import { FIRST_NAME_RE, isDepartmentCode, normalizeEmail, normalizeFirstName } from './waitlist.ts';

/** Version des CGU / politique de confidentialité acceptée à l'inscription. */
export const TERMS_VERSION = '2026-10-05';

// ---------------------------------------------------------------------------
// Mot de passe : mêmes exigences que la configuration Supabase Auth
// (minimum_password_length = 12, password_requirements = lower_upper_letters_digits).
// La vérification des mots de passe ayant fuité (HaveIBeenPwned) est faite
// par Supabase Auth côté serveur.
// ---------------------------------------------------------------------------

export const PASSWORD_MIN = 12;
/** bcrypt ignore au-delà de 72 octets : on refuse plutôt que de tronquer en silence. */
export const PASSWORD_MAX_BYTES = 72;

export type PasswordRule = 'length' | 'lower' | 'upper' | 'digit' | 'max' | 'email';

export const PASSWORD_RULE_LABELS: Record<Exclude<PasswordRule, 'max' | 'email'>, string> = {
  length: `${String(PASSWORD_MIN)} caractères`,
  lower: 'une minuscule',
  upper: 'une majuscule',
  digit: 'un chiffre',
};

/** Liste des règles NON respectées (vide = mot de passe acceptable). */
export function passwordIssues(password: string, email = ''): PasswordRule[] {
  const issues: PasswordRule[] = [];
  if (Array.from(password).length < PASSWORD_MIN) issues.push('length');
  if (!/\p{Ll}/u.test(password)) issues.push('lower');
  if (!/\p{Lu}/u.test(password)) issues.push('upper');
  if (!/\p{Nd}/u.test(password)) issues.push('digit');
  if (new TextEncoder().encode(password).byteLength > PASSWORD_MAX_BYTES) issues.push('max');
  const local = normalizeEmail(email).split('@')[0] ?? '';
  if (local.length >= 4 && password.toLowerCase().includes(local)) issues.push('email');
  return issues;
}

export function passwordMessage(issues: readonly PasswordRule[]): string | null {
  if (issues.length === 0) return null;
  if (issues.includes('max')) return 'Mot de passe trop long (72 octets maximum).';
  if (issues.includes('email')) return 'Ton mot de passe ne doit pas contenir ton adresse email.';
  return 'Ton mot de passe doit respecter les 4 règles.';
}

// ---------------------------------------------------------------------------
// Âge : la date de naissance sert UNIQUEMENT au contrôle dans le navigateur,
// elle n'est jamais envoyée ni stockée. Seul « majeur déclaré » part.
// ---------------------------------------------------------------------------

/** Âge révolu à la date `today` (dates ISO AAAA-MM-JJ), ou null si la date est invalide ou future. */
export function ageOn(birthDate: string, today: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const birth = new Date(Date.UTC(y, mo - 1, d));
  if (birth.getUTCFullYear() !== y || birth.getUTCMonth() !== mo - 1 || birth.getUTCDate() !== d) return null;
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  let age = ty - y;
  if (tm < mo || (tm === mo && td < d)) age--;
  if (age < 0 || age > 120) return null;
  return age;
}

export const ADULT_AGE = 18;

// ---------------------------------------------------------------------------
// Champs du profil
// ---------------------------------------------------------------------------

export const GOALS = [
  ['complement', 'Un complément de revenu', 'Quelques heures par semaine, à côté de ton activité.'],
  ['activite_principale', 'Mon activité principale', 'Tu veux en faire ton métier d’apporteur d’affaires.'],
  ['decouvrir', 'Découvrir d’abord', 'Tu regardes comment ça marche avant de te lancer.'],
] as const;
export type Goal = (typeof GOALS)[number][0];
const GOAL_CODES = GOALS.map(([code]) => code) as [Goal, ...Goal[]];

export const LEGAL_STATUSES = [
  ['micro_entrepreneur', 'Micro-entrepreneur'],
  ['entreprise_individuelle', 'Entreprise individuelle (hors micro)'],
  ['societe', 'Société (SAS, SARL…)'],
  ['sans_statut', 'Pas encore de statut'],
] as const;
export type LegalStatus = (typeof LEGAL_STATUSES)[number][0];
const LEGAL_STATUS_CODES = LEGAL_STATUSES.map(([code]) => code) as [LegalStatus, ...LegalStatus[]];

/** SIRET : 14 chiffres, clé de Luhn (exception La Poste : somme des chiffres multiple de 5). */
export function isValidSiret(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  const digits = Array.from(siret, Number);
  if (siret.startsWith('356000000')) return digits.reduce((a, b) => a + b, 0) % 5 === 0;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = digits[13 - i] ?? 0;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Normalise un numéro de téléphone français ou international en E.164.
 * « 06 12 34 56 78 », « 0612345678 », « +33 6 12 34 56 78 » → « +33612345678 ».
 * Renvoie null si le format n'est pas reconnu.
 */
export function normalizePhone(input: string): string | null {
  const compact = input.replace(/[\s.\-()]/g, '');
  if (/^0[1-9]\d{8}$/.test(compact)) return `+33${compact.slice(1)}`;
  if (/^0033[1-9]\d{8}$/.test(compact)) return `+${compact.slice(2)}`;
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  return null;
}

/** Affichage d'un E.164 français : +33612345678 → 06 12 34 56 78. */
export function formatPhone(e164: string): string {
  if (/^\+33[1-9]\d{8}$/.test(e164)) return `0${e164.slice(3)}`.replace(/(\d{2})(?=\d)/g, '$1 ');
  return e164;
}

const nameField = (max: number, label: string) =>
  z
    .string()
    .transform(normalizeFirstName)
    .pipe(
      z
        .string()
        .min(1, `Indique ton ${label}.`)
        .max(max, `${max.toString()} caractères maximum.`)
        .refine((v) => v === '' || FIRST_NAME_RE.test(v), 'Utilise uniquement des lettres, espaces, apostrophes ou traits d’union.'),
    );

const optionalText = (max: number) =>
  z
    .string()
    .transform((v) => v.normalize('NFC').trim().replace(/\s+/gu, ' '))
    .pipe(z.string().max(max, `${max.toString()} caractères maximum.`))
    .transform((v) => (v === '' ? null : v));

const departmentField = z
  .string()
  .refine((v) => v === '' || isDepartmentCode(v), 'Département inconnu.')
  .transform((v) => (v === '' ? null : v));

export const emailField = z
  .string()
  .transform(normalizeEmail)
  .pipe(z.email('Adresse email invalide.').max(254, 'Adresse email trop longue.'));

export const signupSchema = z
  .strictObject({
    firstName: nameField(50, 'prénom'),
    email: emailField,
    password: z.string(),
    birthDate: z.string(),
    adultConfirmed: z.literal(true, 'Coche cette case pour continuer.'),
    termsAccepted: z.literal(true, 'Accepte les conditions pour continuer.'),
    marketingOptIn: z.boolean(),
  })
  .superRefine(
    (v, ctx) => {
      // Exécuté même si d'autres champs sont en erreur (when) : toutes les
      // erreurs s'affichent d'un coup. Les types ne sont alors pas garantis.
      const password = typeof v.password === 'string' ? v.password : '';
      const email = typeof v.email === 'string' ? v.email : '';
      const msg = passwordMessage(passwordIssues(password, email));
      if (msg) ctx.addIssue({ code: 'custom', path: ['password'], message: msg });
    },
    { when: () => true },
  );

/** Contrôle de majorité séparé (dépend de la date du jour). */
export function birthDateError(birthDate: string, today: Date): string | null {
  if (birthDate === '') return 'Indique ta date de naissance.';
  const age = ageOn(birthDate, today);
  if (age === null) return 'Date de naissance invalide.';
  if (age < ADULT_AGE) return 'Stacker est réservé aux personnes majeures.';
  return null;
}

export const loginSchema = z.strictObject({
  email: emailField,
  password: z.string().min(1, 'Indique ton mot de passe.').max(200),
});

export const emailOnlySchema = z.strictObject({ email: emailField });

export const otpCodeSchema = z
  .string()
  .transform((v) => v.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Le code contient 6 chiffres.'));

export const newPasswordSchema = z
  .strictObject({ password: z.string(), confirm: z.string(), email: z.string() })
  .superRefine((v, ctx) => {
    const msg = passwordMessage(passwordIssues(v.password, v.email));
    if (msg) ctx.addIssue({ code: 'custom', path: ['password'], message: msg });
    else if (v.password !== v.confirm) ctx.addIssue({ code: 'custom', path: ['confirm'], message: 'Les deux mots de passe sont différents.' });
  });

export const onboardingSchema = z.strictObject({
  firstName: nameField(50, 'prénom'),
  department: z.string().refine(isDepartmentCode, 'Choisis ton département.'),
  goal: z.enum(GOAL_CODES, 'Choisis un objectif.'),
});

/** Champs modifiables depuis le profil (mêmes colonnes que le GRANT UPDATE en base). */
export const profileUpdateSchema = z
  .strictObject({
    first_name: nameField(50, 'prénom'),
    last_name: z
      .string()
      .transform(normalizeFirstName)
      .pipe(
        z
          .string()
          .max(80, '80 caractères maximum.')
          .refine((v) => v === '' || FIRST_NAME_RE.test(v), 'Utilise uniquement des lettres, espaces, apostrophes ou traits d’union.'),
      )
      .transform((v) => (v === '' ? null : v)),
    phone: z.string().transform((v, ctx) => {
      if (v.trim() === '') return null;
      const e164 = normalizePhone(v);
      if (!e164) {
        ctx.addIssue({ code: 'custom', message: 'Numéro invalide (ex. 06 12 34 56 78).' });
        return z.NEVER;
      }
      return e164;
    }),
    department: departmentField,
    city: optionalText(80),
    legal_status: z.union([z.literal(''), z.enum(LEGAL_STATUS_CODES)]).transform((v) => (v === '' ? null : v)),
    siret: z.string().transform((v, ctx) => {
      const compact = v.replace(/\s/g, '');
      if (compact === '') return null;
      if (!isValidSiret(compact)) {
        ctx.addIssue({ code: 'custom', message: 'SIRET invalide (14 chiffres, vérifie la saisie).' });
        return z.NEVER;
      }
      return compact;
    }),
    goal: z.union([z.literal(''), z.enum(GOAL_CODES)]).transform((v) => (v === '' ? null : v)),
  })
  .superRefine((v, ctx) => {
    if (v.siret && (v.legal_status === null || v.legal_status === 'sans_statut')) {
      ctx.addIssue({ code: 'custom', path: ['siret'], message: 'Un SIRET suppose un statut d’entreprise : choisis-le ci-dessus.' });
    }
  });

export type ProfileUpdate = z.output<typeof profileUpdateSchema>;

/** Confirmation exigée pour supprimer le compte. */
export const DELETE_CONFIRMATION = 'SUPPRIMER';
export const accountDeleteRequestSchema = z.strictObject({ confirm: z.literal(DELETE_CONFIRMATION) });

/** Réauthentification exigée avant une suppression : connexion de moins de 10 minutes. */
export const REAUTH_MAX_AGE_SECONDS = 10 * 60;

export type AccountDeleteErrorCode =
  | 'unauthorized'
  | 'reauth_required'
  | 'invalid_request'
  | 'rate_limited'
  | 'forbidden_origin'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'unavailable'
  | 'server_error';
