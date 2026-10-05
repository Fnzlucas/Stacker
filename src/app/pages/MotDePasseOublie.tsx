import { useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { Link } from 'react-router';
import { emailOnlySchema } from '@shared/account';
import { Icon } from '../../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { useCaptcha } from '../components/Captcha';
import { FormAlert, SubmitButton, TextField, focusFirstInvalid, zodFieldErrors } from '../components/Form';
import { AuthLayout, PageHeading, usePageTitle } from '../components/Layouts';
import { authErrorOutcome } from '../lib/authErrors';
import { PATHS } from '../paths';
import { confirmRedirectUrl } from './Inscription';
import { NotConfigured } from './NotConfigured';

export function MotDePasseOubliePage(): ReactElement {
  usePageTitle('Mot de passe oublié');
  const { backend } = useAuth();
  const captcha = useCaptcha('recover');
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  if (!backend) return <NotConfigured />;

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !backend) return;
    setFormError(null);
    const parsed = emailOnlySchema.safeParse({ email });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    setErrors({});
    const token = captcha.token();
    if (token === false) {
      setFormError(captcha.missingMessage());
      return;
    }
    setLoading(true);
    const { error } = await backend.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: confirmRedirectUrl(), ...(token ? { captchaToken: token } : {}) });
    setLoading(false);
    captcha.reset();
    const outcome = error ? authErrorOutcome(error, 'recover') : ({ kind: 'neutral' } as const);
    if (outcome.kind === 'message') {
      setFormError(outcome.message);
      return;
    }
    setSent(true);
  }

  return (
    <AuthLayout>
      <span className="eyebrow">Espace stacker</span>
      <PageHeading>Mot de passe oublié</PageHeading>
      {sent ? (
        <div className="card card-hero auth-card" data-testid="recover-sent">
          <FormAlert tone="success">Si un compte existe pour cette adresse, un email vient de partir avec un lien pour choisir un nouveau mot de passe. Il est valable 1 heure.</FormAlert>
          <p className="form-note">
            <Icon name="info" />
            <span>Rien reçu dans quelques minutes ? Regarde dans les courriers indésirables, ou vérifie l’adresse saisie.</span>
          </p>
          <Link className="btn btn-primary btn-block btn-lg" to={PATHS.login}>
            Retour à la connexion
          </Link>
        </div>
      ) : (
        <>
          <p className="lead mt-2">Indique ton adresse email : tu recevras un lien pour choisir un nouveau mot de passe.</p>
          <form ref={formRef} className="card card-hero auth-card" noValidate aria-label="Mot de passe oublié" onSubmit={(e) => void onSubmit(e)}>
            <TextField label="Adresse email" type="email" name="email" autoComplete="email" inputMode="email" icon="mail" value={email} onChange={(e) => setEmail(e.target.value)} error={errors['email']} required />
            {captcha.element}
            {formError ? <FormAlert>{formError}</FormAlert> : null}
            <SubmitButton loading={loading}>Recevoir le lien</SubmitButton>
          </form>
          <p className="auth-switch">
            <Link className="link" to={PATHS.login}>
              Retour à la connexion
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
