/**
 * Variables publiques du front (préfixe VITE_), figées au build. Aucune n'est
 * secrète : l'URL Supabase et la clé anon/publishable sont faites pour être
 * exposées, la sécurité repose sur la RLS et la fonction serveur.
 *
 * - Sans VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY : le site fonctionne, le
 *   formulaire de liste d'attente est désactivé avec un message, le compteur
 *   n'est pas affiché.
 * - Sans VITE_TURNSTILE_SITE_KEY : pas de vérification anti-robot côté
 *   navigateur (le rate limit serveur reste actif).
 */
export interface PublicEnv {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  turnstileSiteKey: string | null;
}

function httpsOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const nonEmpty = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

export function readPublicEnv(env: Record<string, unknown>): PublicEnv {
  return {
    supabaseUrl: httpsOrigin(env['VITE_SUPABASE_URL']),
    supabaseAnonKey: nonEmpty(env['VITE_SUPABASE_ANON_KEY']),
    turnstileSiteKey: nonEmpty(env['VITE_TURNSTILE_SITE_KEY']),
  };
}

export const isSupabaseConfigured = (env: PublicEnv): env is PublicEnv & { supabaseUrl: string; supabaseAnonKey: string } =>
  env.supabaseUrl !== null && env.supabaseAnonKey !== null;

export const publicEnv: PublicEnv = readPublicEnv(import.meta.env);
