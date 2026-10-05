import { useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { newPasswordSchema } from '@shared/account';
import { useAuth } from '../auth/AuthProvider';
import { FormAlert, PasswordField, SubmitButton, focusFirstInvalid, zodFieldErrors } from '../components/Form';
import { AuthLayout, PageHeading, Splash, usePageTitle } from '../components/Layouts';
import { authErrorOutcome } from '../lib/authErrors';
import { PATHS } from '../paths';
import { NotConfigured } from './NotConfigured';

/** Choix d'un nouveau mot de passe, après le lien « mot de passe oublié » (session de récupération). */
export function NouveauMotDePassePage(): ReactElement {
  usePageTitle('Nouveau mot de passe');
  const { backend, status, email } = useAuth();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!backend) return <NotConfigured />;
  if (status === 'loading') return <Splash />;
  if (status === 'signedOut') {
    return (
      <AuthLayout>
        <PageHeading>Lien expiré</PageHeading>
        <div className="card card-hero auth-card">
          <FormAlert>Ce lien de réinitialisation a expiré ou a déjà servi. Demande-en un nouveau.</FormAlert>
          <Link className="btn btn-primary btn-block btn-lg" to={PATHS.forgot}>
            Demander un nouveau lien
          </Link>
        </div>
      </AuthLayout>
    );
  }

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !backend) return;
    setFormError(null);
    const parsed = newPasswordSchema.safeParse({ password, confirm, email: email ?? '' });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    setErrors({});
    setLoading(true);
    const { error } = await backend.auth.updateUser({ password: parsed.data.password });
    setLoading(false);
    if (!error) {
      void navigate(PATHS.home, { replace: true, state: { notice: 'Ton mot de passe a été mis à jour.' } });
      return;
    }
    const outcome = authErrorOutcome(error, 'update_password');
    if (outcome.kind === 'message' && outcome.field === 'password') {
      setErrors({ password: outcome.message });
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
    } else if (outcome.kind === 'message') setFormError(outcome.message);
  }

  return (
    <AuthLayout>
      <span className="eyebrow">Espace stacker</span>
      <PageHeading>Nouveau mot de passe</PageHeading>
      <p className="lead mt-2">Choisis un mot de passe que tu n’utilises nulle part ailleurs.</p>
      <form ref={formRef} className="card card-hero auth-card" noValidate aria-label="Choix du mot de passe" onSubmit={(e) => void onSubmit(e)}>
        <PasswordField label="Nouveau mot de passe" name="password" autoComplete="new-password" checklist email={email ?? ''} value={password} onChange={(e) => setPassword(e.target.value)} error={errors['password']} required />
        <PasswordField label="Confirme le mot de passe" name="confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors['confirm']} required />
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <SubmitButton loading={loading}>Enregistrer le mot de passe</SubmitButton>
      </form>
    </AuthLayout>
  );
}
