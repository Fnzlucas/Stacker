import { useCallback, useEffect, useId, useRef, useState, type ReactElement, type RefObject, type SyntheticEvent } from 'react';
import {
  DEPARTMENTS,
  fieldErrors,
  normalizeReferralCode,
  waitlistFieldsSchema,
  type WaitlistFieldsInput,
  type WaitlistJoinResponse,
} from '@shared/waitlist';
import { Icon } from '../components/Icon';
import { Ransom } from '../components/Ransom';
import { Turnstile, type TurnstileHandle } from '../components/Turnstile';
import { ENTITY, LAUNCH_OFFER, PRODUCT } from '../config/site';
import { joinErrorMessage, joinWaitlist } from '../lib/api';
import { isSupabaseConfigured, publicEnv } from '../lib/env';
import { formatInteger, positionMessage } from '../lib/format';
import { useClientValue } from './hooks';

type Field = 'firstName' | 'email' | 'department' | 'ageConfirmed' | 'termsAccepted';
type Errors = Partial<Record<keyof WaitlistFieldsInput, string>>;

interface Values {
  firstName: string;
  email: string;
  department: string;
  ageConfirmed: boolean;
  termsAccepted: boolean;
  marketingOptIn: boolean;
}

const EMPTY: Values = { firstName: '', email: '', department: '', ageConfirmed: false, termsAccepted: false, marketingOptIn: false };
const FIELD_ORDER: readonly Field[] = ['firstName', 'email', 'department', 'ageConfirmed', 'termsAccepted'];

export const NOT_CONFIGURED_MESSAGE = 'Les inscriptions à la liste d’attente ne sont pas encore ouvertes sur ce site. Reviens un peu plus tard.';

