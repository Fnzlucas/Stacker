/**
 * Configuration de push-run. Fail closed : sans clé Apple (APNs) ou sans
 * CRON_SECRET, la fonction répond 503 sans toucher à la file.
 *
 * La clé APNs est la clé .p8 créée dans le compte Apple Developer
 * (Certificates, Identifiers & Profiles → Keys → Apple Push Notifications).
 */
import { z } from 'zod';

export const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CRON_SECRET: z.string().min(24),
  APNS_KEY_ID: z.string().regex(/^[A-Z0-9]{10}$/),
  APNS_TEAM_ID: z.string().regex(/^[A-Z0-9]{10}$/),
  APNS_PRIVATE_KEY: z.string().includes('PRIVATE KEY'),
  APNS_BUNDLE_ID: z.string().regex(/^[A-Za-z0-9.-]{3,155}$/),
  APNS_ENV: z.enum(['production', 'sandbox']).default('production'),
});

export interface PushConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  cronSecret: string;
  apns: { keyId: string; teamId: string; privateKey: string; bundleId: string; host: string };
}

export type PushConfigResult = { ok: true; config: PushConfig } | { ok: false; missing: string[] };

export const APNS_HOSTS = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' } as const;

export function loadPushConfig(env: Record<string, string | undefined>): PushConfigResult {
  const apnsEnv = env['APNS_ENV']?.trim();
  const parsed = envSchema.safeParse({ ...env, APNS_ENV: apnsEnv === '' ? undefined : apnsEnv });
  if (!parsed.success) return { ok: false, missing: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))] };
  const e = parsed.data;
  return {
    ok: true,
    config: {
      supabaseUrl: e.SUPABASE_URL.replace(/\/$/, ''),
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
      cronSecret: e.CRON_SECRET,
      // Les secrets collés sur une ligne gardent souvent des « \n » littéraux.
      apns: { keyId: e.APNS_KEY_ID, teamId: e.APNS_TEAM_ID, privateKey: e.APNS_PRIVATE_KEY.replace(/\\n/g, '\n'), bundleId: e.APNS_BUNDLE_ID, host: APNS_HOSTS[e.APNS_ENV] },
    },
  };
}
