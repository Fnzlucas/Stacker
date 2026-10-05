import { useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { loginSchema } from '@shared/account';
import { useAuth } from '../auth/AuthProvider';
import { useCaptcha } from '../components/Captcha';
import { CheckField, FormAlert, PasswordField, SubmitButton, TextField, focusFirstInvalid, zodFieldErrors } from '../components/Form';
import { AuthLayout, PageHeading, safeReturnPath, usePageTitle } from '../components/Layouts';
import { authErrorOutcome } from '../lib/authErrors';
import { PATHS } from '../paths';
import { AuthAside } from './AuthAside';
import { NotConfigured } from './NotConfigured';

interface LocationState {
  from?: string;
  notice?: string;
}

export function ConnexionPage(): ReactElement {
  usePageTitle('Connexion');
  const { backend } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;
  const captcha = useCaptcha('login');
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!backend) return <NotConfigured />;

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !backend) return;
    setFormError(null);
    const parsed = loginSchema.safeParse({ email, password });
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
    backend.sessionStorage.setPersistent(remember);
    const { error } = await backend.auth.signInWithPassword({ ...parsed.data, options: token ? { captchaToken: token } : {} });
    setLoading(false);
    if (!error) {
      void navigate(safeReturnPath(state), { replace: true });
      return;
    }
    captcha.reset();
    const outcome = authErrorOutcome(error, 'login');
    setFormError(outcome.kind === 'message' ? outcome.message : null);
  }

  return (
    <AuthLayout aside={<AuthAside />}>
      <span className="eyebrow">Espace stacker</span>
      <PageHeading>Content de te revoir</PageHeading>
      <p className="lead mt-2">Connecte-toi pour retrouver tes prospects et ta progression.</p>

      <form ref={formRef} className="card card-hero auth-card" noValidate aria-label="Connexion" onSubmit={(e) => void onSubmit(e)}>
        {state.notice ? <FormAlert tone="success">{state.notice}</FormAlert> : null}
        <TextField label="Adresse email" type="email" name="email" autoComplete="email" inputMode="email" icon="mail" value={email} onChange={(e) => setEmail(e.target.value)} error={errors['email']} required />
        <PasswordField label="Mot de passe" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors['password']} required />
        <div className="auth-row">
          <CheckField checked={remember} onChange={(e) => setRemember(e.target.checked)}>
            Rester connecté sur cet appareil
          </CheckField>
          <Link className="link" to={PATHS.forgot}>
            Mot de passe oublié ?
          </Link>
        </div>
        {captcha.element}
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <SubmitButton loading={loading}>Se connecter</SubmitButton>
        <div className="auth-divider" aria-hidden="true">
          <span>ou</span>
        </div>
        <Link className="btn btn-secondary btn-block" to={PATHS.loginCode}>
          Recevoir un code par email
        </Link>
      </form>

      <p className="auth-switch">
        Pas encore de compte ?{' '}
        <Link className="link" to={PATHS.signup}>
          Créer un compte
        </Link>
      </p>
    </AuthLayout>
  );
}
