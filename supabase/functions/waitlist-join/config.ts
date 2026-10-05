/**
 * Configuration de l'Edge Function, lue depuis les variables d'environnement
 * (secrets Supabase). Une configuration incomplète ne fait jamais « passer »
 * une requête : la fonction répond 503 (fail closed) et journalise les noms
 * des variables manquantes, jamais leurs valeurs.
 */
import { z } from 'zod';

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const originSchema = z.string().transform((value, ctx) => {
  try {
    const url = new URL(value);
    if (url.origin !== value.replace(/\/$/, '')) throw new Error('not an origin');
    return url.origin;
  } catch {
    ctx.addIssue({ code: 'custom', message: `origine invalide : ${value}` });
    return z.NEVER;
  }
});

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : null));

export const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SITE_URL: z.url().transform((u) => u.replace(/\/$/, '')),
  ALLOWED_ORIGINS: z
    .string()
    .transform(csv)
    .pipe(z.array(originSchema).min(1)),
  // Facultatif : vide = Turnstile désactivé (le rate limit reste actif).
  TURNSTILE_SECRET_KEY: optional.pipe(z.string().min(10).nullable()),
  RATE_LIMIT_PEPPER: z.string().min(16),
  BREVO_API_KEY: optional,
  BREVO_SENDER_EMAIL: optional.pipe(z.email().nullable()),
  BREVO_SENDER_NAME: optional,
  CONTACT_EMAIL: optional.pipe(z.email().nullable()),
});

export interface WaitlistConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  siteUrl: string;
  allowedOrigins: ReadonlySet<string>;
  /** null = vérification anti-robot désactivée. */
  turnstileSecret: string | null;
  rateLimitPepper: string;
  brevo: { apiKey: string; senderEmail: string; senderName: string } | null;
  contactEmail: string | null;
}

export type ConfigResult = { ok: true; config: WaitlistConfig; warnings: string[] } | { ok: false; missing: string[] };

/** Valide l'environnement. Les messages ne contiennent que des noms de variables. */
export function loadConfig(env: Record<string, string | undefined>): ConfigResult {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const missing = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))];
    return { ok: false, missing };
  }
  const e = parsed.data;
  const warnings: string[] = [];
  const brevo =
    e.BREVO_API_KEY && e.BREVO_SENDER_EMAIL
      ? { apiKey: e.BREVO_API_KEY, senderEmail: e.BREVO_SENDER_EMAIL, senderName: e.BREVO_SENDER_NAME ?? 'Stacker' }
      : null;
  if (!brevo) warnings.push('BREVO_API_KEY ou BREVO_SENDER_EMAIL absent : emails en mode « log » (non envoyés)');
  if (!e.TURNSTILE_SECRET_KEY) warnings.push('TURNSTILE_SECRET_KEY absent : vérification anti-robot désactivée');
  return {
    ok: true,
    warnings,
    config: {
      supabaseUrl: e.SUPABASE_URL.replace(/\/$/, ''),
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
      siteUrl: e.SITE_URL,
      allowedOrigins: new Set(e.ALLOWED_ORIGINS),
      turnstileSecret: e.TURNSTILE_SECRET_KEY,
      rateLimitPepper: e.RATE_LIMIT_PEPPER,
      brevo,
      contactEmail: e.CONTACT_EMAIL,
    },
  };
}
