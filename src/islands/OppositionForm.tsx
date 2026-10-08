import { useEffect, useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { Icon } from '../components/Icon';
import { Turnstile, type TurnstileHandle } from '../components/Turnstile';
import { registerOpposition, type OppositionResult } from '../lib/api';
import { isSupabaseConfigured, publicEnv } from '../lib/env';
import { useClientValue } from './hooks';

const TOKEN_RE = /^[0-9a-f]{48}$/;

const MESSAGES: Record<Exclude<OppositionResult, { ok: true }>['error'], string> = {
  not_configured: 'Le service n’est pas encore ouvert sur ce site. Écrivez-nous depuis la page Contact : nous traiterons votre demande à la main.',
  network: 'Connexion impossible. Vérifiez votre connexion internet et réessayez.',
  invalid: 'Indiquez un numéro SIREN à 9 chiffres et/ou une adresse email valide.',
  captcha: 'La vérification anti-robot a échoué. Réessayez.',
  rate_limited: 'Trop de demandes depuis cette connexion. Réessayez dans une heure, ou écrivez-nous depuis la page Contact.',
  server: 'Le service est momentanément indisponible. Réessayez dans un instant, ou écrivez-nous depuis la page Contact.',
};

/**
 * Opposition à la prospection : traite automatiquement le lien reçu par email
 * (?t=…), sinon propose un formulaire (SIREN et/ou email). Le titre de la page
 * est porté par l'îlot pour refléter l'état réel de la demande.
 */
export function OppositionForm(): ReactElement {
  const search = useClientValue(() => window.location.search, '');
  const token = new URLSearchParams(search).get('t');
  const validToken = token && TOKEN_RE.test(token) ? token : null;
  const configured = isSupabaseConfigured(publicEnv);
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [siren, setSiren] = useState('');
  const [email, setEmail] = useState('');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!validToken || started.current) return;
    started.current = true;
    setState('sending');
    void registerOpposition(publicEnv, { token: validToken }).then((res) => {
      if (res.ok) setState('done');
      else {
        setState('idle');
        setError(MESSAGES[res.error]);
      }
    });
  }, [validToken]);

  useEffect(() => {
    if (state === 'done') titleRef.current?.focus();
  }, [state]);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'sending') return;
    const s = siren.replace(/\s/g, '');
    const m = email.trim().toLowerCase();
    if ((!s && !m) || (s && !/^\d{9}$/.test(s)) || (m && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(m))) {
      setError(MESSAGES.invalid);
      return;
    }
    if (publicEnv.turnstileSiteKey && !captcha) {
      setError('Patientez une seconde : la vérification anti-robot se termine.');
      return;
    }
    setError(null);
    setState('sending');
    const res = await registerOpposition(publicEnv, { ...(s ? { siren: s } : {}), ...(m ? { email: m } : {}), turnstileToken: captcha ?? '' });
    turnstile.current?.reset();
    setCaptcha(null);
    if (res.ok) setState('done');
    else {
      setState('idle');
      setError(MESSAGES[res.error]);
    }
  }

  if (state === 'done') {
    return (
      <div className="card card-hero opposition-card" role="status">
        <span className="opposition-ok" aria-hidden="true">
          <Icon name="check" />
        </span>
        <h1 ref={titleRef} tabIndex={-1} className="display opposition-title">
          C’est noté
        </h1>
        <p className="lead mt-3">Votre demande est enregistrée : plus aucun apporteur d’affaires ne vous contactera de la part de Stacker. Vous n’avez rien d’autre à faire.</p>
      </div>
    );
  }

  if (validToken && state === 'sending') {
    return (
      <div className="card card-hero opposition-card" aria-busy="true">
        <h1 className="display opposition-title">Ne plus être contacté</h1>
        <p className="lead mt-3">Enregistrement de votre demande…</p>
      </div>
    );
  }

  return (
    <form className="card card-hero opposition-card" noValidate onSubmit={(e) => void onSubmit(e)} aria-labelledby="opposition-title">
      <h1 id="opposition-title" className="display opposition-title">
        Ne plus être contacté par Stacker
      </h1>
      <p className="lead mt-3">Indiquez le numéro SIREN de votre entreprise et/ou l’adresse email concernée. Plus aucun apporteur d’affaires ne vous contactera de la part de Stacker.</p>
      <div className="grid gap-4 mt-6">
        <div className="field">
          <label className="field-label" htmlFor="opposition-siren">
            Numéro SIREN <span className="field-optional">(9 chiffres)</span>
          </label>
          <div className="input-wrap no-icon">
            <input id="opposition-siren" className="input" inputMode="numeric" autoComplete="off" maxLength={11} value={siren} onChange={(e) => setSiren(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="opposition-email">
            Adresse email
          </label>
          <div className="input-wrap no-icon">
            <input id="opposition-email" className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        {configured && publicEnv.turnstileSiteKey ? (
          <Turnstile ref={turnstile} siteKey={publicEnv.turnstileSiteKey} action="opposition" onToken={setCaptcha} onError={() => setCaptcha(null)} />
        ) : null}
        {error ? (
          <div className="form-alert" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        ) : null}
        <button type="submit" className={`btn btn-primary btn-lg btn-block${state === 'sending' ? ' is-loading' : ''}`} aria-busy={state === 'sending' || undefined}>
          Ne plus être contacté
        </button>
      </div>
    </form>
  );
}
