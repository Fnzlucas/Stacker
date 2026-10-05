import { useEffect, useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { emailField, otpCodeSchema } from '@shared/account';
import { Icon } from '../../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { useCaptcha } from '../components/Captcha';
import { FormAlert, SubmitButton, TextField, focusFirstInvalid } from '../components/Form';
import { AuthLayout, PageHeading, usePageTitle } from '../components/Layouts';
import { authErrorOutcome } from '../lib/authErrors';
import { PATHS } from '../paths';
import { confirmRedirectUrl } from './Inscription';
import { NotConfigured } from './NotConfigured';

const RESEND_COOLDOWN = 60;

/** Compte à rebours en secondes (renvoi d'email). */
export function useCooldown(): [number, () => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, () => setLeft(RESEND_COOLDOWN)];
}

export function VerifierEmailPage(): ReactElement {
  usePageTitle('Confirme ton adresse');
  const { backend } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const initialEmail = (location.state as { email?: string } | null)?.email ?? '';
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, startCooldown] = useCooldown();
  const captcha = useCaptcha('resend');
  const formRef = useRef<HTMLFormElement>(null);

  if (!backend) return <NotConfigured />;

  const checkedEmail = (): string | null => {
    const parsed = emailField.safeParse(email);
    if (parsed.success) return parsed.data;
    setErrors((e) => ({ ...e, email: parsed.error.issues[0]?.message ?? 'Adresse email invalide.' }));
    requestAnimationFrame(() => focusFirstInvalid(formRef.current));
    return null;
  };

  async function onVerify(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !backend) return;
    setFormError(null);
    setNotice(null);
    const mail = checkedEmail();
    const parsed = otpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setErrors((e) => ({ ...e, code: parsed.error.issues[0]?.message ?? 'Code invalide.' }));
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    if (!mail) return;
    setErrors({});
    setLoading(true);
    const { error } = await backend.auth.verifyOtp({ email: mail, token: parsed.data, type: 'email' });
    setLoading(false);
    if (!error) {
      void navigate(PATHS.onboarding, { replace: true });
      return;
    }
    const outcome = authErrorOutcome(error, 'otp_verify');
    if (outcome.kind === 'message' && outcome.field === 'code') setErrors({ code: outcome.message });
    else if (outcome.kind === 'message') setFormError(outcome.message);
  }

  async function onResend() {
    if (resending || cooldown > 0 || !backend) return;
    setFormError(null);
    setNotice(null);
    const mail = checkedEmail();
    if (!mail) return;
    const token = captcha.token();
    if (token === false) {
      setFormError(captcha.missingMessage());
      return;
    }
    setResending(true);
    const { error } = await backend.auth.resend({ type: 'signup', email: mail, options: { emailRedirectTo: confirmRedirectUrl(), ...(token ? { captchaToken: token } : {}) } });
    setResending(false);
    captcha.reset();
    const outcome = error ? authErrorOutcome(error, 'resend') : ({ kind: 'neutral' } as const);
    if (outcome.kind === 'message') {
      setFormError(outcome.message);
      return;
    }
    startCooldown();
    setNotice('Si cette adresse attend une confirmation, un nouvel email vient de partir.');
  }

  return (
    <AuthLayout>
      <div className="auth-icon" aria-hidden="true">
        <Icon name="mail" size={28} />
      </div>
      <PageHeading>Vérifie ta boîte mail</PageHeading>
      <p className="lead mt-2">
        {initialEmail ? (
          <>
            Nous avons envoyé un email à <strong className="text-ink">{initialEmail}</strong>.{' '}
          </>
        ) : null}
        Clique sur le lien qu’il contient, ou saisis ci-dessous le code à 6 chiffres.
      </p>

      <form ref={formRef} className="card card-hero auth-card" noValidate aria-label="Confirmation de l’adresse" onSubmit={(e) => void onVerify(e)}>
        {initialEmail ? null : (
          <TextField label="Adresse email" type="email" name="email" autoComplete="email" icon="mail" value={email} onChange={(e) => setEmail(e.target.value)} error={errors['email']} required />
        )}
        <TextField
          label="Code de confirmation"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={errors['code']}
          hint="6 chiffres, valable 1 heure."
          required
        />
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
        <SubmitButton loading={loading}>Confirmer mon adresse</SubmitButton>
        {captcha.element}
        <button type="button" className={`btn btn-ghost btn-block${resending ? ' is-loading' : ''}`} disabled={resending || cooldown > 0} onClick={() => void onResend()}>
          {cooldown > 0 ? `Renvoyer l’email (${String(cooldown)} s)` : 'Renvoyer l’email'}
        </button>
      </form>

      <p className="form-note auth-note">
        <Icon name="info" />
        <span>Rien reçu ? Regarde dans les courriers indésirables. Si tu as déjà un compte avec cette adresse, connecte-toi directement.</span>
      </p>
      <p className="auth-switch">
        <Link className="link" to={PATHS.login}>
          Aller à la connexion
        </Link>
      </p>
    </AuthLayout>
  );
}
