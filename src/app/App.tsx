import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, type ReactElement } from 'react';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router';
import { AuthProvider } from './auth/AuthProvider';
import { scheduleBootCheck } from './boot';
import { RequireAuth, RequireGuest, Splash } from './components/Layouts';
import { ApiError } from './lib/apiError';
import { getBackend } from './lib/supabase';
import { PATHS } from './paths';

// Chaque écran est chargé à la demande : le JS initial se limite à React, au
// routeur et au client Auth (budget DoD : 170 Ko gzip).
const named = <K extends string>(load: () => Promise<Record<K, () => ReactElement>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const DemarrerPage = named(() => import('./pages/Demarrer'), 'DemarrerPage');
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
const ProspectsPage = lazy(() => import('./pages/Prospects').then((m) => ({ default: m.ProspectsPage })));
const ProspectFichePage = lazy(() => import('./pages/ProspectFiche').then((m) => ({ default: m.ProspectFichePage })));
const DealsPage = lazy(() => import('./pages/Deals').then((m) => ({ default: m.DealsPage })));
const DealNewPage = lazy(() => import('./pages/DealNew').then((m) => ({ default: m.DealNewPage })));
const DealFichePage = lazy(() => import('./pages/DealFiche').then((m) => ({ default: m.DealFichePage })));
const GainsPage = lazy(() => import('./pages/Gains').then((m) => ({ default: m.GainsPage })));
const FormationPage = lazy(() => import('./pages/Formation').then((m) => ({ default: m.FormationPage })));
const AdminPage = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminPage })));
const AbonnementPage = lazy(() => import('./pages/Abonnement').then((m) => ({ default: m.AbonnementPage })));

const page = (el: ReactElement) => <Suspense fallback={<Splash />}>{el}</Suspense>;

export const router = createBrowserRouter([
  {
    element: <RequireGuest />,
    children: [
      { path: PATHS.welcome, element: page(<DemarrerPage />) },
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
          { path: `${PATHS.prospects}/:claimId`, element: page(<ProspectFichePage />) },
          { path: PATHS.deals, element: page(<DealsPage />) },
          { path: PATHS.dealNew, element: page(<DealNewPage />) },
          { path: `${PATHS.deals}/:dealId`, element: page(<DealFichePage />) },
          { path: PATHS.gains, element: page(<GainsPage />) },
          { path: PATHS.billing, element: page(<AbonnementPage />) },
          { path: PATHS.admin, element: page(<AdminPage />) },
          { path: PATHS.formation, element: page(<FormationPage />) },
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

/** Écrans principaux chargés en arrière-plan après le démarrage : la navigation ne passe plus par un écran de chargement. */
const PREFETCH = [
  () => import('./pages/Accueil'),
  () => import('./pages/Prospects'),
  () => import('./pages/ProspectFiche'),
  () => import('./pages/Deals'),
  () => import('./pages/DealNew'),
  () => import('./pages/DealFiche'),
  () => import('./pages/Gains'),
  () => import('./pages/Profil'),
  () => import('./pages/Abonnement'),
  () => import('./pages/Formation'),
];

export function App(): ReactElement {
  // Premier rendu fait : l'écran de démarrage part dès que plus rien ne le retient.
  useEffect(() => scheduleBootCheck(), []);
  useEffect(() => {
    // Après le départ de l'écran de démarrage, un écran à la fois, quand le navigateur est libre.
    let cancelled = false;
    const idle = (fn: () => void): void => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 2000 });
      else setTimeout(fn, 200);
    };
    const next = (i: number) => {
      const load = PREFETCH[i];
      if (cancelled || !load) return;
      idle(() => void load().catch(() => undefined).finally(() => next(i + 1)));
    };
    const start = window.setInterval(() => {
      if (document.getElementById('boot')) return;
      window.clearInterval(start);
      next(0);
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(start);
    };
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider backend={getBackend()}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
