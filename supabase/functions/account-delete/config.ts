/**
 * Configuration de `account-delete`. Fail closed : une configuration
 * incomplète fait répondre 503, et seuls les NOMS des variables manquantes
 * sont journalisés.
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

export const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  // Clé publique (injectée par Supabase) : sert à valider le jeton utilisateur auprès d'Auth.
  SUPABASE_ANON_KEY: z.string().min(20),
  ALLOWED_ORIGINS: z
    .string()
    .transform(csv)
    .pipe(z.array(originSchema).min(1)),
  RATE_LIMIT_PEPPER: z.string().min(16),
});

export interface AccountDeleteConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string;
  allowedOrigins: ReadonlySet<string>;
  rateLimitPepper: string;
}

export type ConfigResult = { ok: true; config: AccountDeleteConfig } | { ok: false; missing: string[] };

export function loadConfig(env: Record<string, string | undefined>): ConfigResult {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    return { ok: false, missing: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))] };
  }
  const e = parsed.data;
  return {
    ok: true,
    config: {
      supabaseUrl: e.SUPABASE_URL.replace(/\/$/, ''),
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
      anonKey: e.SUPABASE_ANON_KEY,
      allowedOrigins: new Set(e.ALLOWED_ORIGINS),
      rateLimitPepper: e.RATE_LIMIT_PEPPER,
    },
  };
}
