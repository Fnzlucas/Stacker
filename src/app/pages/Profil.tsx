import { useEffect, useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { DELETE_CONFIRMATION, GOALS, LEGAL_STATUSES, formatPhone, profileUpdateSchema } from '@shared/account';
import { DEPARTMENTS } from '@shared/waitlist';
import { Icon } from '../../components/Icon';
import { useSignedIn } from '../auth/AuthProvider';
import { useCaptcha } from '../components/Captcha';
import { FormAlert, PasswordField, SelectField, SubmitButton, TextField, focusFirstInvalid, zodFieldErrors } from '../components/Form';
import { AppBar, usePageTitle } from '../components/Layouts';
import { LevelPill } from '../components/Ui';
import { ApiError, apiErrorMessage, deleteAccount, exportMyData, type Profile } from '../lib/api';
import { authErrorOutcome } from '../lib/authErrors';
import { formatLongDate, initials } from '../lib/dates';
import { useProfile, useTiers, useUpdateProfile } from '../lib/queries';
import { PATHS } from '../paths';

type FormValues = Record<'first_name' | 'last_name' | 'phone' | 'department' | 'city' | 'legal_status' | 'siret' | 'goal', string>;

const toForm = (p: Profile): FormValues => ({
  first_name: p.first_name ?? '',
  last_name: p.last_name ?? '',
  phone: p.phone ? formatPhone(p.phone) : '',
  department: p.department ?? '',
  city: p.city ?? '',
  legal_status: p.legal_status ?? '',
  siret: p.siret ?? '',
  goal: p.goal ?? '',
});

export function ProfilPage(): ReactElement {
  usePageTitle('Profil');
  const profile = useProfile();
  const tiers = useTiers();
  const { email } = useSignedIn();
  const p = profile.data;
  if (!p) return <></>;
  const tier = tiers.data?.find((t) => t.code === p.tier);
  return (
    <div className="app-container">
      <AppBar
        title="Profil"
        actions={
          <Link className="btn btn-icon" to={PATHS.logout} aria-label="Se déconnecter">
            <Icon name="logout" />
          </Link>
        }
      />
      <section className="card card-hero profile-head" aria-label="Ton compte">
        <span className="avatar avatar-dark avatar-round profile-avatar" aria-hidden="true">
          {initials(p.first_name, p.last_name)}
        </span>
        <div className="min-w-0">
          <p className="h3 truncate">{[p.first_name, p.last_name].filter(Boolean).join(' ')}</p>
          <p className="text-small truncate">{email}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {tier ? <LevelPill tier={tier} /> : null}
            <span className="text-small">Membre depuis le {formatLongDate(p.created_at)}</span>
          </div>
        </div>
      </section>
      <ProfileForm key={p.id} profile={p} />
      <DataSection />
      <AccountSection />
    </div>
  );
}

function ProfileForm({ profile }: { profile: Profile }): ReactElement {
  const update = useUpdateProfile();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<FormValues>(() => toForm(profile));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (key: keyof FormValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(false);
    if (errors[key]) setErrors(({ [key]: _removed, ...rest }) => rest);
  };

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = profileUpdateSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    setErrors({});
    update.mutate(parsed.data, {
      onSuccess: (next) => {
        setValues(toForm(next));
        setSaved(true);
      },
      onError: (e) => setFormError(apiErrorMessage(e)),
    });
  }

  const companyStatus = values.legal_status !== '' && values.legal_status !== 'sans_statut';

  return (
    <form ref={formRef} className="card card-hero profile-form" noValidate aria-labelledby="profile-form-title" onSubmit={onSubmit}>
      <h2 id="profile-form-title" className="h2">
        Mes informations
      </h2>
      <fieldset className="form-group">
        <legend className="eyebrow">Identité</legend>
        <TextField label="Prénom" name="first_name" autoComplete="given-name" value={values.first_name} onChange={(e) => set('first_name', e.target.value)} error={errors['first_name']} maxLength={50} required />
        <TextField label="Nom" name="last_name" autoComplete="family-name" optional value={values.last_name} onChange={(e) => set('last_name', e.target.value)} error={errors['last_name']} maxLength={80} />
        <TextField label="Téléphone" name="phone" type="tel" autoComplete="tel" inputMode="tel" icon="phone" optional value={values.phone} onChange={(e) => set('phone', e.target.value)} error={errors['phone']} hint="Il sert à te joindre pour tes deals ; il n’est jamais affiché à d’autres stackers." />
      </fieldset>
      <fieldset className="form-group">
        <legend className="eyebrow">Zone de prospection</legend>
        <SelectField label="Département" name="department" optional placeholder="Choisis ton département" options={DEPARTMENTS.map(([code, name]) => [code, `${code} · ${name}`] as const)} value={values.department} onChange={(e) => set('department', e.target.value)} error={errors['department']} />
        <TextField label="Ville" name="city" autoComplete="address-level2" icon="map-pin" optional value={values.city} onChange={(e) => set('city', e.target.value)} error={errors['city']} maxLength={80} />
      </fieldset>
      <fieldset className="form-group">
        <legend className="eyebrow">Statut</legend>
        <SelectField label="Statut juridique déclaré" name="legal_status" optional placeholder="Non renseigné" options={LEGAL_STATUSES} value={values.legal_status} onChange={(e) => set('legal_status', e.target.value)} error={errors['legal_status']} />
        {companyStatus || values.siret !== '' ? (
          <TextField label="SIRET" name="siret" inputMode="numeric" autoComplete="off" optional value={values.siret} onChange={(e) => set('siret', e.target.value)} error={errors['siret']} hint="14 chiffres, sur ton avis de situation Insee ou annuaire-entreprises.data.gouv.fr." maxLength={17} />
        ) : null}
        <SelectField label="Objectif" name="goal" optional placeholder="Non renseigné" options={GOALS.map(([code, label]) => [code, label] as const)} value={values.goal} onChange={(e) => set('goal', e.target.value)} error={errors['goal']} />
      </fieldset>
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      {saved ? <FormAlert tone="success">Modifications enregistrées.</FormAlert> : null}
      <SubmitButton loading={update.isPending}>Enregistrer</SubmitButton>
    </form>
  );
}

