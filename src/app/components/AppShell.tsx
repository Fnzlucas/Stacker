import { useEffect, type ReactElement } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { Icon, type IconName } from '../../components/Icon';
import { useQueryClient } from '@tanstack/react-query';
import { useSignedIn } from '../auth/AuthProvider';
import { initNative } from '../lib/native';
import { useProfile } from '../lib/queries';
import { PATHS } from '../paths';
import { LoadError, Splash } from './Layouts';

/** Le profil s'ouvre depuis l'avatar de l'accueil. L'onglet Academy couvre aussi l'entraînement et la formation. */
const TABS: { to: string; label: string; icon: IconName; end?: boolean; also?: string[] }[] = [
  { to: PATHS.home, label: 'Accueil', icon: 'home', end: true },
  { to: PATHS.academy, label: 'Academy', icon: 'graduation', also: [PATHS.training, PATHS.formation] },
  { to: PATHS.prospects, label: 'Prospects', icon: 'users' },
  { to: PATHS.deals, label: 'Deals', icon: 'briefcase' },
  { to: PATHS.gains, label: 'Gains', icon: 'wallet' },
];

export function TabBar(): ReactElement {
  const { pathname } = useLocation();
  return (
    <nav className="tabbar app-tabbar" aria-label="Navigation de l’application">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end ?? false}
          className={({ isActive }) => (isActive || tab.also?.some((p) => pathname.startsWith(p)) ? 'tabbar-item is-active' : 'tabbar-item')}
        >
          <span className="tabbar-icon">
            <Icon name={tab.icon} />
          </span>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Coquille de l'app : profil chargé, onboarding fait, barre basse. */
export function AppShell(): ReactElement {
  const profile = useProfile();
  const { pathname } = useLocation();
  const { backend } = useSignedIn();
  const queryClient = useQueryClient();
  // Application iPhone : retour au premier plan, dictée native, notifications (rien dans le navigateur).
  useEffect(() => {
    void initNative(queryClient, () => backend);
  }, [queryClient, backend]);
  // Chaque nouvel écran s'ouvre en haut (sinon il garde le défilement de l'écran précédent).
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);
  if (profile.isPending) return <Splash />;
  if (profile.isError) return <LoadError onRetry={() => void profile.refetch()} />;
  if (!profile.data.onboarding_completed_at) return <Navigate to={PATHS.onboarding} replace />;
  return (
    <div className="app-page">
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>
      <main id="contenu" className="app-main">
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}

