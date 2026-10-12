import { useState, type ReactElement, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { FormAlert } from '../components/Form';
import { AppBar, usePageTitle } from '../components/Layouts';
import { AdminError, DEAL_FILTERS, FLAGS, LOG_LABELS, adminErrorMessage, groupIban, type AdminDeal, type AdminPayout, type Overview, type PayoutFilter } from '../lib/admin';
import {
  useAdminDeals,
  useAdminOffers,
  useAdminPayouts,
  useAdminStackers,
  useMarkPayout,
  useOverview,
  useSetDealStatus,
  useSetFlag,
  useSetOfferActive,
} from '../lib/adminQueries';
import { BILLING_STATUS_LABELS } from '../lib/billing';
import { formatLongDate } from '../lib/dates';
import { DEAL_STATUS_CHIP, DEAL_STATUS_LABELS, formatEuros } from '../lib/deals';

const TABS = [
  { id: 'vue', label: 'Vue d’ensemble' },
  { id: 'virements', label: 'Virements' },
  { id: 'deals', label: 'Deals' },
  { id: 'offres', label: 'Offres' },
  { id: 'stackers', label: 'Stackers' },
  { id: 'reglages', label: 'Réglages' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/** Espace admin (équipe Stacker) : chaque lecture et action est vérifiée par le serveur. */
export function AdminPage(): ReactElement {
  usePageTitle('Admin');
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.id === params.get('onglet'))?.id ?? 'vue';
  const overview = useOverview();
  const go = (t: Tab) => setParams(t === 'vue' ? {} : { onglet: t }, { replace: true });

  if (overview.isError) {
    const forbidden = overview.error instanceof AdminError && overview.error.code === 'forbidden';
    return (
      <div className="app-container">
        <AppBar title="Admin" />
        <FormAlert>{forbidden ? 'Accès réservé à l’équipe Stacker.' : adminErrorMessage(overview.error)}</FormAlert>
      </div>
    );
  }

  const pending = overview.data?.payouts_pending ?? 0;
  return (
    <div className="app-container admin">
      <AppBar title="Admin" />
      <nav className="admin-tabs" aria-label="Rubriques de l’admin">
        {TABS.map((t) => (
          <button key={t.id} type="button" className="chip" aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
            {t.label}
            {t.id === 'virements' && pending > 0 ? <span className="admin-badge num">{pending}</span> : null}
          </button>
        ))}
      </nav>
      {overview.isPending ? (
        <div className="card" aria-busy="true">
          <span className="skeleton skeleton-title w-2/3" />
        </div>
      ) : (
        <>
          {tab === 'vue' ? <OverviewTab o={overview.data} go={go} /> : null}
          {tab === 'virements' ? <PayoutsTab /> : null}
          {tab === 'deals' ? <DealsTab /> : null}
          {tab === 'offres' ? <OffersTab /> : null}
          {tab === 'stackers' ? <StackersTab /> : null}
          {tab === 'reglages' ? <SettingsTab flags={overview.data.flags} /> : null}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'alert' }): ReactElement {
  return (
    <div className={`admin-stat${tone === 'alert' ? ' is-alert' : ''}`}>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
      {sub ? <dd className="admin-stat-sub">{sub}</dd> : null}
    </div>
  );
}

function OverviewTab({ o, go }: { o: Overview; go: (t: Tab) => void }): ReactElement {
  const deals = (s: string) => o.deals[s] ?? 0;
  return (
    <>
      <dl className="admin-stats">
        <Stat label="Stackers inscrits" value={String(o.stackers)} sub={`${String(o.signups_7d)} comptes créés sur 7 jours`} />
        <Stat label="Abonnés" value={String(o.subscriptions)} sub={o.subscriptions_unpaid ? `dont ${String(o.subscriptions_unpaid)} impayé(s)` : 'aucun impayé'} />
        <Stat label="Places de lancement" value={`${String(o.launch_members)} / ${String(o.launch_seats)}`} />
        <Stat label="Clients actifs" value={String(deals('actif'))} sub={`${String(deals('signe'))} signé(s) en attente · ${String(o.deals_7d)} sur 7 jours`} />
        <Stat label="Revenu clients / mois" value={formatEuros(o.client_monthly_cents, { always: true })} />
        <Stat label="Commissions dues" value={formatEuros(o.commissions_available_cents, { always: true })} sub="disponibles, pas encore demandées" />
      </dl>
      {o.payouts_pending > 0 ? (
        <button type="button" className="card admin-todo" onClick={() => go('virements')}>
          <Icon name="bank" />
          <span>
            <b>{o.payouts_pending} virement(s) à faire</b> · {formatEuros(o.payouts_pending_cents, { always: true })}
          </span>
          <Icon name="chevron-right" />
        </button>
      ) : null}
      {o.mollie_errors > 0 ? (
        <button type="button" className="card admin-todo is-alert" onClick={() => go('deals')}>
          <Icon name="alert" />
          <span>
            <b>{o.mollie_errors} deal(s)</b> bloqué(s) à la mise en place du prélèvement Mollie
          </span>
          <Icon name="chevron-right" />
        </button>
      ) : null}
      {o.emails_failed > 0 ? (
        <p className="card admin-todo is-alert">
          <Icon name="mail" />
          <span>
            <b>{o.emails_failed} email(s)</b> non envoyé(s) après 6 essais : vérifie Brevo.
          </span>
        </p>
      ) : null}
      <section aria-labelledby="admin-log">
        <div className="section-head">
          <h2 id="admin-log" className="h3">
            Journal
          </h2>
        </div>
        {o.log.length === 0 ? (
          <p className="card text-2 text-sm">Aucune action pour l’instant.</p>
        ) : (
          <ul className="card list">
            {o.log.map((l, i) => (
              <li key={`${l.created_at}-${String(i)}`} className="list-row">
                <div className="min-w-0 flex-1">
                  <p className="list-title">
                    {LOG_LABELS[l.action] ?? l.action}
                    {l.action === 'flag' ? ` · ${l.target ?? ''} ${l.detail['enabled'] === true ? 'activé' : 'coupé'}` : ''}
                  </p>
                  <p className="list-sub">
                    <span>
                      {formatLongDate(l.created_at)} · {l.admin ?? 'compte supprimé'}
                    </span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** Bouton qui ouvre une saisie (motif, référence) puis confirme. */
function ConfirmAction({
  label,
  confirmLabel,
  field,
  required,
  tone = 'secondary',
  onConfirm,
  pending,
}: {
  label: string;
  confirmLabel: string;
  field: string;
  required: boolean;
  tone?: 'secondary' | 'danger' | 'accent';
  onConfirm: (value: string) => void;
  pending: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const cls = tone === 'danger' ? 'btn-danger' : tone === 'accent' ? 'btn-accent' : 'btn-secondary';
  if (!open)
    return (
      <button type="button" className={`btn btn-sm ${cls}`} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  const valid = !required || value.trim().length >= 3;
  return (
    <div className="admin-confirm">
      <label className="field-label">
        {field}
        {!required ? <span className="field-optional"> (facultatif)</span> : null}
        <input className="input" value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div className="admin-actions">
        <button type="button" className={`btn btn-sm ${tone === 'danger' ? 'btn-danger-solid' : 'btn-accent'}${pending ? ' is-loading' : ''}`} disabled={!valid || pending} onClick={() => onConfirm(value)}>
          {confirmLabel}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </div>
  );
}

function Copy({ text, label }: { text: string; label: string }): ReactElement {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setDone(true));
      }}
    >
      <Icon name={done ? 'check' : 'pen'} />
      {done ? 'Copié' : 'Copier'}
    </button>
  );
}

function Loading({ q, children }: { q: { isPending: boolean; isError: boolean; error: unknown }; children: () => ReactNode }): ReactElement {
  if (q.isPending)
    return (
      <div className="card" aria-busy="true">
        <span className="skeleton skeleton-text w-full" />
      </div>
    );
  if (q.isError) return <FormAlert>{adminErrorMessage(q.error)}</FormAlert>;
  return <>{children()}</>;
}

function PayoutsTab(): ReactElement {
  const [filter, setFilter] = useState<PayoutFilter>('demande');
  const payouts = useAdminPayouts(filter);
  return (
    <section className="admin-section" aria-label="Virements">
      <div className="segmented" role="group" aria-label="Filtrer les virements">
        {(
          [
            ['demande', 'À faire'],
            ['verse', 'Versés'],
            ['refuse', 'Refusés'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
      <Loading q={payouts}>
        {() =>
          payouts.data?.length ? (
            <ul className="admin-cards">
              {payouts.data.map((p) => (
                <PayoutCard key={p.id} p={p} />
              ))}
            </ul>
          ) : (
            <p className="card text-2 text-sm">{filter === 'demande' ? 'Aucun virement à faire.' : 'Aucun virement.'}</p>
          )
        }
      </Loading>
    </section>
  );
}

function PayoutCard({ p }: { p: AdminPayout }): ReactElement {
  const mark = useMarkPayout();
  return (
    <li className="card admin-card">
      <div className="admin-card-head">
        <p className="admin-amount num">{formatEuros(p.amount_cents, { always: true })}</p>
        <span className="text-small text-2">Demandé le {formatLongDate(p.requested_at)}</span>
      </div>
      <p className="list-title">{p.stacker_name ?? 'Compte supprimé'}</p>
      {p.stacker_email ? <p className="text-small text-2">{p.stacker_email}</p> : null}
      {p.iban ? (
        <div className="admin-iban">
          <div className="min-w-0">
            <p className="text-small text-2">{p.holder}</p>
            <p className="admin-iban-value">{groupIban(p.iban)}</p>
          </div>
          <Copy text={p.iban} label={`Copier l’IBAN de ${p.holder ?? 'ce stacker'}`} />
        </div>
      ) : (
        <p className="text-small text-2">
          IBAN ••{p.iban_last4}
          {p.status === 'demande' ? ' (modifié depuis la demande : refuse et demande-lui de redemander)' : ''}
          {p.reference ? ` · ${p.reference}` : ''}
          {p.processed_at ? ` · traité le ${formatLongDate(p.processed_at)}` : ''}
        </p>
      )}
      {p.status === 'demande' ? (
        <div className="admin-actions">
          <ConfirmAction label="Marquer versé" confirmLabel="Confirmer : virement fait" field="Référence du virement" required={false} tone="accent" pending={mark.isPending} onConfirm={(note) => mark.mutate({ id: p.id, status: 'verse', note })} />
          <ConfirmAction label="Refuser" confirmLabel="Refuser le virement" field="Motif (envoyé au stacker)" required tone="danger" pending={mark.isPending} onConfirm={(note) => mark.mutate({ id: p.id, status: 'refuse', note })} />
        </div>
      ) : null}
      {mark.isError ? <FormAlert>{adminErrorMessage(mark.error)}</FormAlert> : null}
    </li>
  );
}

function DealsTab(): ReactElement {
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const deals = useAdminDeals(status, query);
  return (
    <section className="admin-section" aria-label="Deals">
      <form
        className="admin-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search);
        }}
      >
        <input className="input" type="search" placeholder="Entreprise, référence ou SIRET" aria-label="Rechercher un deal" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" aria-label="Statut" value={status ?? ''} onChange={(e) => setStatus(e.target.value || null)}>
          <option value="">Tous les statuts</option>
          {DEAL_FILTERS.map((s) => (
            <option key={s} value={s}>
              {DEAL_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary">
          <Icon name="search" />
          Chercher
        </button>
      </form>
      <Loading q={deals}>
        {() =>
          deals.data?.length ? (
            <ul className="admin-cards">
              {deals.data.map((d) => (
                <DealCard key={d.id} d={d} />
              ))}
            </ul>
          ) : (
            <p className="card text-2 text-sm">Aucun deal.</p>
          )
        }
      </Loading>
    </section>
  );
}

const MOLLIE_LABELS: Record<string, string> = { a_faire: 'Prélèvement à mettre en place', fait: 'Prélèvement en place', erreur: 'Erreur Mollie', a_annuler: 'Arrêt en cours', annule: 'Prélèvement arrêté' };

function DealCard({ d }: { d: AdminDeal }): ReactElement {
  const set = useSetDealStatus();
  const open = d.status !== 'resilie' && d.status !== 'annule';
  return (
    <li className="card admin-card">
      <div className="admin-card-head">
        <p className="list-title">{d.company_name}</p>
        <span className={DEAL_STATUS_CHIP[d.status]}>{DEAL_STATUS_LABELS[d.status]}</span>
      </div>
      <p className="text-small text-2">
        {d.reference} · {d.offer_label} · {formatEuros(d.monthly_price_cents)}/mois · {d.payments} paiement(s)
      </p>
      <p className="text-small text-2">
        Stacker : {d.stacker_name ?? 'compte supprimé'} · signé le {formatLongDate(d.signed_at)}
      </p>
      <p className="text-small text-2">
        Client : {d.contact_email} · {d.contact_phone}
      </p>
      <p className={`text-small${d.mollie_status === 'erreur' || d.mollie_error ? ' admin-error' : ' text-2'}`}>
        {MOLLIE_LABELS[d.mollie_status] ?? d.mollie_status}
        {d.first_debit_on && d.mollie_status === 'fait' ? ` · 1er prélèvement le ${formatLongDate(d.first_debit_on)}` : ''}
        {d.mollie_error ? ` · ${d.mollie_error}` : ''}
      </p>
      {d.end_reason ? <p className="text-small text-2">Motif : {d.end_reason}</p> : null}
      {open ? (
        <div className="admin-actions">
          {d.status !== 'suspendu' ? (
            <ConfirmAction label="Suspendre" confirmLabel="Suspendre" field="Motif" required pending={set.isPending} onConfirm={(reason) => set.mutate({ id: d.id, status: 'suspendu', reason })} />
          ) : null}
          {d.status === 'signe' ? (
            <ConfirmAction label="Annuler" confirmLabel="Annuler le contrat" field="Motif (rétractation…)" required tone="danger" pending={set.isPending} onConfirm={(reason) => set.mutate({ id: d.id, status: 'annule', reason })} />
          ) : null}
          <ConfirmAction label="Résilier" confirmLabel="Résilier le contrat" field="Motif" required tone="danger" pending={set.isPending} onConfirm={(reason) => set.mutate({ id: d.id, status: 'resilie', reason })} />
        </div>
      ) : null}
      {set.isError ? <FormAlert>{adminErrorMessage(set.error)}</FormAlert> : null}
    </li>
  );
}

function OffersTab(): ReactElement {
  const offers = useAdminOffers();
  const set = useSetOfferActive();
  return (
    <section className="admin-section" aria-label="Offres">
      {set.isError ? <FormAlert>{adminErrorMessage(set.error)}</FormAlert> : null}
      <Loading q={offers}>
        {() => (
          <ul className="card list">
            {offers.data?.map((o) => (
              <li key={o.id} className="list-row">
                <div className="min-w-0 flex-1">
                  <p className="list-title">
                    {o.brand} · {o.name}
                  </p>
                  <p className="list-sub">
                    <span>
                      {formatEuros(o.price_cents)}
                      {o.unit_label ? ` / ${o.unit_label}` : ''} par mois · {o.engagement_months ? `${String(o.engagement_months)} mois` : 'sans engagement'} · {o.deals} deal(s)
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={o.active}
                  aria-label={`${o.brand} ${o.name} proposée aux stackers`}
                  className={`admin-switch${o.active ? ' is-on' : ''}`}
                  disabled={set.isPending}
                  onClick={() => set.mutate({ id: o.id, active: !o.active })}
                >
                  <span />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Loading>
    </section>
  );
}

function StackersTab(): ReactElement {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const stackers = useAdminStackers(query);
  return (
    <section className="admin-section" aria-label="Stackers">
      <form
        className="admin-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search);
        }}
      >
        <input className="input" type="search" placeholder="Nom ou email" aria-label="Rechercher un stacker" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="submit" className="btn btn-secondary">
          <Icon name="search" />
          Chercher
        </button>
      </form>
      <Loading q={stackers}>
        {() =>
          stackers.data?.length ? (
            <ul className="card list">
              {stackers.data.map((s) => (
                <li key={s.id} className="list-row">
                  <div className="min-w-0 flex-1">
                    <p className="list-title">{s.name ?? s.email}</p>
                    <p className="list-sub">
                      <span>
                        {s.email}
                        {s.phone ? ` · ${s.phone}` : ''}
                        {s.department ? ` · ${s.department}` : ''}
                      </span>
                    </p>
                    <p className="pros-tags">
                      <span className={s.subscription === 'actif' ? 'chip chip-green' : s.subscription === 'impaye' ? 'chip chip-red' : 'chip'}>{BILLING_STATUS_LABELS[s.subscription]}</span>
                      {s.launch_member ? <span className="chip chip-violet">Lancement</span> : null}
                      {!s.onboarded ? <span className="chip chip-orange">Inscription non finie</span> : null}
                      <span className="text-small text-2">
                        {s.deals} deal(s) · {s.active_clients} actif(s) · solde {formatEuros(s.available_cents, { always: true })}
                      </span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="card text-2 text-sm">Aucun stacker.</p>
          )
        }
      </Loading>
    </section>
  );
}

function SettingsTab({ flags }: { flags: Record<string, boolean> }): ReactElement {
  const set = useSetFlag();
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <section className="admin-section" aria-label="Réglages">
      {set.isError ? <FormAlert>{adminErrorMessage(set.error)}</FormAlert> : null}
      <ul className="card list">
        {FLAGS.map((f) => {
          const on = flags[f.key] === true;
          return (
            <li key={f.key} className="list-row admin-flag">
              <div className="min-w-0 flex-1">
                <p className="list-title">{f.label}</p>
                <p className="list-sub">
                  <span>{f.help}</span>
                </p>
                {confirm === f.key ? (
                  <div className="admin-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-danger-solid"
                      onClick={() => {
                        set.mutate({ key: f.key, enabled: !on });
                        setConfirm(null);
                      }}
                    >
                      {on ? 'Confirmer : couper' : 'Confirmer : activer'}
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>
                      Annuler
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={f.label}
                className={`admin-switch${on ? ' is-on' : ''}`}
                disabled={set.isPending}
                onClick={() => setConfirm(f.key)}
              >
                <span />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="form-note">
        <Icon name="info" />
        <span>Chaque changement est noté dans le journal (vue d’ensemble). Pour ajouter un admin : une ligne SQL dans la table admins (voir la doc de mise en route).</span>
      </p>
    </section>
  );
}
