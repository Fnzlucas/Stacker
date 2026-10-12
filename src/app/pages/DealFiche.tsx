import type { ReactElement, ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { formatPhone } from '@shared/account';
import { Icon } from '../../components/Icon';
import { PageHeading, usePageTitle } from '../components/Layouts';
import { formatLongDate } from '../lib/dates';
import { useDeal } from '../lib/dealQueries';
import { DEAL_STATUS_CHIP, DEAL_STATUS_LABELS, DealError, dealErrorMessage, engagementLabel, formatEuros, periodLabel, type DealDetail } from '../lib/deals';
import { formatRate } from '../lib/tiers';
import { PATHS } from '../paths';

export function DealFichePage(): ReactElement {
  const { dealId = '' } = useParams();
  const deal = useDeal(dealId);
  usePageTitle(deal.data ? deal.data.company_name : 'Deal');
  return (
    <div className="app-container pros-fiche">
      <header className="appbar app-appbar pros-fiche-bar">
        <Link className="btn btn-ghost btn-sm" to={PATHS.deals}>
          <Icon name="chevron-left" />
          Mes deals
        </Link>
      </header>
      {deal.isPending ? (
        <div className="card card-hero" aria-busy="true">
          <span className="skeleton skeleton-title w-2/3" />
          <span className="skeleton skeleton-text mt-4 w-full" />
        </div>
      ) : deal.isError ? (
        <section className="card card-hero empty">
          <PageHeading className="h3">Deal introuvable</PageHeading>
          <p>{deal.error instanceof DealError ? dealErrorMessage(deal.error) : 'Impossible de charger ce deal. Vérifie ta connexion puis réessaie.'}</p>
          <Link className="btn btn-primary" to={PATHS.deals}>
            Retour à mes deals
          </Link>
        </section>
      ) : (
        <Fiche d={deal.data} />
      )}
    </div>
  );
}

const STATUS_HELP: Record<DealDetail['status'], string> = {
  signe: 'Contrat signé. Le premier prélèvement a lieu après les 14 jours de rétractation : ta commission démarre à ce moment-là.',
  actif: 'Le client paie : tu touches ta commission chaque mois où il paie.',
  suspendu: 'Le dernier prélèvement a échoué. Le service est suspendu jusqu’à régularisation : un coup de fil au client peut tout débloquer.',
  resilie: 'Le contrat est terminé : plus de prélèvement, plus de commission.',
  annule: 'Le client s’est rétracté ou le contrat a été annulé avant le premier paiement.',
};

function Fiche({ d }: { d: DealDetail }): ReactElement {
  return (
    <>
      <section className="card card-hero pros-head" aria-labelledby="deal-title">
        <span className={`${DEAL_STATUS_CHIP[d.status]} pros-head-status`}>{DEAL_STATUS_LABELS[d.status]}</span>
        <PageHeading className="h2 pros-head-title">{d.company_name}</PageHeading>
        <p className="text-2 mt-1">
          {d.offer.brand} · {d.offer.name}
        </p>
        <p className="deal-summary-price mt-4">
          {formatEuros(d.monthly_price_cents)}
          <small> / mois</small>
        </p>
        <p className="form-note mt-3">
          <Icon name="info" />
          <span>{STATUS_HELP[d.status]}</span>
        </p>
        <dl className="pros-facts">
          <Fact label="Référence">
            <span className="num">{d.reference}</span>
          </Fact>
          <Fact label="Signé le">{formatLongDate(d.signed_at)}</Fact>
          <Fact label="Rétractation">jusqu’au {formatLongDate(d.withdrawal_until)}</Fact>
          <Fact label="Durée">{engagementLabel(d.offer.engagement_months)}</Fact>
          {d.offer.unit_label ? <Fact label="Quantité">{`${String(d.quantity)} ${d.offer.unit_label}${d.quantity > 1 ? 's' : ''}`}</Fact> : null}
        </dl>
      </section>

      <section className="card pros-card" aria-labelledby="deal-client">
        <h2 id="deal-client" className="h3">
          Le client
        </h2>
        <dl className="pros-facts">
          <Fact label="Signataire">
            {d.contact_name} ({d.contact_role})
          </Fact>
          <Fact label="Téléphone">
            <a href={`tel:${d.contact_phone}`}>{formatPhone(d.contact_phone)}</a>
          </Fact>
          <Fact label="Email">
            <a href={`mailto:${d.contact_email}`}>{d.contact_email}</a>
          </Fact>
          <Fact label="SIRET">
            <span className="num">{d.company_siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, '$1 $2 $3 $4')}</span>
          </Fact>
          <Fact label="Adresse">{d.company_address}</Fact>
          <Fact label="Prélèvement">
            <span className="num">{d.iban_masked}</span> · RUM <span className="num">{d.mandate_ref}</span>
          </Fact>
        </dl>
      </section>

      <section className="card pros-card" aria-labelledby="deal-payments">
        <h2 id="deal-payments" className="h3">
          Paiements et commissions
        </h2>
        {d.payments.length === 0 ? (
          <p className="text-2 text-sm">Aucun paiement pour l’instant. Ta commission apparaîtra ici dès le premier prélèvement réussi.</p>
        ) : (
          <ul className="list">
            {d.payments.map((p) => (
              <li key={p.period} className="list-row">
                <div className="min-w-0 flex-1">
                  <p className="list-title">{periodLabel(p.period)}</p>
                  <p className="list-sub">
                    <span>Payé par le client : {formatEuros(p.amount_cents)}</span>
                  </p>
                  {p.reversed ? (
                    <p className="pros-tags">
                      <span className="chip chip-red">Remboursé au client · commission reprise</span>
                    </p>
                  ) : null}
                </div>
                {p.commission_cents !== null ? (
                  <span className={`deal-com-pos num${p.reversed ? ' is-reversed' : ''}`}>
                    + {formatEuros(p.commission_cents, { always: true })}
                    {p.rate_bps !== null ? <small> ({formatRate(p.rate_bps)})</small> : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="card pros-card deal-details">
        <summary className="h3">Contrat signé</summary>
        <textarea className="deal-contract-text" readOnly aria-label="Texte du contrat signé" value={d.contract_text} rows={12} />
        <figure className="deal-signature">
          <img src={d.signature_png} alt={`Signature de ${d.contact_name}`} />
          <figcaption className="text-small text-2">
            Empreinte SHA-256 : <span className="num deal-hash">{d.contract_sha256}</span>
          </figcaption>
        </figure>
      </details>
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
