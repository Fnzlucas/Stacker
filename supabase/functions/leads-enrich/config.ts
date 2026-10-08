/**
 * Configuration de `leads-enrich` (tâche planifiée). Fail closed : sans clé
 * Google ni secret de planification, la fonction répond 503 et ne fait rien.
 */
import { z } from 'zod';

export const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  // Clé SERVEUR, restreinte à « Places API (New) » dans la console Google Cloud.
  GOOGLE_PLACES_SERVER_KEY: z.string().min(20),
  // Secret partagé avec la tâche pg_cron qui appelle la fonction.
  CRON_SECRET: z.string().min(24),
  RECHERCHE_ENTREPRISES_URL: z
    .url()
    .optional()
    .transform((u) => (u ?? 'https://recherche-entreprises.api.gouv.fr').replace(/\/$/, '')),
  GEO_API_URL: z
    .url()
    .optional()
    .transform((u) => (u ?? 'https://geo.api.gouv.fr').replace(/\/$/, '')),
});

export interface EnrichConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  placesKey: string;
  cronSecret: string;
  apiBase: string;
  geoBase: string;
}

export type ConfigResult = { ok: true; config: EnrichConfig } | { ok: false; missing: string[] };

export function loadConfig(env: Record<string, string | undefined>): ConfigResult {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) return { ok: false, missing: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))] };
  const e = parsed.data;
  return {
    ok: true,
    config: {
      supabaseUrl: e.SUPABASE_URL.replace(/\/$/, ''),
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
      placesKey: e.GOOGLE_PLACES_SERVER_KEY,
      cronSecret: e.CRON_SECRET,
      apiBase: e.RECHERCHE_ENTREPRISES_URL,
      geoBase: e.GEO_API_URL,
    },
  };
}
