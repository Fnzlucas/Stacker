import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { EmailOtpType } from '@supabase/auth-js';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { FormAlert } from '../components/Form';
import { AuthLayout, PageHeading, Splash, usePageTitle } from '../components/Layouts';
import { authErrorOutcome } from '../lib/authErrors';
import { PATHS } from '../paths';
import { NotConfigured } from './NotConfigured';

const TYPES: readonly EmailOtpType[] = ['email', 'signup', 'recovery', 'magiclink', 'invite', 'email_change'];
const isOtpType = (v: string | null): v is EmailOtpType => v !== null && (TYPES as readonly string[]).includes(v);

/**
 * Atterrissage des liens envoyés par email (confirmation, connexion, mot de
 * passe oublié). Le token_hash est vérifié une seule fois puis retiré de
 * l'URL et de l'historique.
 */
const INCOMPLETE = 'Ce lien est incomplet. Ouvre-le directement depuis l’email, sans le modifier.';

function readLink(): { tokenHash: string; type: EmailOtpType } | null {
  const params = new URLSearchParams(window.location.search);
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (!tokenHash || !/^[A-Za-z0-9_-]{8,200}$/.test(tokenHash) || !isOtpType(type)) return null;
  return { tokenHash, type };
}

export function ConfirmerPage(): ReactElement {
  usePageTitle('Vérification');
  const { backend } = useAuth();
  const navigate = useNavigate();
  const started = useRef(false);
  const [link] = useState(readLink);
  const [error, setError] = useState<string | null>(link ? null : INCOMPLETE);

  useEffect(() => {
    if (started.current || !backend) return;
    started.current = true;
    // Le jeton ne reste ni dans la barre d'adresse ni dans l'historique.
    window.history.replaceState(null, '', PATHS.confirm);
    if (!link) return;
    void backend.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type }).then(({ error: err }) => {
      if (err) {
        const outcome = authErrorOutcome(err, 'link_verify');
        setError(outcome.kind === 'message' ? outcome.message : 'Ce lien a expiré ou a déjà servi. Demande-en un nouveau.');
        return;
      }
      void navigate(link.type === 'recovery' ? PATHS.newPassword : PATHS.onboarding, { replace: true });
    });
  }, [backend, link, navigate]);

  if (!backend) return <NotConfigured />;
  if (!error) return <Splash label="Vérification du lien" />;
  return (
    <AuthLayout>
      <PageHeading>Lien invalide</PageHeading>
      <div className="card card-hero auth-card">
        <FormAlert>{error}</FormAlert>
        <Link className="btn btn-primary btn-block btn-lg" to={PATHS.login}>
          Aller à la connexion
        </Link>
        <Link className="btn btn-ghost btn-block" to={PATHS.forgot}>
          Mot de passe oublié
        </Link>
      </div>
    </AuthLayout>
  );
}
