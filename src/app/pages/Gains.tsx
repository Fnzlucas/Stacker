import { useState, type ReactElement, type SyntheticEvent } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { FormAlert, TextField } from '../components/Form';
import { AppBar, usePageTitle } from '../components/Layouts';
import { LevelPill, ProgressBar } from '../components/Ui';
import { formatLongDate } from '../lib/dates';
import { useEarnings, useRequestPayout, useSetPayoutAccount } from '../lib/dealQueries';
import {
  COMMISSION_STATUS_LABELS,
  PAYOUT_STATUS_LABELS,
  dealErrorMessage,
  formatEuros,
  formatIban,
  isValidIban,
  periodLabel,
  type Earnings,
} from '../lib/deals';
import { useProfile, useTiers } from '../lib/queries';
import { formatRate, tierProgress } from '../lib/tiers';
import { dealPath } from '../paths';

/** Onglet « Gains » : solde, virements, commissions mois par mois, niveau. */
export function GainsPage(): ReactElement {
  usePageTitle('Gains');
  const earnings = useEarnings();
  return (
    <div className="app-container gains">
      <AppBar title="Gains" />
      {earnings.isPending ? (
        <div className="balance" aria-busy="true">
          <span className="skeleton skeleton-title w-2/3" />
        </div>
      ) : earnings.isError ? (
        <FormAlert>{dealErrorMessage(earnings.error)}</FormAlert>
      ) : (
        <>
          <Balance e={earnings.data} />
          <Monthly e={earnings.data} />
          <Level />
          <History e={earnings.data} />
        </>
      )}
    </div>
  );
}

function Balance({ e }: { e: Earnings }): ReactElement {
  const request = useRequestPayout();
  const [editing, setEditing] = useState(false);
  const pending = e.payouts.find((p) => p.status === 'demande');
  const canRequest = Boolean(e.payout_account) && !pending && e.available_cents >= e.min_payout_cents && e.available_cents > 0;

  const showForm = !e.payout_account || editing;
  return (
    <>
    <section className="balance" aria-labelledby="gains-balance">
      <div className="balance-deco" aria-hidden="true">
        <Logo tile={false} size={168} />
      </div>
      <h2 id="gains-balance" className="balance-label">
        <Icon name="wallet" size={20} />
        Solde disponible
      </h2>
      <p className="balance-amount num">{formatEuros(e.available_cents, { always: true })}</p>
      <dl className="balance-split">
        <div>
          <dt>En validation</dt>
          <dd className="num">{formatEuros(e.validating_cents, { always: true })}</dd>
        </div>
        <div>
          <dt>Déjà versé</dt>
          <dd className="num">{formatEuros(e.paid_cents, { always: true })}</dd>
        </div>
      </dl>
      {e.next_available_at ? (
        <p className="home-balance-text mt-3">Prochaine commission disponible le {formatLongDate(e.next_available_at)}.</p>
      ) : null}

      {pending ? (
        <p className="gains-pending">
          <Icon name="clock" />
          <span>
            Virement de <b>{formatEuros(pending.amount_cents, { always: true })}</b> en cours vers le compte ••{pending.iban_last4}. Les virements sont traités chaque semaine.
          </span>
        </p>
      ) : null}

      {!showForm && e.payout_account ? (
        <div className="gains-actions">
          <button
            type="button"
            className={`btn btn-accent btn-lg btn-block${request.isPending ? ' is-loading' : ''}`}
            disabled={!canRequest || request.isPending}
            onClick={() => request.mutate()}
          >
            <Icon name="bank" />
            Virer sur mon compte
          </button>
          <p className="gains-account">
            Vers {e.payout_account.holder} · ••{e.payout_account.iban_last4}
            {!pending ? (
              <button type="button" className="btn btn-glass btn-sm" onClick={() => setEditing(true)}>
                Modifier
              </button>
            ) : null}
          </p>
          {!pending && e.available_cents < e.min_payout_cents ? (
            <p className="home-balance-text">Virement possible à partir de {formatEuros(e.min_payout_cents)} disponibles.</p>
          ) : null}
          {request.isError ? <FormAlert>{dealErrorMessage(request.error)}</FormAlert> : null}
        </div>
      ) : (
        <p className="home-balance-text mt-4">Ajoute ci-dessous le compte qui recevra tes virements.</p>
      )}
    </section>
    {showForm ? <PayoutAccountForm onDone={() => setEditing(false)} canCancel={editing} /> : null}
    </>
  );
}

