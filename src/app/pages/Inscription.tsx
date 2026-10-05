import { useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { TERMS_VERSION, birthDateError, signupSchema } from '@shared/account';
import { useAuth } from '../auth/AuthProvider';
import { useCaptcha } from '../components/Captcha';
import { CheckField, FormAlert, PasswordField, SubmitButton, TextField, focusFirstInvalid, zodFieldErrors } from '../components/Form';
import { AuthLayout, PageHeading, usePageTitle } from '../components/Layouts';
import { authErrorOutcome } from '../lib/authErrors';
import { PATHS } from '../paths';
import { AuthAside } from './AuthAside';
import { NotConfigured } from './NotConfigured';

export const confirmRedirectUrl = (): string => `${window.location.origin}${PATHS.confirm}`;

interface Values {
  firstName: string;
  email: string;
  password: string;
  birthDate: string;
  adultConfirmed: boolean;
  termsAccepted: boolean;
  marketingOptIn: boolean;
}

const EMPTY: Values = { firstName: '', email: '', password: '', birthDate: '', adultConfirmed: false, termsAccepted: false, marketingOptIn: false };

export function InscriptionPage(): ReactElement {
  usePageTitle('Créer un compte');
  const { backend } = useAuth();
  const navigate = useNavigate();
  const captcha = useCaptcha('signup');
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!backend) return <NotConfigured />;

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _removed, ...rest }) => rest);
  };

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !backend) return;
    setFormError(null);
    const parsed = signupSchema.safeParse(values);
    const errs = parsed.success ? {} : zodFieldErrors(parsed.error.issues);
    // La date de naissance ne sert qu'à ce contrôle : elle n'est jamais envoyée.
    const ageError = birthDateError(values.birthDate, new Date());
    if (ageError) errs['birthDate'] = ageError;
    if (!parsed.success || ageError) {
      setErrors(errs);
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
    const { data, error } = await backend.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: confirmRedirectUrl(),
        ...(token ? { captchaToken: token } : {}),
        // Lues UNE fois par le trigger de création du profil (handle_new_user).
        data: {
          first_name: parsed.data.firstName,
          adult_declared: true,
          terms_version: TERMS_VERSION,
          marketing_opt_in: parsed.data.marketingOptIn,
        },
      },
    });
    setLoading(false);
    captcha.reset();
    if (error) {
      const outcome = authErrorOutcome(error, 'signup');
      if (outcome.kind === 'message') {
        if (outcome.field === 'password') {
          setErrors({ password: outcome.message });
          requestAnimationFrame(() => focusFirstInvalid(formRef.current));
        } else setFormError(outcome.message);
        return;
      }
    }
    // Confirmation d'email désactivée (développement) : session immédiate.
    if (data.session) {
      void navigate(PATHS.onboarding, { replace: true });
      return;
    }
    // Même écran que l'adresse soit nouvelle ou déjà utilisée (aucune énumération).
    void navigate(PATHS.verifyEmail, { state: { email: parsed.data.email } });
  }

  return (
    <AuthLayout aside={<AuthAside />}>
      <span className="eyebrow">Espace stacker</span>
      <PageHeading>Crée ton compte</PageHeading>
      <p className="lead mt-2">Déjà sur la liste d’attente ? Utilise la même adresse email : ta priorité de lancement est conservée.</p>

      <form ref={formRef} className="card card-hero auth-card" noValidate aria-label="Création de compte" onSubmit={(e) => void onSubmit(e)}>
        <TextField label="Prénom" name="firstName" autoComplete="given-name" icon="user" value={values.firstName} onChange={(e) => set('firstName', e.target.value)} error={errors['firstName']} maxLength={50} required />
        <TextField label="Adresse email" type="email" name="email" autoComplete="email" inputMode="email" icon="mail" value={values.email} onChange={(e) => set('email', e.target.value)} error={errors['email']} required />
        <PasswordField
          label="Mot de passe"
          name="password"
          autoComplete="new-password"
          checklist
          email={values.email}
          value={values.password}
          onChange={(e) => set('password', e.target.value)}
          error={errors['password']}
          required
        />
        <TextField
          label="Date de naissance"
          type="date"
          name="birthDate"
          autoComplete="bday"
          icon="calendar"
          value={values.birthDate}
          onChange={(e) => set('birthDate', e.target.value)}
          error={errors['birthDate']}
          hint="Elle sert uniquement à vérifier ta majorité : elle n’est ni envoyée ni conservée."
          max={new Date().toISOString().slice(0, 10)}
          required
        />
        <div className="grid gap-1">
          <CheckField name="adultConfirmed" checked={values.adultConfirmed} onChange={(e) => set('adultConfirmed', e.target.checked)} error={errors['adultConfirmed']}>
            Je certifie être majeur(e). Stacker est réservé aux personnes de 18 ans ou plus.
          </CheckField>
          <CheckField name="termsAccepted" checked={values.termsAccepted} onChange={(e) => set('termsAccepted', e.target.checked)} error={errors['termsAccepted']}>
            J’accepte les{' '}
            <a href="/cgu" target="_blank" rel="noopener">
              conditions d’utilisation
            </a>{' '}
            et j’ai lu la{' '}
            <a href="/confidentialite" target="_blank" rel="noopener">
              politique de confidentialité
            </a>
            .
          </CheckField>
          <CheckField name="marketingOptIn" checked={values.marketingOptIn} onChange={(e) => set('marketingOptIn', e.target.checked)}>
            Facultatif : je veux recevoir les nouveautés de Stacker par email (désinscription en un clic).
          </CheckField>
        </div>
        {captcha.element}
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <SubmitButton loading={loading}>Créer mon compte</SubmitButton>
      </form>

      <p className="auth-switch">
        Déjà un compte ?{' '}
        <Link className="link" to={PATHS.login}>
          Se connecter
        </Link>
      </p>
    </AuthLayout>
  );
}