export function WaitlistForm({ context }: { context: 'landing' | 'page' }): ReactElement {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const configured = isSupabaseConfigured(publicEnv);
  const captchaEnabled = publicEnv.turnstileSiteKey !== null;

  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);
  const [result, setResult] = useState<WaitlistJoinResponse | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  // Le code de parrainage vient de l'URL (?ref=). Lu après l'hydratation : le HTML pré-rendu ne le connaît pas.
  const search = useClientValue(() => window.location.search, '');
  const referral = normalizeReferralCode(new URLSearchParams(search).get('ref'));

  useEffect(() => {
    if (result) successRef.current?.focus();
  }, [result]);

  const onToken = useCallback((value: string | null) => {
    setToken(value);
    if (value) setCaptchaUnavailable(false);
  }, []);
  const onCaptchaError = useCallback(() => setCaptchaUnavailable(true), []);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const focusFirstError = (errs: Errors) => {
    const first = FIELD_ORDER.find((f) => errs[f]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  };

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !configured) return;
    setFormError(null);

    const parsed = waitlistFieldsSchema.safeParse({ ...values, referralCode: referral });
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error);
      setErrors(errs);
      focusFirstError(errs);
      return;
    }
    if (captchaEnabled && !token) {
      setFormError(
        captchaUnavailable
          ? 'La vérification anti-robot n’a pas pu se charger. Désactive un éventuel bloqueur pour ce site, puis réessaie.'
          : 'La vérification anti-robot est en cours. Patiente une seconde puis réessaie.',
      );
      return;
    }

    setSubmitting(true);
    const res = await joinWaitlist(publicEnv, { ...parsed.data, ...(token ? { turnstileToken: token } : {}) });
    setSubmitting(false);

    if (res.ok) {
      setResult(res.data);
      return;
    }
    // Un jeton Turnstile ne sert qu'une fois : on en redemande un.
    turnstile.current?.reset();
    if (res.fields && Object.keys(res.fields).length > 0) {
      setErrors(res.fields);
      focusFirstError(res.fields);
    }
    setFormError(joinErrorMessage(res.error));
  }

  if (result) return <WaitlistSuccess result={result} headingRef={successRef} />;

  const err = (f: Field) => errors[f];
  const describedBy = (f: Field, hint?: string) => (err(f) ? id(`${f}-error`) : hint);
  const errorText = (field: Field) =>
    err(field) ? (
      <span className="field-error" id={id(`${field}-error`)}>
        <Icon name="alert" />
        {err(field)}
      </span>
    ) : null;

  const headingId = id('title');

  return (
    <form
      ref={formRef}
      className="card card-hero scroll-anchor grid gap-5"
      noValidate
      aria-labelledby={headingId}
      data-testid="waitlist-form"
      onSubmit={(e) => {
        void onSubmit(e);
      }}
    >
      <div>
        <h2 id={headingId} className="h2">
          {context === 'landing' ? 'Réserve ta place' : 'Inscription à la liste d’attente'}
        </h2>
        <p className="text-small mt-1">Gratuit et sans engagement. Tous les champs sont obligatoires, sauf mention contraire.</p>
      </div>

      {configured ? null : (
        <div className="form-alert form-alert-info" role="status">
          <Icon name="info" />
          <span>{NOT_CONFIGURED_MESSAGE}</span>
        </div>
      )}

      <fieldset className="form-fieldset" disabled={!configured}>
        <legend className="sr-only">Tes informations</legend>
        <div className={`field${err('firstName') ? ' is-error' : ''}`}>
          <label className="field-label" htmlFor={id('firstName')}>
            Prénom
          </label>
          <input
            className="input"
            id={id('firstName')}
            name="firstName"
            type="text"
            autoComplete="given-name"
            maxLength={50}
            required
            aria-invalid={err('firstName') ? true : undefined}
            aria-describedby={describedBy('firstName')}
            value={values.firstName}
            onChange={(e) => set('firstName', e.target.value)}
          />
          {errorText('firstName')}
        </div>

        <div className={`field${err('email') ? ' is-error' : ''}`}>
          <label className="field-label" htmlFor={id('email')}>
            Adresse email
          </label>
          <div className="input-wrap">
            <Icon name="mail" />
            <input
              className="input"
              id={id('email')}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              maxLength={254}
              required
              aria-invalid={err('email') ? true : undefined}
              aria-describedby={describedBy('email')}
              value={values.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </div>
          {errorText('email')}
        </div>

        <div className={`field${err('department') ? ' is-error' : ''}`}>
          <label className="field-label" htmlFor={id('department')}>
            Département <span className="font-normal text-ink-2">(facultatif)</span>
          </label>
          <div className="select-wrap">
            <select
              className="input"
              id={id('department')}
              name="department"
              aria-invalid={err('department') ? true : undefined}
              aria-describedby={describedBy('department', id('department-hint'))}
              value={values.department}
              onChange={(e) => set('department', e.target.value)}
            >
              <option value="">Choisir un département</option>
              {DEPARTMENTS.map(([code, name]) => (
                <option key={code} value={code}>
                  {code} · {name}
                </option>
              ))}
            </select>
          </div>
          {err('department') ? (
            errorText('department')
          ) : (
            <span className="field-hint" id={id('department-hint')}>
              Pour te prévenir quand Stacker ouvre dans ta zone.
            </span>
          )}
        </div>

        <div className="grid gap-1">
          <label className={`check${err('ageConfirmed') ? ' is-error' : ''}`}>
            <input
              type="checkbox"
              name="ageConfirmed"
              required
              aria-invalid={err('ageConfirmed') ? true : undefined}
              aria-describedby={describedBy('ageConfirmed')}
              checked={values.ageConfirmed}
              onChange={(e) => set('ageConfirmed', e.target.checked)}
            />
            <span>Je déclare avoir 18 ans ou plus.</span>
          </label>
          {errorText('ageConfirmed')}

          <label className={`check${err('termsAccepted') ? ' is-error' : ''}`}>
            <input
              type="checkbox"
              name="termsAccepted"
              required
              aria-invalid={err('termsAccepted') ? true : undefined}
              aria-describedby={describedBy('termsAccepted')}
              checked={values.termsAccepted}
              onChange={(e) => set('termsAccepted', e.target.checked)}
            />
            <span>
              J’accepte les <a href="/cgu">conditions d’utilisation</a> et j’ai pris connaissance de la{' '}
              <a href="/confidentialite">politique de confidentialité</a>.
            </span>
          </label>
          {errorText('termsAccepted')}

          <label className="check">
            <input type="checkbox" name="marketingOptIn" checked={values.marketingOptIn} onChange={(e) => set('marketingOptIn', e.target.checked)} />
            <span>
              <span className="font-semibold">Facultatif :</span> j’accepte de recevoir par email les actualités de Stacker. Désinscription
              possible à tout moment.
            </span>
          </label>
        </div>

        {configured && captchaEnabled && publicEnv.turnstileSiteKey ? (
          <Turnstile ref={turnstile} siteKey={publicEnv.turnstileSiteKey} action="waitlist" onToken={onToken} onError={onCaptchaError} />
        ) : null}

        {formError ? (
          <div className="form-alert" role="alert">
            <Icon name="alert" />
            <span>{formError}</span>
          </div>
        ) : null}

        <button className={`btn btn-primary btn-lg btn-block${submitting ? ' is-loading' : ''}`} type="submit" aria-busy={submitting || undefined}>
          Rejoindre la liste d’attente
          <Icon name="arrow-right" />
        </button>
      </fieldset>

      <p className="form-note">
        <Icon name="lock" />
        <span>
          Ton prénom, ton email et ton département servent uniquement à gérer ta place sur la liste d’attente et à te prévenir de l’ouverture du{' '}
          {PRODUCT.launchDateLabel}. Responsable du traitement : {ENTITY.legalName}, éditeur de Stacker. En savoir plus et exercer tes droits :{' '}
          <a href="/confidentialite">politique de confidentialité</a>.{referral ? ` Code de parrainage pris en compte : ${referral}.` : ''}
        </span>
      </p>
    </form>
  );
}

