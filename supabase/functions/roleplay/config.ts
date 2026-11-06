/**
 * Configuration de `roleplay`. Fournisseur d'IA : ROLEPLAY_PROVIDER =
 * anthropic (défaut, clé ANTHROPIC_API_KEY) ou mistral (clé MISTRAL_API_KEY).
 * Fail closed : sans clé d'IA ou avec une
 * configuration incomplète, la fonction répond 503 et seuls les NOMS des
 * variables manquantes sont journalisés.
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

export const DEFAULT_MODEL = 'claude-haiku-5-5';
export const DEFAULT_MODELS = { anthropic: DEFAULT_MODEL, mistral: 'mistral-small-latest' } as const;
export type Provider = keyof typeof DEFAULT_MODELS;

export const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_ANON_KEY: z.string().min(20),
  ALLOWED_ORIGINS: z
    .string()
    .transform(csv)
    .pipe(z.array(originSchema).min(1)),
  ROLEPLAY_PROVIDER: z.enum(['anthropic', 'mistral']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().min(20).optional(),
  MISTRAL_API_KEY: z.string().min(20).optional(),
  ROLEPLAY_MODEL: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{2,80}$/)
    .optional(),
});

export interface RoleplayConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string;
  allowedOrigins: ReadonlySet<string>;
  provider: Provider;
  apiKey: string;
  model: string;
}

export type ConfigResult = { ok: true; config: RoleplayConfig } | { ok: false; missing: string[] };

export function loadConfig(env: Record<string, string | undefined>): ConfigResult {
  const blank = (k: string): string | undefined => {
    const v = env[k]?.trim();
    return v === '' ? undefined : v;
  };
  const parsed = envSchema.safeParse({ ...env, ROLEPLAY_MODEL: blank('ROLEPLAY_MODEL'), ROLEPLAY_PROVIDER: blank('ROLEPLAY_PROVIDER') });
  if (!parsed.success) return { ok: false, missing: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))] };
  const e = parsed.data;
  const provider = e.ROLEPLAY_PROVIDER;
  const apiKey = provider === 'mistral' ? e.MISTRAL_API_KEY : e.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, missing: [provider === 'mistral' ? 'MISTRAL_API_KEY' : 'ANTHROPIC_API_KEY'] };
  return {
    ok: true,
    config: {
      supabaseUrl: e.SUPABASE_URL.replace(/\/$/, ''),
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
      anonKey: e.SUPABASE_ANON_KEY,
      allowedOrigins: new Set(e.ALLOWED_ORIGINS),
      provider,
      apiKey,
      model: e.ROLEPLAY_MODEL ?? DEFAULT_MODELS[provider],
    },
  };
}
