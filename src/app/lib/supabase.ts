/**
 * Clients Supabase de l'app connectée : Auth (GoTrue) et PostgREST, sans le
 * paquet supabase-js complet (pas de Realtime ni de Storage : bundle léger).
 * Seule la clé PUBLIQUE est utilisée ; la sécurité repose sur la RLS et les
 * fonctions serveur.
 */
import { GoTrueClient } from '@supabase/auth-js';
import { PostgrestClient } from '@supabase/postgrest-js';
import { isSupabaseConfigured, publicEnv, type PublicEnv } from '../../lib/env';
import { createSessionStorage, type SessionStorageAdapter } from './authStorage';

export interface Backend {
  url: string;
  anonKey: string;
  auth: GoTrueClient;
  db: PostgrestClient;
  sessionStorage: SessionStorageAdapter;
  /** Jeton d'accès courant (null si déconnecté). */
  accessToken: () => Promise<string | null>;
}

export const STORAGE_KEY = 'stacker-auth';

export function createBackend(env: PublicEnv): Backend | null {
  if (!isSupabaseConfigured(env)) return null;
  const { supabaseUrl: url, supabaseAnonKey: anonKey } = env;
  const storage = createSessionStorage();
  const auth = new GoTrueClient({
    url: `${url}/auth/v1`,
    headers: { apikey: anonKey },
    storageKey: STORAGE_KEY,
    storage,
    autoRefreshToken: true,
    persistSession: true,
    // Les liens des emails arrivent sur /app/auth/confirmer avec un token_hash,
    // vérifié explicitement (verifyOtp) : rien n'est lu automatiquement dans l'URL.
    detectSessionInUrl: false,
    flowType: 'implicit',
  });
  const accessToken = async () => (await auth.getSession()).data.session?.access_token ?? null;
  const db = new PostgrestClient(`${url}/rest/v1`, {
    headers: { apikey: anonKey },
    // Une seule politique de nouvelle tentative : celle de TanStack Query.
    retry: false,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      const token = await accessToken();
      // Sans session, la requête part avec la seule clé publique : la RLS refuse tout.
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    },
  });
  return { url, anonKey, auth, db, sessionStorage: storage, accessToken };
}

let backend: Backend | null | undefined;

/** Instance unique (un seul client Auth par onglet). */
export function getBackend(): Backend | null {
  if (backend === undefined) backend = createBackend(publicEnv);
  return backend;
}
