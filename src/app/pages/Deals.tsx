import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { FormAlert } from '../components/Form';
import { AppBar, usePageTitle } from '../components/Layouts';
import { formatLongDate } from '../lib/dates';
import { useEarnings, useMyDeals } from '../lib/dealQueries';
import { DEAL_STATUS_CHIP, DEAL_STATUS_LABELS, dealErrorMessage, formatEuros } from '../lib/deals';
import { formatRate } from '../lib/tiers';
import { PATHS, dealPath } from '../paths';

/** Onglet « Deals » : faire signer un client, suivre chaque contrat signé. */
export function DealsPage(): ReactElement {
  usePageTitle('Deals');
  const deals = useMyDeals();
  const earnings = useEarnings();

  return (
    <div className="app-container deals">
      <AppBar title="Deals" />

      <section className="card card-dark deals-hero" aria-labelledby="deals-cta">
        <h2 id="deals-cta" className="h2">
          Ton client est prêt ?
        </h2>
        <p className="deals-hero-text">Choisis l’offre, saisis ses infos et son IBAN : il signe directement sur ton téléphone, en 2 minutes.</p>
        <Link className="btn btn-accent btn-lg btn-block" to={PATHS.dealNew}>
          <Icon name="signature" />
          Faire signer un client
        </Link>
        {earnings.data ? (
          <dl className="deals-stats">
            <div>
              <dt>Signés</dt>
              <dd className="num">{earnings.data.signed_count}</dd>
            </div>
            <div>
              <dt>Actifs</dt>
              <dd className="num">{earnings.data.active_count}</dd>
            </div>
            <div>
              <dt>Ton taux</dt>
              <dd className="num">{formatRate(earnings.data.rate_bps)}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      <section aria-labelledby="deals-list">
        <div className="section-head">
          <h2 id="deals-list" className="h3">
            Mes deals
          </h2>
        </div>
        {deals.isPending ? (
          <div className="card" aria-busy="true">
            <span className="skeleton skeleton-text w-full" />
            <span className="skeleton skeleton-text mt-3 w-2/3" />
          </div>
        ) : deals.isError ? (
          <FormAlert>{dealErrorMessage(deals.error)}</FormAlert>
        ) : deals.data.length === 0 ? (
          <div className="card empty deals-empty">
            <Icon name="briefcase" size={32} />
            <p className="font-semibold text-ink">Aucun deal pour l’instant</p>
            <p className="text-2 text-sm">Quand un prospect est intéressé, ouvre sa fiche et touche « Faire signer » : ses infos sont déjà remplies.</p>
            <Link className="btn btn-secondary" to={`${PATHS.prospects}?vue=mes`}>
              Voir mes prospects
            </Link>
          </div>
        ) : (
          <ul className="card list deals-list">
            {deals.data.map((d) => (
              <li key={d.id}>
                <Link className="list-row deals-row" to={dealPath(d.id)}>
                  <div className="min-w-0 flex-1">
                    <p className="list-title">{d.company_name}</p>
                    <p className="list-sub">
                      <span>{d.offer_label}</span>
                    </p>
                    <p className="pros-tags">
                      <span className={DEAL_STATUS_CHIP[d.status]}>{DEAL_STATUS_LABELS[d.status]}</span>
                      <span className="text-small text-2">Signé le {formatLongDate(d.signed_at)}</span>
                    </p>
                  </div>
                  <div className="deals-row-amount">
                    <span className="num">{formatEuros(d.monthly_price_cents)}</span>
                    <small>/ mois</small>
                  </div>
                  <Icon name="chevron-right" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
