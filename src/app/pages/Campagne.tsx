import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { DEPARTMENTS } from '@shared/waitlist';
import { PRESETS, PRESET_KEYS, type PresetKey } from '@shared/prospects';
import { Icon } from '../../components/Icon';
import { useSignedIn } from '../auth/AuthProvider';
import { FormAlert, SelectField } from '../components/Form';
import { ProgressBar } from '../components/Ui';
import { useProfile } from '../lib/queries';
import { useCampaign, useCampaignStatus, useDisconnectMailbox, useEmailTemplates, useStartCampaign } from '../lib/prospectQueries';
import { connectMailbox, prospectErrorMessage, type CampaignState } from '../lib/prospects';
import { formatInteger } from '../../lib/format';

const VOLUMES = [50, 100, 200] as const;
const PROVIDER_LABEL = { gmail: 'Gmail', outlook: 'Outlook' } as const;
const departmentName = (code: string) => DEPARTMENTS.find(([c]) => c === code)?.[1] ?? code;

/** Onglet « Campagne » : boîte mail connectée, puis une campagne qui écrit chaque jour, sans réservation à la main. */
export function CampaignTab({ rulesAccepted }: { rulesAccepted: boolean }): ReactElement {
  const state = useCampaign();
  if (state.isPending) {
    return (
      <div className="card card-hero" aria-busy="true">
        <span className="skeleton skeleton-title w-2/3" />
        <span className="skeleton skeleton-text mt-4 w-full" />
      </div>
    );
  }
  if (state.isError) return <FormAlert>Impossible de charger ta campagne. Vérifie ta connexion puis réessaie.</FormAlert>;
  const s = state.data;
  return (
    <div className="camp">
      <MailboxCard s={s} />
      {s.campaign ? <RunningCard s={s} campaign={s.campaign} /> : <StartCard s={s} rulesAccepted={rulesAccepted} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boîte mail
// ---------------------------------------------------------------------------

function MailboxCard({ s }: { s: CampaignState }): ReactElement {
  const { backend } = useSignedIn();
  const disconnect = useDisconnectMailbox();
  const connect = useMutation({
    mutationFn: (provider: 'gmail' | 'outlook') => connectMailbox(backend, provider),
    onSuccess: (url) => window.location.assign(url),
  });
  const m = s.mailbox;

  return (
    <section className="card card-hero camp-card" aria-labelledby="mailbox-title">
      <div className="camp-step">
        <span className={`camp-step-num${m?.status === 'active' ? ' is-done' : ''}`} aria-hidden="true">
          {m?.status === 'active' ? <Icon name="check" /> : '1'}
        </span>
        <h2 id="mailbox-title" className="h3">
          Ta boîte mail
        </h2>
      </div>
      {m ? (
        <>
          <p className="camp-mailbox">
            <span className="chip chip-dark">{PROVIDER_LABEL[m.provider]}</span>
            <b>{m.email}</b>
          </p>
          {m.status !== 'active' ? (
            <FormAlert>Ta boîte a refusé l’envoi (accès retiré ou expiré). Reconnecte-la : ta campagne reprendra toute seule.</FormAlert>
          ) : (
            <p className="text-2 text-sm">Les emails partent depuis cette adresse et les réponses arrivent directement dans ta boîte.</p>
          )}
          <div className="camp-row">
            {m.status !== 'active' ? (
              <button type="button" className="btn btn-primary" onClick={() => connect.mutate(m.provider)} disabled={connect.isPending}>
                Reconnecter {PROVIDER_LABEL[m.provider]}
              </button>
            ) : null}
            <button type="button" className={`btn btn-ghost btn-sm${disconnect.isPending ? ' is-loading' : ''}`} onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
              Déconnecter
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-2 text-sm">
            Connecte ta boîte une seule fois : Stacker pourra <b className="text-ink">seulement envoyer</b> tes emails de prospection (il ne lit jamais tes emails). Tu peux couper l’accès à tout moment.
          </p>
          <div className="camp-providers">
            <button type="button" className={`btn btn-secondary btn-lg${connect.isPending && connect.variables === 'gmail' ? ' is-loading' : ''}`} onClick={() => connect.mutate('gmail')} disabled={connect.isPending}>
              Connecter Gmail
            </button>
            <button type="button" className={`btn btn-secondary btn-lg${connect.isPending && connect.variables === 'outlook' ? ' is-loading' : ''}`} onClick={() => connect.mutate('outlook')} disabled={connect.isPending}>
              Connecter Outlook
            </button>
          </div>
        </>
      )}
      {connect.isError ? <FormAlert>{prospectErrorMessage(connect.error)}</FormAlert> : null}
      {disconnect.isError ? <FormAlert>{prospectErrorMessage(disconnect.error)}</FormAlert> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lancer
// ---------------------------------------------------------------------------

function StartCard({ s, rulesAccepted }: { s: CampaignState; rulesAccepted: boolean }): ReactElement {
  const profile = useProfile();
  const templates = useEmailTemplates();
  const start = useStartCampaign();
  const [department, setDepartment] = useState(profile.data?.department ?? '');
  const [preset, setPreset] = useState<PresetKey | null>(null);
  const [volume, setVolume] = useState<number>(Math.min(200, s.max_per_day));
  const [template, setTemplate] = useState('decouverte');
  const [error, setError] = useState<string | null>(null);
  const ready = s.mailbox?.status === 'active';
  const noLastName = !profile.data?.last_name;

  function launch() {
    if (!department) {
      setError('Choisis ton département.');
      return;
    }
    if (!preset) {
      setError('Choisis un secteur.');
      return;
    }
    setError(null);
    start.mutate({ department, preset, dailyTarget: volume, templateKey: template });
  }

  return (
    <section className="card card-hero camp-card" aria-labelledby="start-title">
      <div className="camp-step">
        <span className="camp-step-num" aria-hidden="true">
          2
        </span>
        <h2 id="start-title" className="h3">
          Ta campagne
        </h2>
      </div>
      <p className="text-2 text-sm">Chaque jour, l’app choisit des entreprises de ta zone qui publient une adresse email, et leur écrit de ta part. Tu n’as plus qu’à rappeler celles qui répondent.</p>
      <SelectField label="Département" options={DEPARTMENTS.map(([c, n]) => [c, `${c} · ${n}`] as const)} placeholder="Choisis un département" value={department} onChange={(e) => setDepartment(e.target.value)} />
      <fieldset className="pros-fieldset">
        <legend className="field-label">Secteur</legend>
        <div className="pros-chips" role="group" aria-label="Secteur">
          {PRESET_KEYS.map((k) => (
            <button key={k} type="button" className="chip chip-filter" aria-pressed={preset === k} onClick={() => setPreset(k)}>
              {PRESETS[k].label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="pros-fieldset">
        <legend className="field-label">Emails par jour</legend>
        <div className="segmented" role="group" aria-label="Emails par jour">
          {VOLUMES.filter((v) => v <= s.max_per_day).map((v) => (
            <button key={v} type="button" aria-pressed={volume === v} onClick={() => setVolume(v)}>
              {v}
            </button>
          ))}
        </div>
        <p className="text-small">Pour ne pas finir en spam, l’envoi démarre à 20 par jour et monte jusqu’à {volume} en 3 semaines. En semaine, de 8 h 30 à 18 h 30.</p>
      </fieldset>
      <SelectField label="Modèle d’email" options={(templates.data ?? []).map((t) => [t.key, t.label] as const)} placeholder="Choisis un modèle" value={template} onChange={(e) => setTemplate(e.target.value)} />
      {noLastName ? <FormAlert tone="info">Ajoute ton nom de famille dans ton profil : il signe chacun de tes emails.</FormAlert> : null}
      {!rulesAccepted ? <FormAlert tone="info">Accepte d’abord les 4 règles de la prospection (en haut de l’écran).</FormAlert> : null}
      {error ? <FormAlert>{error}</FormAlert> : null}
      {start.isError ? <FormAlert>{prospectErrorMessage(start.error)}</FormAlert> : null}
      <button type="button" className={`btn btn-primary btn-block btn-lg${start.isPending ? ' is-loading' : ''}`} disabled={!ready || !rulesAccepted || start.isPending} onClick={launch}>
        <Icon name="send" />
        Lancer la campagne
      </button>
      {!ready ? <p className="text-small camp-center">Connecte d’abord ta boîte mail (étape 1).</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// En cours
// ---------------------------------------------------------------------------

function RunningCard({ s, campaign: c }: { s: CampaignState; campaign: NonNullable<CampaignState['campaign']> }): ReactElement {
  const status = useCampaignStatus();
  const [confirmStop, setConfirmStop] = useState(false);
  const paused = c.status === 'paused';
  const blocked = s.mailbox?.status !== 'active';
  const percent = c.cap_today > 0 ? (c.sent_today / c.cap_today) * 100 : 0;

  return (
    <section className="balance camp-run" aria-labelledby="run-title">
      <div className="camp-run-head">
        <h2 id="run-title" className="balance-label">
          <Icon name="send" size={20} />
          {PRESETS[c.preset as PresetKey].label} · {departmentName(c.department)}
        </h2>
        <span className={`chip ${paused || blocked ? 'chip-orange' : 'chip-green'}`}>{blocked ? 'Boîte à reconnecter' : paused ? 'En pause' : 'En cours'}</span>
      </div>
      <p className="balance-amount num">
        {formatInteger(c.sent_today)}
        <span className="cents"> / {formatInteger(c.cap_today)} aujourd’hui</span>
      </p>
      <div className="mt-4">
        <ProgressBar percent={percent} tone="green" label="Emails envoyés aujourd’hui" />
      </div>
      <dl className="balance-split">
        <div>
          <dt>Envoyés au total</dt>
          <dd className="num">{formatInteger(c.sent_total)}</dd>
        </div>
        <div>
          <dt>Ont répondu</dt>
          <dd className="num">{formatInteger(c.replied)}</dd>
        </div>
        <div>
          <dt>En attente d’envoi</dt>
          <dd className="num">{formatInteger(c.queued)}</dd>
        </div>
        <div>
          <dt>Entreprises prêtes</dt>
          <dd className="num">{formatInteger(c.available)}</dd>
        </div>
      </dl>
      <p className="home-balance-text mt-4">
        {c.cap_today < c.daily_target
          ? `Montée progressive : ${String(c.cap_today)} emails par jour pour l’instant, jusqu’à ${String(c.daily_target)}. `
          : ''}
        {c.available < c.cap_today ? 'Le moteur cherche de nouvelles entreprises dans ta zone. ' : ''}
        Envoi en semaine de 8 h 30 à 18 h 30. Les réponses arrivent dans ta boîte : passe la fiche en « A répondu » quand quelqu’un te répond.
      </p>
      {status.isError ? <FormAlert>{prospectErrorMessage(status.error)}</FormAlert> : null}
      <div className="balance-actions">
        <button type="button" className={`btn btn-glass${status.isPending ? ' is-loading' : ''}`} disabled={status.isPending} onClick={() => status.mutate(paused ? 'active' : 'paused')}>
          {paused ? 'Reprendre' : 'Mettre en pause'}
        </button>
        <button type="button" className="btn btn-glass" onClick={() => setConfirmStop(true)}>
          Arrêter
        </button>
      </div>
      {confirmStop ? <StopDialog onClose={() => setConfirmStop(false)} onConfirm={() => status.mutateAsync('stopped')} /> : null}
    </section>
  );
}

function StopDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => Promise<unknown> }): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="app-dialog" aria-labelledby="stop-title" onClose={onClose}>
      <div className="grid gap-5">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="stop-title" className="sheet-title">
          Arrêter la campagne ?
        </h2>
        <p className="text-2">Les emails pas encore partis sont annulés. Les entreprises déjà contactées restent dans « Mes prospects ».</p>
        <div className="sheet-actions">
          <button
            type="button"
            className={`btn btn-danger-solid btn-block btn-lg${pending ? ' is-loading' : ''}`}
            disabled={pending}
            onClick={() => {
              setPending(true);
              void onConfirm().finally(() => ref.current?.close());
            }}
          >
            Arrêter la campagne
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => ref.current?.close()}>
            Annuler
          </button>
        </div>
      </div>
    </dialog>
  );
}