function PayoutAccountForm({ onDone, canCancel }: { onDone: () => void; canCancel: boolean }): ReactElement {
  const save = useSetPayoutAccount();
  const [holder, setHolder] = useState('');
  const [iban, setIban] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(ev: SyntheticEvent<HTMLFormElement>) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (holder.trim().length < 2) e['holder'] = 'Indique le titulaire du compte.';
    if (!isValidIban(iban)) e['iban'] = 'IBAN invalide : vérifie les chiffres.';
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      await save.mutateAsync({ holder, iban });
      onDone();
    } catch {
      /* message affiché ci-dessous */
    }
  }

  return (
    <form className="card card-hero gains-iban" onSubmit={(ev) => void submit(ev)} noValidate aria-labelledby="gains-iban-title">
      <h2 id="gains-iban-title" className="h3">
        Ton compte pour les virements
      </h2>
      <p className="text-2 text-sm">Tes commissions disponibles sont virées sur ce compte, à ta demande. Ton IBAN est chiffré.</p>
      <TextField label="Titulaire du compte" value={holder} onChange={(ev) => setHolder(ev.target.value)} error={errors['holder']} autoComplete="name" />
      <TextField
        label="IBAN"
        value={iban}
        onChange={(ev) => setIban(ev.target.value)}
        onBlur={() => setIban(formatIban(iban))}
        error={errors['iban']}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        icon="bank"
      />
      {save.isError ? <FormAlert>{dealErrorMessage(save.error)}</FormAlert> : null}
      <div className="gains-actions">
        <button type="submit" className={`btn btn-primary btn-block${save.isPending ? ' is-loading' : ''}`} disabled={save.isPending}>
          Enregistrer mon IBAN
        </button>
        {canCancel ? (
          <button type="button" className="btn btn-ghost btn-block" onClick={onDone}>
            Annuler
          </button>
        ) : null}
      </div>
    </form>
  );
}

function Monthly({ e }: { e: Earnings }): ReactElement {
  return (
    <section className="card card-hero gains-monthly" aria-labelledby="gains-monthly">
      <h2 id="gains-monthly" className="h3">
        Tes commissions chaque mois
      </h2>
      <p className="gains-monthly-amount num">
        {formatEuros(e.monthly_cents, { always: true })}
        <small> / mois</small>
      </p>
      <p className="text-2 text-sm">
        Sur {e.active_count} client{e.active_count > 1 ? 's' : ''} actif{e.active_count > 1 ? 's' : ''}, à ton taux actuel ({formatRate(e.rate_bps)}), tant qu’ils restent abonnés.
      </p>
      {e.pending_monthly_cents > 0 ? (
        <p className="form-note mt-3">
          <Icon name="clock" />
          <span>+ {formatEuros(e.pending_monthly_cents, { always: true })} / mois à venir : contrats signés, en attente du premier prélèvement.</span>
        </p>
      ) : null}
    </section>
  );
}

