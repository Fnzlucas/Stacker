import type { ReactElement, ReactNode } from 'react';
import { LAUNCH_OFFER, PAYOUT, PRODUCT, TIERS } from '../config/site';
import { Island } from '../islands/Island';
import { frenchSpaces } from '../lib/format';
import { Icon, type IconName } from './Icon';
import { Ransom } from './Ransom';

/* ------------------------------------------------------------------------ */
/* Niveaux de commission                                                     */
/* ------------------------------------------------------------------------ */

export function TierList(): ReactElement {
  return (
    <ol className="list" aria-label="Taux de commission par niveau">
      {TIERS.map((tier, i) => (
        <li key={tier.id}>
          <div className="list-row">
            <span className={`level level-${tier.id}`}>
              <span className="level-mark">
                <Icon name={tier.icon} />
              </span>
              {tier.name}
            </span>
            <span className="list-main">
              <span className="list-sub">Niveau {i + 1}</span>
            </span>
            <span className="tier-rate num">{tier.rate} %</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------------ */
/* Disponibilité des commissions                                             */
/* ------------------------------------------------------------------------ */

export const AVAILABILITY_SENTENCE = `Ta commission est visible dès la signature. Elle devient disponible ${String(PAYOUT.availabilityDays)} jours après l’encaissement effectif du paiement de ton client (${String(PAYOUT.availabilityDaysNewClient)} jours pour un nouveau client), puis elle est versée avec le virement groupé de la semaine.`;

export const AVAILABILITY_STEPS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'check',
    title: 'Signature',
    text: 'Ta commission apparaît dans l’app dès que le client signe. Tu la suis en temps réel.',
  },
  {
    icon: 'clock',
    title: 'Encaissement et délai',
    text: `Elle devient disponible ${String(PAYOUT.availabilityDays)} jours après l’encaissement effectif du paiement du client, ${String(PAYOUT.availabilityDaysNewClient)} jours pour un nouveau client.`,
  },
  {
    icon: 'euro',
    title: 'Versement hebdomadaire',
    text: 'Les commissions disponibles sont versées par virement, regroupées une fois par semaine.',
  },
];

export function AvailabilityTimeline(): ReactElement {
  return (
    <ol className="timeline">
      {AVAILABILITY_STEPS.map((step, i) => (
        <li key={step.title}>
          <span className="timeline-dot" aria-hidden="true">
            {i + 1}
          </span>
          <div>
            <h3 className="h3">{step.title}</h3>
            <p className="text-2 mt-1">{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------------ */
/* Abonnement                                                                */
/* ------------------------------------------------------------------------ */

export const INCLUDED: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'search',
    title: 'Logiciel de prospection intégré',
    text: 'L’app trouve les entreprises de ta zone et t’aide à les contacter.',
  },
  {
    icon: 'phone',
    title: 'Scripts et aide pour les appels',
    text: 'Quoi dire, comment répondre aux objections, comment conclure.',
  },
  {
    icon: 'graduation',
    title: 'Formation complète',
    text: 'Pour démarrer sans expérience de la vente et progresser à ton rythme.',
  },
];

export function PricingCard({ headingLevel = 'h3' }: { headingLevel?: 'h2' | 'h3' }): ReactElement {
  const Heading = headingLevel;
  return (
    <article className="card card-hero h-full" aria-labelledby="pricing-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="eyebrow">Abonnement stacker</span>
        <span className="chip chip-green">Sans engagement</span>
      </div>
      <Heading id="pricing-title" className="mt-4 flex flex-wrap items-baseline gap-x-2">
        <span className="price-amount num">{PRODUCT.priceMonthlyLabel}</span>
        <span className="text-md text-ink-2">TTC par mois</span>
      </Heading>
      <ul className="tick-list mt-6">
        {INCLUDED.map((item) => (
          <li key={item.title}>
            <span className="tick">
              <Icon name="check" />
            </span>
            <span>
              <b className="font-semibold">{item.title}.</b> <span className="text-ink-2">{item.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-small mt-6">
        Résiliable à tout moment depuis ton profil. Droit de rétractation de 14 jours. Détails dans les{' '}
        <a className="font-semibold text-ink underline" href="/cgv">
          conditions de vente
        </a>
        .
      </p>
    </article>
  );
}

/* ------------------------------------------------------------------------ */
/* Offre de lancement des 100 premiers                                       */
/* ------------------------------------------------------------------------ */

export function LaunchOfferCard({ headingLevel = 'h3' }: { headingLevel?: 'h2' | 'h3' }): ReactElement {
  const Heading = headingLevel;
  return (
    <article className="card card-hero card-dark grain-local grain h-full overflow-hidden" aria-labelledby="offer-title">
      <span className="eyebrow text-on-dark-2">Offre de lancement</span>
      <Heading id="offer-title" className="mt-5">
        <Ransom text={`Les ${String(LAUNCH_OFFER.seats)} premiers`} className="ransom-fluid justify-start" />
      </Heading>
      <ul className="tick-list mt-6 text-on-dark">
        <li>
          <span className="tick">
            <Icon name="check" />
          </span>
          <span>
            <b className="font-semibold">{PRODUCT.priceMonthlyLabel} par mois</b>
          </span>
        </li>
        <li>
          <span className="tick">
            <Icon name="check" />
          </span>
          <span>
            <b className="font-semibold">0 % prélevé sur ton chiffre d’affaires</b>
          </span>
        </li>
        <li>
          <span className="tick">
            <Icon name="check" />
          </span>
          <span>
            <b className="font-semibold">Priorité aux inscrits</b> de la liste d’attente sur les {LAUNCH_OFFER.seats} places
          </span>
        </li>
      </ul>
      <p className="mt-6 text-sm text-on-dark-2">
        Le tarif évoluera après les {LAUNCH_OFFER.seats} premiers.{' '}
        <a className="font-semibold text-on-dark underline" href="/cgv#offre-lancement">
          Conditions de l’offre
        </a>
      </p>
      <div className="mt-6">
        <Island name="waitlist-count" props={{ variant: 'dark' }} as="span" />
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------------ */
/* FAQ                                                                       */
/* ------------------------------------------------------------------------ */

export function Faq({ items }: { items: { q: string; a: ReactNode }[] }): ReactElement {
  return (
    <div className="faq">
      {items.map((item) => (
        <details key={item.q}>
          <summary>
            <span>{frenchSpaces(item.q)}</span>
            <Icon name="chevron-down" />
          </summary>
          <div className="faq-body">{item.a}</div>
        </details>
      ))}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  id,
  level = 'h2',
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  id: string;
  level?: 'h1' | 'h2';
}): ReactElement {
  const Heading = level;
  return (
    <div className="max-w-2xl">
      <span className="eyebrow">{eyebrow}</span>
      <Heading id={id} className={level === 'h1' ? 'display hero-title mt-4' : 'section-title mt-3'}>
        {title}
      </Heading>
      {lead ? <p className="lead mt-4">{lead}</p> : null}
    </div>
  );
}

/** Bandeau d'appel à l'action vers la liste d'attente (fin de page). */
export function JoinCta({ id }: { id: string }): ReactElement {
  return (
    <section className="site-section" aria-labelledby={id}>
      <div className="site-container">
        <div className="card card-hero text-center">
          <h2 id={id} className="section-title">
            Ouverture le {PRODUCT.launchDateLabel}.
          </h2>
          <p className="lead mx-auto mt-4 max-w-xl">
            Inscris-toi sur la liste d’attente : c’est gratuit, sans engagement, et les inscrits ont priorité sur les {LAUNCH_OFFER.seats} places de
            l’offre de lancement.
          </p>
          <a className="btn btn-primary btn-lg mt-8" href="/liste-attente">
            Rejoindre la liste d’attente
            <Icon name="arrow-right" />
          </a>
        </div>
      </div>
    </section>
  );
}
