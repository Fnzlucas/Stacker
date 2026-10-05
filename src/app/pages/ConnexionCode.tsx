import { useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { emailOnlySchema, otpCodeSchema } from '@shared/account';
import { useAuth } from '../auth/AuthProvider';
import { useCaptcha } from '../components/Captcha';
import { FormAlert, SubmitButton, TextField, focusFirstInvalid, zodFieldErrors } from '../components/Form';
import { AuthLayout, PageHeading, usePageTitle } from '../components/Layouts';
import { authErrorOutcome } from '../lib/authErrors';
import { PATHS } from '../paths';
import { NotConfigured } from './NotConfigured';
import { useCooldown } from './VerifierEmail';

/**
 * Connexion sans mot de passe par code à 6 chiffres reçu par email (méthode
 * recommandée par le Lead : un code se saisit partout, contrairement à un
 * lien magique qui casse dans les navigateurs intégrés des applis mail).
 * N'ouvre jamais de compte (shouldCreateUser: false).
 */
export function ConnexionCodePage(): ReactElement {
  usePageTitle('Connexion par code');
  const { backend } = useAuth();
  const navigate = useNavigate();
  const captcha = useCaptcha('otp');
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, startCooldown] = useCooldown();

  if (!backend) return <NotConfigured />;

  async function sendCode(address: string): Promise<boolean> {
    if (!backend) return false;
    const token = captcha.token();
    if (token === false) {
      setFormError(captcha.missingMessage());
      return false;
    }
    setLoading(true);
    const { error } = await backend.auth.signInWithOtp({ email: address, options: { shouldCreateUser: false, ...(token ? { captchaToken: token } : {}) } });
    setLoading(false);
    captcha.reset();
    const outcome = error ? authErrorOutcome(error, 'otp_request') : ({ kind: 'neutral' } as const);
    if (outcome.kind === 'message') {
      setFormError(outcome.message);
      return false;
    }
    startCooldown();
    return true;
  }

  async function onEmail(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setFormError(null);
    const parsed = emailOnlySchema.safeParse({ email });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    setErrors({});
    if (await sendCode(parsed.data.email)) {
      setSentTo(parsed.data.email);
      setStep('code');
    }
  }

  async function onCode(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !backend) return;
    setFormError(null);
    const parsed = otpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setErrors({ code: parsed.error.issues[0]?.message ?? 'Code invalide.' });
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    setErrors({});
    setLoading(true);
    backend.sessionStorage.setPersistent(remember);
    const { error } = await backend.auth.verifyOtp({ email: sentTo, token: parsed.data, type: 'email' });
    setLoading(false);
    if (!error) {
      void navigate(PATHS.home, { replace: true });
      return;
    }
    const outcome = authErrorOutcome(error, 'otp_verify');
    if (outcome.kind === 'message' && outcome.field === 'code') setErrors({ code: outcome.message });
    else if (outcome.kind === 'message') setFormError(outcome.message);
  }

  return (
    <AuthLayout>
      <span className="eyebrow">Espace stacker</span>
      <PageHeading>Connexion par code</PageHeading>
      {step === 'email' ? (
        <>
          <p className="lead mt-2">Reçois un code à 6 chiffres par email, sans mot de passe.</p>
          <form ref={formRef} className="card card-hero auth-card" noValidate aria-label="Demande de code" onSubmit={(e) => void onEmail(e)}>
            <TextField label="Adresse email" type="email" name="email" autoComplete="email" inputMode="email" icon="mail" value={email} onChange={(e) => setEmail(e.target.value)} error={errors['email']} required />
            {captcha.element}
            {formError ? <FormAlert>{formError}</FormAlert> : null}
            <SubmitButton loading={loading}>Recevoir un code</SubmitButton>
          </form>
        </>
      ) : (
        <>
          <p className="lead mt-2">Si un compte existe pour {sentTo}, un code vient de partir. Il est valable 1 heure.</p>
          <form ref={formRef} className="card card-hero auth-card" noValidate aria-label="Saisie du code" onSubmit={(e) => void onCode(e)}>
            <TextField label="Code reçu par email" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} error={errors['code']} required />
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>Rester connecté sur cet appareil</span>
            </label>
            {formError ? <FormAlert>{formError}</FormAlert> : null}
            <SubmitButton loading={loading}>Se connecter</SubmitButton>
            {captcha.element}
            <button type="button" className="btn btn-ghost btn-block" disabled={cooldown > 0 || loading} onClick={() => void sendCode(sentTo)}>
              {cooldown > 0 ? `Renvoyer un code (${String(cooldown)} s)` : 'Renvoyer un code'}
            </button>
          </form>
        </>
      )}
      <p className="auth-switch">
        <Link className="link" to={PATHS.login}>
          Se connecter avec un mot de passe
        </Link>
      </p>
    </AuthLayout>
  );
}