function DataSection(): ReactElement {
  const { backend } = useSignedIn();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onExport() {
    setLoading(true);
    setError(null);
    try {
      const data = await exportMyData(backend);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stacker-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card card-hero" aria-labelledby="data-title">
      <h2 id="data-title" className="h2">
        Mes données
      </h2>
      <p className="text-2 mt-2">Télécharge une copie de tout ce que Stacker conserve sur toi (compte, profil, consentements, liste d’attente), au format JSON.</p>
      {error ? (
        <div className="mt-4">
          <FormAlert>{error}</FormAlert>
        </div>
      ) : null}
      <button type="button" className={`btn btn-secondary btn-block mt-5${loading ? ' is-loading' : ''}`} disabled={loading} onClick={() => void onExport()}>
        <Icon name="arrow-down-left" />
        Exporter mes données
      </button>
    </section>
  );
}

function AccountSection(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <section className="card card-hero" aria-labelledby="account-title">
      <h2 id="account-title" className="h2">
        Compte
      </h2>
      <div className="mt-5 grid gap-3">
        <Link className="btn btn-secondary btn-block" to={PATHS.logout}>
          <Icon name="logout" />
          Se déconnecter
        </Link>
        <button type="button" className="btn btn-danger btn-block" onClick={() => setOpen(true)}>
          Supprimer mon compte
        </button>
      </div>
      {open ? <DeleteDialog onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

function DeleteDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { backend, email } = useSignedIn();
  const navigate = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const captcha = useCaptcha('reauth');
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setFormError(null);
    const errs: Record<string, string> = {};
    if (confirm.trim() !== DELETE_CONFIRMATION) errs['confirm'] = `Tape ${DELETE_CONFIRMATION} en majuscules pour confirmer.`;
    if (password === '') errs['password'] = 'Indique ton mot de passe.';
    if (Object.keys(errs).length > 0) {
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
    // Réauthentification : le serveur exige une connexion de moins de 10 minutes.
    const { error } = await backend.auth.signInWithPassword({ email: email ?? '', password, options: token ? { captchaToken: token } : {} });
    captcha.reset();
    if (error) {
      setLoading(false);
      const outcome = authErrorOutcome(error, 'login');
      if (outcome.kind === 'message' && outcome.field === 'password') setErrors({ password: 'Mot de passe incorrect.' });
      else if (outcome.kind === 'message') setFormError(outcome.message);
      return;
    }
    try {
      await deleteAccount(backend);
    } catch (e) {
      setLoading(false);
      setFormError(e instanceof ApiError ? apiErrorMessage(e) : apiErrorMessage(null));
      return;
    }
    void navigate(PATHS.deleted, { replace: true });
    await backend.auth.signOut({ scope: 'local' });
  }

  return (
    <dialog ref={ref} className="app-dialog" aria-labelledby="delete-title" onClose={onClose}>
      <form ref={formRef} noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-5">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="delete-title" className="sheet-title">
          Supprimer ton compte ?
        </h2>
        <p className="text-2">
          Ton profil, tes consentements et ton inscription à la liste d’attente seront <strong className="text-ink">définitivement effacés</strong>. Cette action est irréversible.
          Pense à exporter tes données avant.
        </p>
        <TextField label={`Tape ${DELETE_CONFIRMATION} pour confirmer`} name="confirm" autoComplete="off" autoCapitalize="characters" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors['confirm']} />
        <PasswordField label="Ton mot de passe" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors['password']} />
        {captcha.element}
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <div className="sheet-actions">
          <SubmitButton loading={loading} variant="danger-solid">
            Supprimer définitivement
          </SubmitButton>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => ref.current?.close()}>
            Annuler
          </button>
        </div>
      </form>
    </dialog>
  );
}

