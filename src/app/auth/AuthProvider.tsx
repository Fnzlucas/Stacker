import type { Session } from '@supabase/auth-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import type { Backend } from '../lib/supabase';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface AuthState {
  backend: Backend | null;
  status: AuthStatus;
  session: Session | null;
  userId: string | null;
  email: string | null;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Session Supabase partagée par toute l'app. Une seule source : les
 * événements d'auth-js (connexion, rafraîchissement, déconnexion, y compris
 * depuis un autre onglet). À la déconnexion, le cache de données est vidé.
 */
export function AuthProvider({ backend, children }: { backend: Backend | null; children: ReactNode }): ReactElement {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(backend ? 'loading' : 'signedOut');

  useEffect(() => {
    if (!backend) return undefined;
    let active = true;
    const { data } = backend.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      setSession(next);
      setStatus(next ? 'signedIn' : 'signedOut');
      if (event === 'SIGNED_OUT') queryClient.clear();
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [backend, queryClient]);

  const value = useMemo<AuthState>(
    () => ({ backend, status, session, userId: session?.user.id ?? null, email: session?.user.email ?? null }),
    [backend, status, session],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth hors de <AuthProvider>');
  return ctx;
}

/** Variante pour les écrans protégés : session garantie par <RequireAuth>. */
export function useSignedIn(): AuthState & { backend: Backend; session: Session; userId: string } {
  const auth = useAuth();
  if (!auth.backend || !auth.session || !auth.userId) throw new Error('useSignedIn sans session');
  return auth as AuthState & { backend: Backend; session: Session; userId: string };
}
