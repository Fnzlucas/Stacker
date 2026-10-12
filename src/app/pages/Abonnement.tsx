import { useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { CheckField, FormAlert } from '../components/Form';
import { AppBar, usePageTitle } from '../components/Layouts';
import { formatLongDate } from '../lib/dates';
import { BILLING_STATUS_LABELS, billingErrorMessage, billingView, type Billing } from '../lib/billing';
import { useBilling, useSetAutoRenew, useStartCheckout } from '../lib/billingQueries';
import { formatEuros } from '../lib/deals';

/** Délai d'attente de la confirmation Mollie au retour de la page de paiement. */
const CONFIRM_WAIT_MS = 45_000;

/** Abonnement stacker : offre de lancement, paiement Mollie, état, historique, résiliation. */
export function AbonnementPage(): ReactElement {
  usePageTitle('Abonnement');
  const [params] = useSearchParams();
  const returning = params.get('retour') === '1';
  const [waiting, setWaiting] = useState(returning);
  const billing = useBilling(waiting);

  useEffect(() => {
    if (!waiting) return;
    const t = window.setTimeout(() => setWaiting(false), CONFIRM_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [waiting]);
  const confirmed = billing.data?.status === 'actif';

  return (
    <div className="app-container billing">
      <AppBar title="Abonnement" />
      {billing.isPending ? (
        <div className="card" aria-busy="true">
          <span className="skeleton skeleton-title w-2/3" />
          <span className="skeleton skeleton-text mt-3 w-full" />
        </div>
      ) : billing.isError ? (
        <FormAlert>{billingErrorMessage(billing.error)}</FormAlert>
      ) : (
        <>
          {returning && confirmed ? (
            <FormAlert tone="success">Paiement confirmé : ton abonnement est actif. Bonne prospection !</FormAlert>
          ) : null}
          {waiting && !confirmed ? (
            <FormAlert tone="info">Confirmation du paiement en cours… ça prend quelques secondes.</FormAlert>
          ) : null}
          <Status b={billing.data} />
          <History b={billing.data} />
        </>
      )}
    </div>
  );
}

function Status({ b }: { b: Billing }): ReactElement {
  const view = billingView(b);
  const checkout = useStartCheckout();
  const renew = useSetAutoRenew();
  const [confirmStop, setConfirmStop] = useState(false);
  const [terms, setTerms] = useState(false);
  const [immediate, setImmediate] = useState(false);
  const [tried, setTried] = useState(false);
  const pay = () => {
    setTried(true);
    if (!terms || !immediate) return;
    checkout.mutate(undefined, {
      onSuccess: (url) => {
        window.location.assign(url);
      },
    });
  };

  if (view === 'active' || view === 'ending') {
    return (
      <section className="card card-dark billing-hero" aria-labelledby="billing-title">
        <div className="billing-deco" aria-hidden="true">
          <Logo tile={false} size={150} />
        </div>
        <p className="pros-tags">
          <span className={view === 'ending' ? 'chip chip-orange' : 'chip chip-green'}>{view === 'ending' ? 'Résilié' : BILLING_STATUS_LABELS.actif}</span>
          {b.launch_member ? <span className="chip chip-violet">Membre du lancement</span> : null}
        </p>
        <h2 id="billing-title" className="h2 billing-title">
          Stacker · {formatEuros(b.price_cents, { always: true })} / mois
        </h2>
        <dl className="billing-facts">
          <div>
            <dt>{view === 'ending' ? 'Accès jusqu’au' : 'Prochain renouvellement'}</dt>
            <dd>{formatLongDate(b.current_period_end ?? '')}</dd>
          </div>
          {b.method_label ? (
            <div>
              <dt>Moyen de paiement</dt>
              <dd>{b.method_label}</dd>
            </div>
          ) : null}
          {b.launch_member && b.launch_until ? (
            <div>
              <dt>Offre de lancement</dt>
              <dd>0 % prélevé sur tes gains jusqu’au {formatLongDate(b.launch_until)}</dd>
            </div>
          ) : null}
        </dl>
        {view === 'active' ? (
          <p className="billing-text">Chaque mois, l’abonnement est réglé avec tes gains disponibles s’ils suffisent. Sinon, il est prélevé sur ton moyen de paiement.</p>
        ) : (
          <p className="billing-text">Plus aucun prélèvement. Tu gardes l’accès jusqu’à la fin de la période déjà payée.</p>
        )}
        {view === 'ending' ? (
          <button type="button" className={`btn btn-accent btn-block${renew.isPending ? ' is-loading' : ''}`} disabled={renew.isPending} onClick={() => renew.mutate(true)}>
            Reprendre mon abonnement
          </button>
        ) : confirmStop ? (
          <div className="billing-stop" role="group" aria-label="Confirmer la résiliation">
            <p className="billing-text">Résilier ? Tu ne pourras plus réserver de prospects ni faire signer de clients après le {formatLongDate(b.current_period_end ?? '')}. Tes commissions restent à toi.</p>
            <div className="billing-stop-actions">
              <button
                type="button"
                className={`btn btn-danger-solid${renew.isPending ? ' is-loading' : ''}`}
                disabled={renew.isPending}
                onClick={() => renew.mutate(false, { onSuccess: () => setConfirmStop(false) })}
              >
                Confirmer la résiliation
              </button>
              <button type="button" className="btn btn-glass" onClick={() => setConfirmStop(false)}>
                Garder mon abonnement
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-glass btn-sm" onClick={() => setConfirmStop(true)}>
            Résilier mon abonnement
          </button>
        )}
        {renew.isError ? <FormAlert>{billingErrorMessage(renew.error)}</FormAlert> : null}
      </section>
    );
  }

  const seats = b.launch_seats_left;
  const launch = seats > 0 || b.launch_priority;
  return (
    <section className="card card-dark billing-hero" aria-labelledby="billing-title">
      <div className="billing-deco" aria-hidden="true">
        <Logo tile={false} size={150} />
      </div>
      {view === 'unpaid' ? (
        <p className="billing-alert" role="alert">
          <Icon name="alert" />
          <span>Le dernier paiement a été refusé. Mets à jour ton moyen de paiement pour garder l’accès.</span>
        </p>
      ) : null}
      {view === 'pending' ? (
        <p className="billing-alert" role="status">
          <Icon name="clock" />
          <span>Un paiement est en attente. S’il n’a pas abouti, relance-le ci-dessous.</span>
        </p>
      ) : null}
      <p className="pros-tags">
        {launch ? <span className="chip chip-violet">Offre de lancement</span> : null}
        {b.launch_priority ? <span className="chip chip-green">Place réservée (liste d’attente)</span> : null}
      </p>
      <h2 id="billing-title" className="h2 billing-title">
        <span className="num">{formatEuros(b.price_cents, { always: true })}</span> / mois
      </h2>
      <ul className="billing-perks">
        <li>
          <Icon name="check" />
          <span>Prospection, campagnes et signature des clients en illimité</span>
        </li>
        <li>
          <Icon name="check" />
          <span>{launch ? '0 % prélevé sur tes commissions pendant 12 mois' : 'Tu gardes 100 % de tes commissions'}</span>
        </li>
        <li>
          <Icon name="check" />
          <span>Ensuite payé avec tes gains s’ils suffisent</span>
        </li>
        <li>
          <Icon name="check" />
          <span>Sans engagement : résiliable en 2 clics</span>
        </li>
      </ul>
      {!b.launch_priority && seats > 0 ? (
        <p className="billing-seats">
          <b className="num">{seats}</b> place{seats > 1 ? 's' : ''} de lancement restante{seats > 1 ? 's' : ''}
        </p>
      ) : null}
      <div className="billing-consents">
        <CheckField checked={terms} onChange={(e) => setTerms(e.target.checked)} error={tried && !terms ? 'Accepte les conditions générales de vente pour continuer.' : undefined}>
          J’accepte les{' '}
          <a href="/cgv" target="_blank" rel="noopener">
            conditions générales de vente
          </a>{' '}
          de l’abonnement ({formatEuros(b.price_cents, { always: true })} par mois, sans engagement, renouvelé chaque mois).
        </CheckField>
        <CheckField checked={immediate} onChange={(e) => setImmediate(e.target.checked)} error={tried && !immediate ? 'Coche cette case pour accéder aux outils dès maintenant.' : undefined}>
          Je demande l’accès aux outils dès maintenant, avant la fin du délai de rétractation de 14 jours. Si je me rétracte, je paierai
          seulement la part du mois déjà utilisée.
        </CheckField>
      </div>
      <button type="button" className={`btn btn-accent btn-lg btn-block${checkout.isPending ? ' is-loading' : ''}`} disabled={checkout.isPending} onClick={pay}>
        <Icon name="lock" />
        {view === 'unpaid' ? 'Mettre à jour et payer' : `Payer ${formatEuros(b.price_cents, { always: true })} et activer`}
      </button>
      <p className="billing-secure">Paiement sécurisé par Mollie. Stacker ne voit jamais ton numéro de carte.</p>
      {!b.required ? <p className="billing-text">L’abonnement n’est pas encore demandé : tu peux tout utiliser librement en attendant.</p> : null}
      {checkout.isError ? <FormAlert>{billingErrorMessage(checkout.error)}</FormAlert> : null}
    </section>
  );
}

function History({ b }: { b: Billing }): ReactElement | null {
  if (b.charges.length === 0) return null;
  return (
    <section aria-labelledby="billing-history">
      <div className="section-head">
        <h2 id="billing-history" className="h3">
          Paiements
        </h2>
      </div>
      <ul className="card list">
        {b.charges.map((c) => (
          <li key={`${c.created_at}-${c.period_start}`} className="list-row">
            <div className="min-w-0 flex-1">
              <p className="list-title">{formatEuros(c.amount_cents, { always: true })}</p>
              <p className="list-sub">
                <span>
                  {formatLongDate(c.created_at)} · {c.method === 'commissions' ? 'payé avec tes gains' : 'carte ou prélèvement'}
                </span>
              </p>
            </div>
            <span className={c.status === 'paye' ? 'chip chip-green' : c.status === 'echoue' ? 'chip chip-red' : 'chip chip-orange'}>
              {c.status === 'paye' ? 'Payé' : c.status === 'echoue' ? 'Échoué' : 'En attente'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
