import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, type ReactElement } from 'react';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth, RequireGuest, Splash } from './components/Layouts';
import { ApiError } from './lib/apiError';
import { getBackend } from './lib/supabase';
import { PATHS } from './paths';

// Chaque écran est chargé à la demande : le JS initial se limite à React, au
// routeur et au client Auth (budget DoD : 170 Ko gzip).
const named = <K extends string>(load: () => Promise<Record<K, () => ReactElement>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const ConnexionPage = named(() => import('./pages/Connexion'), 'ConnexionPage');
const ConnexionCodePage = named(() => import('./pages/ConnexionCode'), 'ConnexionCodePage');
const InscriptionPage = named(() => import('./pages/Inscription'), 'InscriptionPage');
const MotDePasseOubliePage = named(() => import('./pages/MotDePasseOublie'), 'MotDePasseOubliePage');
const VerifierEmailPage = named(() => import('./pages/VerifierEmail'), 'VerifierEmailPage');
const ConfirmerPage = named(() => import('./pages/Confirmer'), 'ConfirmerPage');
const NouveauMotDePassePage = named(() => import('./pages/NouveauMotDePasse'), 'NouveauMotDePassePage');
const DeconnexionPage = named(() => import('./pages/Deconnexion'), 'DeconnexionPage');
const CompteSupprimePage = named(() => import('./pages/CompteSupprime'), 'CompteSupprimePage');
const AppShell = named(() => import('./components/AppShell'), 'AppShell');
const OnboardingPage = lazy(() => import('./pages/Onboarding').then((m) => ({ default: m.OnboardingPage })));
const AccueilPage = lazy(() => import('./pages/Accueil').then((m) => ({ default: m.AccueilPage })));
const ProfilPage = lazy(() => import('./pages/Profil').then((m) => ({ default: m.ProfilPage })));
const ProspectsPage = lazy(() => import('./pages/Bientot').then((m) => ({ default: m.ProspectsPage })));
const DealsPage = lazy(() => import('./pages/Bientot').then((m) => ({ default: m.DealsPage })));
const GainsPage = lazy(() => import('./pages/Bientot').then((m) => ({ default: m.GainsPage })));

const page = (el: ReactElement) => <Suspense fallback={<Splash />}>{el}</Suspense>;

export const router = createBrowserRouter([
  {
    element: <RequireGuest />,
    children: [
      { path: PATHS.login, element: page(<ConnexionPage />) },
      { path: PATHS.loginCode, element: page(<ConnexionCodePage />) },
      { path: PATHS.signup, element: page(<InscriptionPage />) },
      { path: PATHS.forgot, element: page(<MotDePasseOubliePage />) },
      { path: PATHS.verifyEmail, element: page(<VerifierEmailPage />) },
    ],
  },
  { path: PATHS.confirm, element: page(<ConfirmerPage />) },
  { path: PATHS.newPassword, element: page(<NouveauMotDePassePage />) },
  { path: PATHS.logout, element: page(<DeconnexionPage />) },
  { path: PATHS.deleted, element: page(<CompteSupprimePage />) },
  {
    element: <RequireAuth />,
    children: [
      { path: PATHS.onboarding, element: page(<OnboardingPage />) },
      {
        element: page(<AppShell />),
        children: [
          { path: PATHS.home, element: page(<AccueilPage />) },
          { path: PATHS.prospects, element: page(<ProspectsPage />) },
          { path: PATHS.deals, element: page(<DealsPage />) },
          { path: PATHS.gains, element: page(<GainsPage />) },
          { path: PATHS.profile, element: page(<ProfilPage />) },
        ],
      },
    ],
  },
  { path: '/app/*', element: <Navigate to={PATHS.home} replace /> },
]);

/** Jeton refusé par le serveur (session révoquée, compte supprimé) : déconnexion locale, l'app renvoie vers la connexion. */
function onApiError(error: unknown): void {
  if (error instanceof ApiError && error.kind === 'unauthorized') void getBackend()?.auth.signOut({ scope: 'local' });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      // Une seule nouvelle tentative, et seulement pour les erreurs passagères.
      retry: (count, error) => count < 1 && (!(error instanceof ApiError) || error.kind === 'network' || error.kind === 'server'),
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
    mutations: { retry: 0 },
  },
});

export function App(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider backend={getBackend()}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
