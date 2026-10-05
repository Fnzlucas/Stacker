import type { ReactElement } from 'react';
import { Icon } from '../components/Icon';
import { PageShell } from '../components/Layout';
import { LAUNCH_OFFER, PRODUCT } from '../config/site';
import { Island } from '../islands/Island';

export function ListeAttentePage(): ReactElement {
  return (
    <PageShell current="liste" ctaHref="#inscription">
      <section className="site-section hero-section" aria-labelledby="liste-title">
        <div className="site-container grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <span className="eyebrow">Liste d’attente</span>
            <h1 id="liste-title" className="display hero-title mt-4">
              Prends ta place <span className="serif-accent">avant l’ouverture</span>.
            </h1>
            <p className="lead mt-5 max-w-xl">
              Stacker ouvre le {PRODUCT.launchDateLabel}. Les inscrits sont prévenus par email, dans l’ordre d’inscription, et ont priorité sur
              les {LAUNCH_OFFER.seats} places de l’offre de lancement.
            </p>
            <div className="mt-6 min-h-9">
              <Island name="waitlist-count" props={{ variant: 'pill' }} as="span" />
            </div>
            <ul className="tick-list mt-8 max-w-xl">
              <li>
                <span className="tick">
                  <Icon name="trophy" />
                </span>
                <span>
                  <b className="font-semibold">Offre de lancement des {LAUNCH_OFFER.seats} premiers</b> : {PRODUCT.priceMonthlyLabel} par mois et 0 %
                  prélevé sur ton chiffre d’affaires. Le tarif évoluera après les {LAUNCH_OFFER.seats} premiers.{' '}
                  <a className="font-semibold text-ink underline" href="/cgv#offre-lancement">
                    Conditions
                  </a>
                </span>
              </li>
              <li>
                <span className="tick">
                  <Icon name="mail" />
                </span>
                <span>
                  <b className="font-semibold">Ta position tout de suite</b>, confirmée par email.
                </span>
              </li>
              <li>
                <span className="tick">
                  <Icon name="shield" />
                </span>
                <span>
                  <b className="font-semibold">Gratuit et sans engagement</b> : aucun moyen de paiement demandé.
                </span>
              </li>
            </ul>
          </div>
          <div id="inscription" className="scroll-anchor">
            <Island name="waitlist-form" props={{ context: 'page' }} />
          </div>
        </div>
      </section>
    </PageShell>
  );
}
