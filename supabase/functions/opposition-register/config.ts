/**
 * Configuration de `opposition-register`. Fail closed : une configuration
 * incomplète fait répondre 503 ; seuls les NOMS des variables manquantes sont
 * journalisés. Turnstile est obligatoire pour le formulaire public, sauf
 * désactivation explicite (TURNSTILE_DISABLED=1, développement local).
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
  ALLOWED_ORIGINS: z
    .string()
    .transform(csv)
    .pipe(z.array(originSchema).min(1)),
  RATE_LIMIT_PEPPER: z.string().min(16),
  TURNSTILE_SECRET_KEY: optional.pipe(z.string().min(10).nullable()),
  TURNSTILE_DISABLED: optional,
});

export interface OppositionConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  allowedOrigins: ReadonlySet<string>;
  rateLimitPepper: string;
  /** null = vérification anti-robot désactivée (explicitement). */
  turnstileSecret: string | null;
}

export type ConfigResult = { ok: true; config: OppositionConfig } | { ok: false; missing: string[] };

export function loadConfig(env: Record<string, string | undefined>): ConfigResult {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    return { ok: false, missing: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))] };
  }
  const e = parsed.data;
  if (!e.TURNSTILE_SECRET_KEY && e.TURNSTILE_DISABLED !== '1') return { ok: false, missing: ['TURNSTILE_SECRET_KEY'] };
  return {
    ok: true,
    config: {
      supabaseUrl: e.SUPABASE_URL.replace(/\/$/, ''),
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
      allowedOrigins: new Set(e.ALLOWED_ORIGINS),
      rateLimitPepper: e.RATE_LIMIT_PEPPER,
      turnstileSecret: e.TURNSTILE_SECRET_KEY,
    },
  };
}
