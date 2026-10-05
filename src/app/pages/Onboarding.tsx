import { useEffect, useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { GOALS, onboardingSchema, type Goal } from '@shared/account';
import { DEPARTMENTS } from '@shared/waitlist';
import { Icon } from '../../components/Icon';
import { LogoLockup } from '../../components/Logo';
import { Ransom } from '../../components/Ransom';
import { AVAILABILITY_STEPS } from '../../components/Sections';
import { FieldError, FormAlert, SelectField, SubmitButton, TextField } from '../components/Form';
import { LoadError, Splash, usePageTitle } from '../components/Layouts';
import { LevelPill } from '../components/Ui';
import { apiErrorMessage } from '../lib/api';
import { useCompleteOnboarding, useProfile, useTiers } from '../lib/queries';
import { PATHS } from '../paths';

const STEPS = ['Prénom', 'Zone', 'Objectif', 'Niveaux'] as const;

export function OnboardingPage(): ReactElement {
  usePageTitle('Bienvenue');
  const profile = useProfile();
  if (profile.isPending) return <Splash />;
  if (profile.isError) return <LoadError onRetry={() => void profile.refetch()} />;
  if (profile.data.onboarding_completed_at) return <Navigate to={PATHS.home} replace />;
  return <OnboardingFlow initialFirstName={profile.data.first_name ?? ''} initialDepartment={profile.data.department ?? ''} />;
}

function OnboardingFlow({ initialFirstName, initialDepartment }: { initialFirstName: string; initialDepartment: string }): ReactElement {
  const navigate = useNavigate();
  const tiers = useTiers();
  const complete = useCompleteOnboarding();
  const [step, setStep] = useState(0);
  const [firstName, setFirstName] = useState(initialFirstName);
  const [department, setDepartment] = useState(initialDepartment);
  const [goal, setGoal] = useState<Goal | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const fieldFor = ['firstName', 'department', 'goal'] as const;

  function next(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFormError(null);
    if (step < 3) {
      const parsed = onboardingSchema.safeParse({ firstName, department, goal });
      const issue = parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === fieldFor[step]);
      if (issue) {
        setError(issue.message);
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"], input[name="goal"]')?.focus());
        return;
      }
      setStep(step + 1);
      return;
    }
    const parsed = onboardingSchema.safeParse({ firstName, department, goal });
    if (!parsed.success) {
      setFormError('Une étape est incomplète. Reviens en arrière pour la compléter.');
      return;
    }
    complete.mutate(parsed.data, {
      onSuccess: () => void navigate(PATHS.home, { replace: true }),
      onError: (e) => setFormError(apiErrorMessage(e)),
    });
  }

  const titles = ['Comment veux-tu qu’on t’appelle ?', 'Où vas-tu prospecter ?', 'Quel est ton objectif ?', 'Tes niveaux et tes commissions'];

  return (
    <div className="onboarding">
      <header className="onboarding-top">
        <LogoLockup size={28} />
        <span className="text-small">
          Étape {step + 1} sur {STEPS.length}
        </span>
      </header>
      <ol className="onboarding-steps" aria-label="Progression">
        {STEPS.map((label, i) => (
          <li key={label} className={i <= step ? 'is-done' : undefined} aria-current={i === step ? 'step' : undefined}>
            <span className="sr-only">
              {label}
              {i < step ? ' : terminé' : i === step ? ' : en cours' : ''}
            </span>
          </li>
        ))}
      </ol>

      <main id="contenu" className="onboarding-main">
        <form className="onboarding-form" noValidate onSubmit={next} aria-labelledby="onboarding-title">
          {step === 0 ? (
            <p className="onboarding-ransom" aria-hidden="true">
              <Ransom text="Bienvenue" className="ransom-sm justify-start" animated />
            </p>
          ) : null}
          <h1 id="onboarding-title" ref={headingRef} tabIndex={-1} className="h1 page-heading">
            {titles[step]}
          </h1>

          {step === 0 ? (
            <>
              <p className="lead mt-2">Ton compte est prêt. Encore trois questions, puis on t’explique comment fonctionnent tes commissions.</p>
              <div className="mt-8">
                <TextField label="Prénom" name="firstName" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} error={error ?? undefined} maxLength={50} required />
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <p className="lead mt-2">L’app te proposera des entreprises de ce département. Tu pourras préciser ta ville dans ton profil.</p>
              <div className="mt-8">
                <SelectField label="Département" name="department" placeholder="Choisis ton département" options={DEPARTMENTS.map(([code, name]) => [code, `${code} · ${name}`] as const)} value={department} onChange={(e) => setDepartment(e.target.value)} error={error ?? undefined} required />
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <fieldset className="mt-6 grid gap-3" aria-describedby={error ? 'goal-error' : undefined}>
              <legend className="lead">Aucune réponse n’engage à rien : elle nous aide à adapter tes conseils.</legend>
              {GOALS.map(([code, label, text]) => (
                <label key={code} className={`choice${goal === code ? ' is-selected' : ''}`}>
                  <input type="radio" name="goal" value={code} checked={goal === code} onChange={() => setGoal(code)} />
                  <span className="choice-body">
                    <span className="choice-title">{label}</span>
                    <span className="choice-text">{text}</span>
                  </span>
                  <span className="choice-check" aria-hidden="true">
                    <Icon name="check" size={16} />
                  </span>
                </label>
              ))}
              <FieldError id="goal-error" message={error ?? undefined} />
            </fieldset>
          ) : null}

          {step === 3 ? (
            <div className="mt-6 grid gap-5">
              <p className="lead">Ta commission est un pourcentage du prix payé par chaque client que tu apportes, tant qu’il reste abonné. Ton taux dépend de ton niveau.</p>
              <section className="card" aria-labelledby="tiers-title">
                <h2 id="tiers-title" className="h3">
                  4 niveaux, de 15 à 25 %
                </h2>
                {tiers.isPending ? <p className="text-small mt-3">Chargement des niveaux…</p> : null}
                {tiers.isError ? <p className="text-small mt-3">Les niveaux n’ont pas pu être chargés.</p> : null}
                {tiers.data ? (
                  <>
                    <ul className="tier-rows mt-4">
                      {tiers.data.map((t) => (
                        <li key={t.code}>
                          <LevelPill tier={t} />
                          <span className="text-small">
                            {t.max_active_clients === null ? `${String(t.min_active_clients)} clients actifs et plus` : `${String(t.min_active_clients)} à ${String(t.max_active_clients)} clients actifs`}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {tiers.data.some((t) => t.criteria_provisional) ? (
                      <p className="form-note mt-4">
                        <Icon name="info" />
                        <span>Seuils provisoires : ils seront confirmés dans ton contrat d’apporteur d’affaires avant l’ouverture des ventes.</span>
                      </p>
                    ) : null}
                  </>
                ) : null}
              </section>
              <section className="card" aria-labelledby="rules-title">
                <h2 id="rules-title" className="h3">
                  Quand ta commission est disponible
                </h2>
                <ol className="timeline mt-5">
                  {AVAILABILITY_STEPS.map((s, i) => (
                    <li key={s.title}>
                      <span className="timeline-dot" aria-hidden="true">
                        {i + 1}
                      </span>
                      <div>
                        <h3 className="font-semibold text-ink">{s.title}</h3>
                        <p className="text-2 mt-1 text-sm">{s.text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
              <p className="form-note">
                <Icon name="info" />
                <span>Aucun montant de gain n’est promis : tes commissions dépendent uniquement des clients que tu apportes et qui paient.</span>
              </p>
            </div>
          ) : null}

          {formError ? (
            <div className="mt-5">
              <FormAlert>{formError}</FormAlert>
            </div>
          ) : null}

          <div className="onboarding-actions">
            {step > 0 ? (
              <button type="button" className="btn btn-secondary" onClick={() => {
                  setError(null);
                  setStep(step - 1);
                }}>
                <Icon name="arrow-left" />
                Retour
              </button>
            ) : null}
            <SubmitButton loading={complete.isPending} variant={step === 3 ? 'accent' : 'primary'}>
              {step === 3 ? 'C’est parti' : 'Continuer'}
              {step === 3 ? null : <Icon name="arrow-right" />}
            </SubmitButton>
          </div>
        </form>
      </main>
    </div>
  );
}