function Level(): ReactElement | null {
  const profile = useProfile();
  const tiers = useTiers();
  if (!profile.data || !tiers.data) return null;
  const progress = tierProgress(tiers.data, profile.data.tier, profile.data.active_clients);
  if (!progress) return null;
  return (
    <section className="card card-hero" aria-labelledby="gains-level">
      <div className="gains-level-head">
        <h2 id="gains-level" className="h3">
          Ton niveau
        </h2>
        <LevelPill tier={progress.current} />
      </div>
      {progress.next ? (
        <>
          <ProgressBar percent={progress.percent} label={`Progression vers ${progress.next.label}`} tone="green" />
          <p className="text-2 text-sm mt-2">
            Encore {progress.remaining} client{progress.remaining > 1 ? 's' : ''} actif{progress.remaining > 1 ? 's' : ''} pour passer {progress.next.label} ({formatRate(progress.next.rate_bps)}).
          </p>
        </>
      ) : (
        <p className="text-2 text-sm">Niveau maximal atteint : {formatRate(progress.current.rate_bps)} sur chaque paiement.</p>
      )}
      <ul className="tier-rows mt-4">
        {tiers.data.map((t) => (
          <li key={t.code} className={t.code === profile.data.tier ? 'is-current' : undefined}>
            <LevelPill tier={t} />
            <span className="text-small">
              {t.max_active_clients === null ? `${String(t.min_active_clients)}+ clients actifs` : `${String(t.min_active_clients)} à ${String(t.max_active_clients)} clients actifs`}
            </span>
          </li>
        ))}
      </ul>
      <p className="form-note mt-4">
        <Icon name="info" />
        <span>Le taux s’applique à chaque paiement client, au niveau que tu as ce jour-là. Un client est actif dès qu’il a payé une première fois.</span>
      </p>
    </section>
  );
}

function History({ e }: { e: Earnings }): ReactElement {
  const [now] = useState(() => Date.now());
  return (
    <section aria-labelledby="gains-history">
      <div className="section-head">
        <h2 id="gains-history" className="h3">
          Historique
        </h2>
      </div>
      {e.entries.length === 0 ? (
        <div className="card empty">
          <p className="font-semibold text-ink">Aucune commission pour l’instant</p>
          <p className="text-2 text-sm">Chaque paiement de tes clients apparaîtra ici, avec ta commission.</p>
        </div>
      ) : (
        <ul className="card list">
          {e.entries.map((x) => {
            const validating = x.status === 'disponible' && Date.parse(x.available_at) > now;
            const chip = (
              <p className="pros-tags">
                <span className={validating ? 'chip chip-orange' : x.status === 'versee' ? 'chip chip-dark' : 'chip chip-green'}>
                  {validating ? `Disponible le ${formatLongDate(x.available_at) ?? ''}` : COMMISSION_STATUS_LABELS[x.status]}
                </span>
              </p>
            );
            if (x.kind === 'abonnement' || !x.deal_id) {
              return (
                <li key={x.id} className="list-row deals-row">
                  <div className="min-w-0 flex-1">
                    <p className="list-title">Abonnement Stacker</p>
                    <p className="list-sub">
                      <span>Payé avec tes gains · {formatLongDate(x.created_at)}</span>
                    </p>
                  </div>
                  <span className="deal-com-neg num">− {formatEuros(-x.amount_cents, { always: true })}</span>
                </li>
              );
            }
            const reprise = x.kind === 'reprise';
            return (
              <li key={x.id}>
                <Link className="list-row deals-row" to={dealPath(x.deal_id)}>
                  <div className="min-w-0 flex-1">
                    <p className="list-title">{x.company_name}</p>
                    <p className="list-sub">
                      <span>
                        {reprise
                          ? `${periodLabel(x.period)} · paiement remboursé au client, commission reprise`
                          : `${periodLabel(x.period)} · ${formatRate(x.rate_bps)} de ${formatEuros(x.client_amount_cents)}`}
                      </span>
                    </p>
                    {reprise ? null : chip}
                  </div>
                  {reprise ? (
                    <span className="deal-com-neg num">− {formatEuros(-x.amount_cents, { always: true })}</span>
                  ) : (
                    <span className="deal-com-pos num">+ {formatEuros(x.amount_cents, { always: true })}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {e.payouts.length ? (
        <>
          <div className="section-head mt-6">
            <h2 className="h3">Virements</h2>
          </div>
          <ul className="card list">
            {e.payouts.map((p) => (
              <li key={p.id} className="list-row">
                <div className="min-w-0 flex-1">
                  <p className="list-title">{formatEuros(p.amount_cents, { always: true })}</p>
                  <p className="list-sub">
                    <span>
                      Demandé le {formatLongDate(p.requested_at)} · ••{p.iban_last4}
                    </span>
                  </p>
                </div>
                <span className={p.status === 'verse' ? 'chip chip-green' : p.status === 'refuse' ? 'chip chip-red' : 'chip chip-orange'}>{PAYOUT_STATUS_LABELS[p.status]}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
