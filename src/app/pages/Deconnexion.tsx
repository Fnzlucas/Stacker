import { useEffect, useRef, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Splash, usePageTitle } from '../components/Layouts';
import { PATHS } from '../paths';

/** Déconnexion de cet appareil : jetons effacés, cache vidé (AuthProvider), retour à la connexion. */
export function DeconnexionPage(): ReactElement {
  usePageTitle('Déconnexion');
  const { backend } = useAuth();
  const navigate = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const finish = () => void navigate(PATHS.login, { replace: true, state: { notice: 'Tu es déconnecté.' } });
    if (!backend) {
      finish();
      return;
    }
    void backend.auth.signOut({ scope: 'local' }).finally(finish);
  }, [backend, navigate]);
  return <Splash label="Déconnexion" />;
}
