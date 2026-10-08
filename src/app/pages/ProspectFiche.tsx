import { useEffect, useRef, useState, type ReactElement, type ReactNode, type SyntheticEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { formatPhone, normalizePhone } from '@shared/account';
import { EMPLOYEE_BAND_LABELS } from '@shared/prospects';
import { Icon } from '../../components/Icon';
import { useProfile } from '../lib/queries';
import { FormAlert, SelectField, TextField } from '../components/Form';
import { PageHeading, usePageTitle } from '../components/Layouts';
import { Toast } from '../components/Ui';
import { formatLongDate } from '../lib/dates';
import {
  useAddNote,
  useDeleteNote,
  useEmailTemplates,
  useExtend,
  useLogCall,
  useMarkSent,
  usePrepareEmail,
  useProspect,
  useRelease,
  useSetContact,
  useSetStatus,
} from '../lib/prospectQueries';
import {
  CALL_OUTCOMES,
  STATUS_CHIP,
  STATUS_LABELS,
  ProspectError,
  ageLabel,
  annuaireUrl,
  buildProspectMailto,
  copyText,
  dateInputToIso,
  daysLeft,
  displayName,
  eventLabel,
  gmailComposeUrl,
  googleSearchUrl,
  isoToDateInput,
  outlookComposeUrl,
  prospectErrorMessage,
  transitionAllowed,
  type CallOutcome,
  type PreparedEmail,
  type ProspectDetail,
  type ProspectStatus,
} from '../lib/prospects';
import { PATHS } from '../paths';

export function ProspectFichePage(): ReactElement {
  const { claimId = '' } = useParams();
  const detail = useProspect(claimId);
  usePageTitle(detail.data ? displayName(detail.data.company.name) : 'Prospect');
  const [toast, setToast] = useState<string | null>(null);

  return (
    <div className="app-container pros-fiche">
      <header className="appbar app-appbar pros-fiche-bar">
        <Link className="btn btn-ghost btn-sm" to={`${PATHS.prospects}?vue=mes`}>
          <Icon name="chevron-left" />
          Mes prospects
        </Link>
      </header>
      {detail.isPending ? (
        <div className="card card-hero" aria-busy="true">
          <span className="skeleton skeleton-title w-2/3" />
          <span className="skeleton skeleton-text mt-4 w-full" />
        </div>
      ) : detail.isError ? (
        <section className="card card-hero empty">
          <PageHeading className="h3">Prospect introuvable</PageHeading>
          <p>{detail.error instanceof ProspectError ? prospectErrorMessage(detail.error) : 'Impossible de charger ce prospect. Vérifie ta connexion puis réessaie.'}</p>
          <Link className="btn btn-primary" to={`${PATHS.prospects}?vue=mes`}>
            Retour à mes prospects
          </Link>
        </section>
      ) : (
        <Fiche d={detail.data} onToast={setToast} />
      )}
      {toast ? <Toast onClose={() => setToast(null)}>{toast}</Toast> : null}
    </div>
  );
}

function Fiche({ d, onToast }: { d: ProspectDetail; onToast: (m: string) => void }): ReactElement {
  const now = new Date();
  const c = d.company;
  const age = ageLabel(c.created_on, now);
  const left = daysLeft(d.claim.expires_at, now);
  const officers = c.officers
    .map((o) => o.denomination ?? [o.prenoms, o.nom].filter(Boolean).join(' '))
    .filter(Boolean)
    .slice(0, 3);
  const signed = d.claim.status === 'signe';

  return (
    <>
      <section className="card card-hero pros-head" aria-labelledby="fiche-title">
        <span className={`${STATUS_CHIP[d.claim.status]} pros-head-status`}>{STATUS_LABELS[d.claim.status]}</span>
        <PageHeading className="h2 pros-head-title">{displayName(c.name)}</PageHeading>
        <p className="text-2 mt-1">{[c.naf_label, c.city ? displayName(c.city) : null].filter(Boolean).join(' · ')}</p>
        <dl className="pros-facts">
          {c.address ? <Fact label="Adresse">{displayName(c.address)}</Fact> : null}
          {c.employee_band ? <Fact label="Effectif">{EMPLOYEE_BAND_LABELS[c.employee_band] ?? 'Non renseigné'}</Fact> : null}
          {age ? <Fact label="Ancienneté">{age}</Fact> : null}
          {officers.length ? <Fact label={c.is_sole_trader ? 'Entrepreneur' : 'Dirigeants'}>{officers.map(displayName).join(', ')}</Fact> : null}
          <Fact label="SIRET">
            <span className="num">{c.siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, '$1 $2 $3 $4')}</span>
          </Fact>
        </dl>
        <div className="pros-links">
          <a className="btn btn-secondary btn-sm" href={googleSearchUrl(c.name, c.city)} target="_blank" rel="noopener noreferrer">
            <Icon name="search" />
            Chercher sur Google
          </a>
          <a className="btn btn-ghost btn-sm" href={annuaireUrl(c.siren)} target="_blank" rel="noopener noreferrer">
            Fiche officielle
            <Icon name="arrow-up-right" />
          </a>
        </div>
        {signed ? (
          <p className="form-note mt-4">
            <Icon name="check-circle" />
            <span>Client signé : il reste rattaché à toi.</span>
          </p>
        ) : left !== null ? (
          <p className={`form-note mt-4${left <= 2 ? ' pros-expiring' : ''}`}>
            <Icon name="clock" />
            <span>
              Réservée pour toi jusqu’au {formatLongDate(d.claim.expires_at)} ({left === 0 ? 'expire aujourd’hui' : `encore ${String(left)} j`}). Chaque avancée prolonge la réservation.
            </span>
          </p>
        ) : null}
      </section>

      {!signed ? (
        <>
          <ContactCard key={`${d.claim.contact_phone ?? ''}|${d.claim.contact_email ?? ''}|${d.claim.contact_source ?? ''}`} d={d} onToast={onToast} />
          <CallCard d={d} onToast={onToast} />
          <EmailCard d={d} onToast={onToast} />
          <StatusCard key={`${d.claim.status}|${d.claim.next_action_at ?? ''}`} d={d} onToast={onToast} />
        </>
      ) : null}
      <NotesCard d={d} readOnly={signed} />
      <HistoryCard d={d} />
      {!signed ? <DangerZone d={d} onToast={onToast} /> : null}
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Card({ id, title, children, icon }: { id: string; title: string; children: ReactNode; icon: Parameters<typeof Icon>[0]['name'] }): ReactElement {
  return (
    <section className="card card-hero pros-card" aria-labelledby={id}>
      <h2 id={id} className="h3 pros-card-title">
        <span className="pros-card-icon" aria-hidden="true">
          <Icon name={icon} />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Coordonnées
// ---------------------------------------------------------------------------

function ContactCard({ d, onToast }: { d: ProspectDetail; onToast: (m: string) => void }): ReactElement {
  const save = useSetContact(d.claim.id);
  const [phone, setPhone] = useState(d.claim.contact_phone ? formatPhone(d.claim.contact_phone) : '');
  const [email, setEmail] = useState(d.claim.contact_email ?? '');
  const [source, setSource] = useState(d.claim.contact_source ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const errs: Record<string, string> = {};
    const normalized = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !normalized) errs['phone'] = 'Numéro invalide (ex. 04 90 12 34 56).';
    const mail = email.trim().toLowerCase();
    if (mail && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(mail)) errs['email'] = 'Adresse email invalide.';
    if ((normalized || mail) && !source.trim()) errs['source'] = 'Indique où tu as trouvé ces coordonnées (site, fiche Google…).';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    // mutateAsync : la carte est recréée quand les coordonnées changent ; le message doit survivre.
    void save.mutateAsync({ phone: normalized, email: mail || null, source: source.trim() || null }).then(() => onToast('Coordonnées enregistrées.'), () => undefined);
  }

  return (
    <Card id="contact-title" title="Coordonnées" icon="phone">
      <p className="text-2 text-sm">Le registre public ne donne ni téléphone ni email : cherche-les sur le site de l’entreprise ou sa fiche Google, puis note-les ici.</p>
      <form className="grid gap-4 mt-4" noValidate onSubmit={onSubmit} aria-label="Coordonnées de l’entreprise">
        <TextField label="Téléphone" type="tel" inputMode="tel" autoComplete="off" icon="phone" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors['phone']} optional />
        <TextField label="Email" type="email" inputMode="email" autoComplete="off" icon="mail" value={email} onChange={(e) => setEmail(e.target.value)} error={errors['email']} optional />
        <TextField label="Où les as-tu trouvées ?" placeholder="ex. site de l’entreprise, page Contact" maxLength={300} value={source} onChange={(e) => setSource(e.target.value)} error={errors['source']} />
        {d.claim.contact_email_kind === 'nominatif' ? (
          <FormAlert tone="info">
            Adresse personnelle : n’écris que si elle est publiée pour le travail (site, fiche de l’entreprise), et respecte toute demande d’arrêt. Préfère une adresse générique (contact@…).
          </FormAlert>
        ) : null}
        {save.isError ? <FormAlert>{prospectErrorMessage(save.error)}</FormAlert> : null}
        <button type="submit" className={`btn btn-secondary btn-block${save.isPending ? ' is-loading' : ''}`} disabled={save.isPending}>
          Enregistrer les coordonnées
        </button>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Appel
// ---------------------------------------------------------------------------

function CallCard({ d, onToast }: { d: ProspectDetail; onToast: (m: string) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const phone = d.claim.contact_phone;
  return (
    <Card id="call-title" title="Appeler" icon="phone">
      <div className="pros-actions">
        {phone ? (
          <a className="btn btn-primary btn-lg" href={`tel:${phone}`}>
            <Icon name="phone" />
            Appeler le {formatPhone(phone)}
          </a>
        ) : (
          <button type="button" className="btn btn-primary btn-lg" disabled>
            <Icon name="phone" />
            Ajoute d’abord un numéro
          </button>
        )}
        <button type="button" className="btn btn-secondary btn-lg" onClick={() => setOpen(true)}>
          Noter le résultat
        </button>
      </div>
      {open ? <CallDialog d={d} onClose={() => setOpen(false)} onDone={(m) => onToast(m)} /> : null}
    </Card>
  );
}

function CallDialog({ d, onClose, onDone }: { d: ProspectDetail; onClose: () => void; onDone: (m: string) => void }): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const log = useLogCall(d.claim.id);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!outcome) {
      setError('Choisis le résultat de l’appel.');
      return;
    }
    if (date && !dateInputToIso(date)) {
      setError('Date invalide.');
      return;
    }
    setError(null);
    log.mutate(
      { outcome, nextActionAt: date ? dateInputToIso(date) : null },
      {
        onSuccess: (status) => {
          ref.current?.close();
          onDone(status === 'pas_interesse' ? 'Appel noté. L’entreprise est libérée et mise en pause pour tous.' : 'Appel noté.');
        },
      },
    );
  }

  return (
    <dialog ref={ref} className="app-dialog" aria-labelledby="call-dialog-title" onClose={onClose}>
      <form noValidate onSubmit={onSubmit} className="grid gap-5">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="call-dialog-title" className="sheet-title">
          Résultat de l’appel
        </h2>
        <fieldset className="pros-fieldset">
          <legend className="sr-only">Résultat</legend>
          <div className="pros-outcomes">
            {CALL_OUTCOMES.map(([key, label]) => (
              <button key={key} type="button" className={`chip chip-filter${key === 'pas_interesse' ? ' pros-outcome-no' : ''}`} aria-pressed={outcome === key} onClick={() => setOutcome(key)}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        {outcome === 'pas_interesse' ? (
          <FormAlert tone="info">L’entreprise sera libérée et mise en pause 6 mois pour tous les stackers. S’il ne veut plus jamais être contacté, utilise plutôt le bouton dédié en bas de la fiche.</FormAlert>
        ) : (
          <TextField label="Prochaine action" type="date" value={date} onChange={(e) => setDate(e.target.value)} optional hint="Tu la retrouveras dans « À relancer »." />
        )}
        {error ? <FormAlert>{error}</FormAlert> : null}
        {log.isError ? <FormAlert>{prospectErrorMessage(log.error)}</FormAlert> : null}
        <div className="sheet-actions">
          <button type="submit" className={`btn btn-primary btn-block btn-lg${log.isPending ? ' is-loading' : ''}`} disabled={log.isPending}>
            Enregistrer
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => ref.current?.close()}>
            Annuler
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

function EmailCard({ d, onToast }: { d: ProspectDetail; onToast: (m: string) => void }): ReactElement {
  const templates = useEmailTemplates();
  const profile = useProfile();
  const prepare = usePrepareEmail(d.claim.id);
  const markSent = useMarkSent();
  const [templateKey, setTemplateKey] = useState('');
  const [prepared, setPrepared] = useState<PreparedEmail | null>(null);
  const [copied, setCopied] = useState(false);
  const defaultKey = d.emails.length === 0 ? 'decouverte' : d.claim.status === 'a_repondu' || d.claim.status === 'rdv' ? 'suite_appel' : 'relance';
  const key = templateKey || defaultKey;
  const noLastName = !profile.data?.last_name;

  if (!d.claim.contact_email) {
    return (
      <Card id="email-title" title="Email" icon="mail">
        <p className="text-2 text-sm">Ajoute l’adresse email de l’entreprise dans « Coordonnées » pour préparer un message.</p>
      </Card>
    );
  }

  const mailto = prepared ? buildProspectMailto(prepared) : null;

  async function copy() {
    if (!prepared) return;
    try {
      await navigator.clipboard.writeText(copyText(prepared));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card id="email-title" title="Email" icon="mail">
      {!prepared ? (
        <div className="grid gap-4">
          <SelectField
            label="Modèle"
            options={(templates.data ?? []).map((t) => [t.key, t.label] as const)}
            placeholder="Choisis un modèle"
            value={key}
            onChange={(e) => setTemplateKey(e.target.value)}
          />
          {noLastName ? (
            <FormAlert tone="info">
              Ton nom de famille apparaît dans la signature de tes emails : <Link to={PATHS.profile}>ajoute-le dans ton profil</Link>.
            </FormAlert>
          ) : null}
          {prepare.isError ? <FormAlert>{prospectErrorMessage(prepare.error)}</FormAlert> : null}
          <button
            type="button"
            className={`btn btn-primary btn-block${prepare.isPending ? ' is-loading' : ''}`}
            disabled={prepare.isPending || !key}
            onClick={() => prepare.mutate(key, { onSuccess: (email) => setPrepared(email) })}
          >
            Préparer l’email
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="pros-mail" aria-label="Aperçu de l’email">
            <p className="pros-mail-line">
              <span>À</span> {prepared.recipient}
            </p>
            <p className="pros-mail-line">
              <span>Objet</span> {prepared.subject}
            </p>
            <p className="pros-mail-body">{prepared.body}</p>
            <p className="pros-mail-footer">
              <Icon name="lock" />
              <span>{prepared.footer}</span>
            </p>
          </div>
          <p className="text-small">Le pied (identité, lien d’opposition) est obligatoire : ne le supprime pas avant d’envoyer.</p>
          <div className="pros-send">
            {mailto ? (
              <a className="btn btn-primary" href={mailto}>
                <Icon name="send" />
                Ouvrir ma messagerie
              </a>
            ) : (
              <button type="button" className="btn btn-primary" disabled title="Message trop long pour ce bouton : utilise Copier">
                <Icon name="send" />
                Ouvrir ma messagerie
              </button>
            )}
            <a className="btn btn-secondary" href={gmailComposeUrl(prepared)} target="_blank" rel="noopener noreferrer">
              Gmail
            </a>
            <a className="btn btn-secondary" href={outlookComposeUrl(prepared)} target="_blank" rel="noopener noreferrer">
              Outlook
            </a>
            <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
              <Icon name={copied ? 'check' : 'pen'} />
              {copied ? 'Copié' : 'Copier'}
            </button>
          </div>
          {markSent.isError ? <FormAlert>{prospectErrorMessage(markSent.error)}</FormAlert> : null}
          <button
            type="button"
            className={`btn btn-accent btn-block btn-lg${markSent.isPending ? ' is-loading' : ''}`}
            disabled={markSent.isPending}
            onClick={() =>
              markSent.mutate(prepared.id, {
                onSuccess: () => {
                  setPrepared(null);
                  setCopied(false);
                  onToast('Envoi noté. Ta réservation est prolongée.');
                },
              })
            }
          >
            <Icon name="check" />
            Je l’ai envoyé
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setPrepared(null)}>
            Changer de modèle
          </button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Statut
// ---------------------------------------------------------------------------

const STATUS_CHOICES: ProspectStatus[] = ['contacte', 'a_repondu', 'rdv'];

function StatusCard({ d, onToast }: { d: ProspectDetail; onToast: (m: string) => void }): ReactElement {
  const save = useSetStatus(d.claim.id);
  const [status, setStatusValue] = useState<ProspectStatus>(d.claim.status);
  const [date, setDate] = useState(isoToDateInput(d.claim.next_action_at));
  const [error, setError] = useState<string | null>(null);
  const changed = status !== d.claim.status || date !== isoToDateInput(d.claim.next_action_at);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (date && !dateInputToIso(date)) {
      setError('Date invalide.');
      return;
    }
    setError(null);
    void save.mutateAsync({ status, nextActionAt: date ? dateInputToIso(date) : null }).then(() => onToast('Suivi mis à jour.'), () => undefined);
  }

  return (
    <Card id="status-title" title="Où en es-tu ?" icon="sliders">
      <form className="grid gap-4" noValidate onSubmit={onSubmit} aria-label="Statut du prospect">
        <div className="segmented pros-status" role="group" aria-label="Statut">
          {STATUS_CHOICES.map((s) => {
            const allowed = s === d.claim.status || transitionAllowed(d.claim.status, s);
            return (
              <button key={s} type="button" aria-pressed={status === s} disabled={!allowed} onClick={() => setStatusValue(s)}>
                {STATUS_LABELS[s]}
              </button>
            );
          })}
          <button type="button" disabled aria-pressed={false} title="Posé automatiquement quand le client signe">
            Signé
          </button>
        </div>
        <p className="text-small">« Signé » se pose tout seul quand ton client signe avec Stacker.</p>
        <TextField label="Prochaine action" type="date" value={date} onChange={(e) => setDate(e.target.value)} optional />
        {error ? <FormAlert>{error}</FormAlert> : null}
        {save.isError ? <FormAlert>{prospectErrorMessage(save.error)}</FormAlert> : null}
        <button type="submit" className={`btn btn-secondary btn-block${save.isPending ? ' is-loading' : ''}`} disabled={!changed || save.isPending || status === 'a_contacter'}>
          Enregistrer le suivi
        </button>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Notes et historique
// ---------------------------------------------------------------------------

function NotesCard({ d, readOnly }: { d: ProspectDetail; readOnly: boolean }): ReactElement {
  const add = useAddNote(d.claim.id);
  const del = useDeleteNote();
  const [body, setBody] = useState('');
  const textId = 'note-text';

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;
    add.mutate(body.trim(), { onSuccess: () => setBody('') });
  }

  return (
    <Card id="notes-title" title="Notes" icon="pen">
      {!readOnly ? (
        <form className="grid gap-3" noValidate onSubmit={onSubmit} aria-label="Ajouter une note">
          <div className="field">
            <label className="field-label" htmlFor={textId}>
              Nouvelle note
            </label>
            <textarea id={textId} className="input pros-textarea" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Ce qu’il t’a dit, à quel moment rappeler…" />
          </div>
          {add.isError ? <FormAlert>{prospectErrorMessage(add.error)}</FormAlert> : null}
          <button type="submit" className={`btn btn-secondary${add.isPending ? ' is-loading' : ''}`} disabled={add.isPending || !body.trim()}>
            Ajouter la note
          </button>
        </form>
      ) : null}
      {d.notes.length ? (
        <ul className="pros-notes">
          {d.notes.map((n) => (
            <li key={n.id}>
              <p>{n.body}</p>
              <span className="text-small">{formatLongDate(n.created_at)}</span>
              {!readOnly ? (
                <button type="button" className="btn btn-ghost btn-icon" aria-label="Supprimer la note" disabled={del.isPending} onClick={() => del.mutate(n.id)}>
                  <Icon name="x" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-2 text-sm mt-3">Aucune note.</p>
      )}
    </Card>
  );
}

function HistoryCard({ d }: { d: ProspectDetail }): ReactElement {
  return (
    <Card id="history-title" title="Historique" icon="clock">
      <ol className="pros-history">
        {d.events.map((e, i) => (
          <li key={`${e.created_at}-${String(i)}`}>
            <span>{eventLabel(e)}</span>
            <span className="text-small">{formatLongDate(e.created_at)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Prolonger, libérer, opposition
// ---------------------------------------------------------------------------

function DangerZone({ d, onToast }: { d: ProspectDetail; onToast: (m: string) => void }): ReactElement {
  const navigate = useNavigate();
  const extend = useExtend(d.claim.id);
  const [confirm, setConfirm] = useState<'manuel' | 'opposition' | null>(null);
  const canExtend = !d.claim.extended && d.claim.status !== 'a_contacter';

  return (
    <section className="pros-danger" aria-label="Gérer la réservation">
      {canExtend ? (
        <button type="button" className={`btn btn-secondary btn-block${extend.isPending ? ' is-loading' : ''}`} disabled={extend.isPending} onClick={() => extend.mutate(undefined, { onSuccess: () => onToast('Réservation prolongée de 7 jours.') })}>
          <Icon name="clock" />
          Prolonger de 7 jours
        </button>
      ) : null}
      {extend.isError ? <FormAlert>{prospectErrorMessage(extend.error)}</FormAlert> : null}
      <button type="button" className="btn btn-ghost btn-block" onClick={() => setConfirm('manuel')}>
        Libérer ce prospect
      </button>
      <button type="button" className="btn btn-danger btn-block" onClick={() => setConfirm('opposition')}>
        Il ne veut plus être contacté
      </button>
      {confirm ? (
        <ReleaseDialog
          d={d}
          reason={confirm}
          onClose={() => setConfirm(null)}
          onDone={() => void navigate(`${PATHS.prospects}?vue=mes`, { replace: true, state: { notice: confirm === 'opposition' ? 'Demande enregistrée.' : 'Prospect libéré.' } })}
        />
      ) : null}
    </section>
  );
}

function ReleaseDialog({ d, reason, onClose, onDone }: { d: ProspectDetail; reason: 'manuel' | 'opposition'; onClose: () => void; onDone: () => void }): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const release = useRelease(d.claim.id);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const opposition = reason === 'opposition';
  return (
    <dialog ref={ref} className="app-dialog" aria-labelledby="release-title" onClose={onClose}>
      <div className="grid gap-5">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="release-title" className="sheet-title">
          {opposition ? 'Ne plus jamais le contacter ?' : 'Libérer ce prospect ?'}
        </h2>
        <p className="text-2">
          {opposition
            ? `${displayName(d.company.name)} ne sera plus jamais proposée à aucun stacker, et ses coordonnées seront bloquées. C’est définitif.`
            : `${displayName(d.company.name)} retourne dans la liste commune. Tu ne pourras pas la reprendre avant 30 jours.`}
        </p>
        {release.isError ? <FormAlert>{prospectErrorMessage(release.error)}</FormAlert> : null}
        <div className="sheet-actions">
          <button
            type="button"
            className={`btn ${opposition ? 'btn-danger-solid' : 'btn-primary'} btn-block btn-lg${release.isPending ? ' is-loading' : ''}`}
            disabled={release.isPending}
            onClick={() => void release.mutateAsync(reason).then(onDone, () => undefined)}
          >
            {opposition ? 'Confirmer : ne plus le contacter' : 'Libérer'}
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => ref.current?.close()}>
            Annuler
          </button>
        </div>
      </div>
    </dialog>
  );
}
