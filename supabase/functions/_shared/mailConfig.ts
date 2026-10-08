/**
 * Configuration commune aux fonctions des boîtes mail. Chaque fournisseur
 * est facultatif : sans ses identifiants OAuth, il n'est simplement pas
 * proposé. Les clés de chiffrement et de signature sont obligatoires.
 */
import { z } from 'zod';
import type { OAuthClient, Provider } from './mail.ts';

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : null));

const key32 = z.string().refine((v) => {
  try {
    const b64 = v.replace(/-/g, '+').replace(/_/g, '/');
    return atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')).length === 32;
  } catch {
    return false;
  }
}, 'clé de 32 octets en base64 attendue');

export const mailEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_ANON_KEY: z.string().min(20).optional(),
  SITE_URL: z.url().transform((u) => u.replace(/\/$/, '')),
  ALLOWED_ORIGINS: z.string().transform(csv).optional(),
  MAIL_TOKEN_KEY: key32,
  MAIL_STATE_KEY: key32,
  GOOGLE_OAUTH_CLIENT_ID: optional,
  GOOGLE_OAUTH_CLIENT_SECRET: optional,
  MS_OAUTH_CLIENT_ID: optional,
  MS_OAUTH_CLIENT_SECRET: optional,
  CRON_SECRET: z.string().min(24).optional(),
});

export interface MailConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string | null;
  siteUrl: string;
  allowedOrigins: ReadonlySet<string>;
  tokenKey: string;
  stateKey: string;
  clients: Partial<Record<Provider, OAuthClient>>;
  cronSecret: string | null;
  redirectUri: string;
}

export type MailConfigResult = { ok: true; config: MailConfig } | { ok: false; missing: string[] };

export function loadMailConfig(env: Record<string, string | undefined>): MailConfigResult {
  const parsed = mailEnvSchema.safeParse(env);
  if (!parsed.success) return { ok: false, missing: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))] };
  const e = parsed.data;
  const clients: Partial<Record<Provider, OAuthClient>> = {};
  if (e.GOOGLE_OAUTH_CLIENT_ID && e.GOOGLE_OAUTH_CLIENT_SECRET) clients.gmail = { clientId: e.GOOGLE_OAUTH_CLIENT_ID, clientSecret: e.GOOGLE_OAUTH_CLIENT_SECRET };
  if (e.MS_OAUTH_CLIENT_ID && e.MS_OAUTH_CLIENT_SECRET) clients.outlook = { clientId: e.MS_OAUTH_CLIENT_ID, clientSecret: e.MS_OAUTH_CLIENT_SECRET };
  const supabaseUrl = e.SUPABASE_URL.replace(/\/$/, '');
  return {
    ok: true,
    config: {
      supabaseUrl,
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
      anonKey: e.SUPABASE_ANON_KEY ?? null,
      siteUrl: e.SITE_URL,
      allowedOrigins: new Set(e.ALLOWED_ORIGINS ?? []),
      tokenKey: e.MAIL_TOKEN_KEY,
      stateKey: e.MAIL_STATE_KEY,
      clients,
      cronSecret: e.CRON_SECRET ?? null,
      redirectUri: `${supabaseUrl}/functions/v1/mail-callback`,
    },
  };
}
