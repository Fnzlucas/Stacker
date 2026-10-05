import type { ReactElement } from 'react';
import { NavLink, Navigate, Outlet } from 'react-router';
import { Icon, type IconName } from '../../components/Icon';
import { useProfile } from '../lib/queries';
import { PATHS } from '../paths';
import { LoadError, Splash } from './Layouts';

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: PATHS.home, label: 'Accueil', icon: 'home', end: true },
  { to: PATHS.prospects, label: 'Prospects', icon: 'users' },
  { to: PATHS.deals, label: 'Deals', icon: 'briefcase' },
  { to: PATHS.gains, label: 'Gains', icon: 'wallet' },
  { to: PATHS.profile, label: 'Profil', icon: 'user' },
];

export function TabBar(): ReactElement {
  return (
    <nav className="tabbar app-tabbar" aria-label="Navigation de l’application">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end ?? false} className="tabbar-item">
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