function WaitlistSuccess({
  result,
  headingRef,
}: {
  result: WaitlistJoinResponse;
  headingRef: RefObject<HTMLHeadingElement | null>;
}): ReactElement {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'error'>('idle');
  const canShare = useClientValue(() => typeof navigator.share === 'function', false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.referralUrl);
      setCopied('ok');
    } catch {
      setCopied('error');
    }
  };

  const share = async () => {
    try {
      await navigator.share({
        title: 'Stacker',
        text: 'Je me suis inscrit sur la liste d’attente de Stacker. Inscris-toi avec mon lien :',
        url: result.referralUrl,
      });
    } catch {
      /* partage annulé par la personne : rien à faire */
    }
  };

  return (
    <section className="card card-hero scroll-anchor text-center" aria-labelledby="waitlist-success-title" data-testid="waitlist-success">
      <span className="eyebrow">Inscription confirmée</span>
      <h2 id="waitlist-success-title" ref={headingRef} tabIndex={-1} className="scroll-anchor mt-4 outline-none">
        <span className="sr-only">Tu es numéro {result.position} sur la liste d’attente</span>
        <span aria-hidden="true" className="block">
          <span className="text-small mb-2 block">Ta position</span>
          <Ransom text={formatInteger(result.position)} className="ransom-fluid" animated />
        </span>
      </h2>
      <p className="lead mx-auto mt-5 max-w-md">{positionMessage(result.position, LAUNCH_OFFER.seats)}</p>
      <p className="text-small mx-auto mt-3 max-w-md">Un email de confirmation vient de partir : pense à vérifier tes indésirables.</p>

      <div className="mt-6 text-left">
        <p className="field-label">
          Ton lien de parrainage
        </p>
        <div className="copy-field mt-2">
          <code>{result.referralUrl}</code>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => void copy()}>
            <Icon name="check" />
            Copier
          </button>
        </div>
        <p className="text-small mt-2" role="status" aria-live="polite">
          {copied === 'ok' ? 'Lien copié.' : copied === 'error' ? 'Copie impossible : sélectionne le lien pour le copier.' : ''}
        </p>
        <p className="text-small mt-1">Il permet de savoir qui t’a fait connaître Stacker. Il ne donne droit à aucune rémunération.</p>
      </div>

      {canShare ? (
        <button className="btn btn-primary btn-block mt-6" type="button" onClick={() => void share()}>
          <Icon name="send" />
          Partager mon lien
        </button>
      ) : null}
    </section>
  );
}
