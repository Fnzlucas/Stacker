import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { Icon } from '../../components/Icon';
import { Logo, LogoLockup } from '../../components/Logo';
import { useAuth } from '../auth/AuthProvider';
import { PATHS, safeReturnPath } from '../paths';

export { safeReturnPath };

/** Titre de l'onglet + focus sur le titre de page à chaque navigation (lecteurs d'écran). */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} — Stacker`;
  }, [title]);
}

export function PageHeading({ children, className = 'h1' }: { children: ReactNode; className?: string }): ReactElement {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} className={`${className} page-heading`}>
      {children}
    </h1>
  );
}

export function Splash({ label = 'Chargement' }: { label?: string }): ReactElement {
  return (
    <div className="app-splash" role="status" aria-live="polite">
      <Logo size={56} />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/** Écrans d'authentification : colonne centrée, logo, carte. */
export function AuthLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }): ReactElement {
  return (
    <div className="auth-page">
      <header className="auth-top">
        <a href="/" className="logo-link" aria-label="Stacker, retour au site">
          <LogoLockup size={32} />
        </a>
      </header>
      <main id="contenu" className="auth-main">
        <div className="auth-column">{children}</div>
        {aside ? <aside className="auth-aside" aria-label="Stacker en bref">{aside}</aside> : null}
      </main>
      <footer className="auth-footer">
        <a href="/cgu">Conditions d’utilisation</a>
        <a href="/confidentialite">Confidentialité</a>
        <a href="/contact">Aide</a>
      </footer>
    </div>
  );
}

/** Écran réservé aux personnes connectées. */
export function RequireAuth(): ReactElement {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'signedOut') return <Navigate to={PATHS.login} replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Écran réservé aux personnes déconnectées (connexion, inscription…). */
export function RequireGuest(): ReactElement {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'signedIn') return <Navigate to={safeReturnPath(location.state)} replace />;
  return <Outlet />;
}


export function LoadError({ onRetry }: { onRetry: () => void }): ReactElement {
  return (
    <main className="app-splash" id="contenu">
      <div className="empty">
        <div className="empty-art">
          <div className="tile">
            <Icon name="alert" />
          </div>
        </div>
        <h1 className="h3">Chargement impossible</h1>
        <p>Vérifie ta connexion internet, puis réessaie.</p>
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          Réessayer
        </button>
        <Link className="link mt-2" to={PATHS.logout}>
          Se déconnecter
        </Link>
      </div>
    </main>
  );
}

export function AppBar({ title, actions }: { title: ReactNode; actions?: ReactNode }): ReactElement {
  return (
    <header className="appbar app-appbar">
      <PageHeading className="appbar-title">{title}</PageHeading>
      {actions ? <div className="appbar-actions">{actions}</div> : null}
    </header>
  );
}
