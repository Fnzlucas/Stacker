/**
 * Configuration d'email-run. Fail closed : sans Brevo ou sans CRON_SECRET,
 * la fonction répond 503 sans toucher à la file d'envoi.
 */
import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : null));

export const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SITE_URL: z.url().transform((u) => u.replace(/\/$/, '')),
  CRON_SECRET: z.string().min(24),
  BREVO_API_KEY: z.string().min(10),
  BREVO_SENDER_EMAIL: z.email(),
  BREVO_SENDER_NAME: optional,
  CONTACT_EMAIL: optional.pipe(z.email().nullable()),
});

export interface EmailConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  siteUrl: string;
  cronSecret: string;
  brevo: { apiKey: string; senderEmail: string; senderName: string };
  contactEmail: string;
}

export type EmailConfigResult = { ok: true; config: EmailConfig } | { ok: false; missing: string[] };

export function loadEmailConfig(env: Record<string, string | undefined>): EmailConfigResult {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) return { ok: false, missing: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))] };
  const e = parsed.data;
  return {
    ok: true,
    config: {
      supabaseUrl: e.SUPABASE_URL.replace(/\/$/, ''),
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
      siteUrl: e.SITE_URL,
      cronSecret: e.CRON_SECRET,
      brevo: { apiKey: e.BREVO_API_KEY, senderEmail: e.BREVO_SENDER_EMAIL, senderName: e.BREVO_SENDER_NAME ?? 'Stacker' },
      // Adresse de contact déjà indiquée dans le contrat client.
      contactEmail: e.CONTACT_EMAIL ?? 'stacker-contact@outlook.com',
    },
  };
}
