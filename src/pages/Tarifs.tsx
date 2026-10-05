import type { ReactElement } from 'react';
import { Icon } from '../components/Icon';
import { PageShell } from '../components/Layout';
import { AVAILABILITY_SENTENCE, AvailabilityTimeline, Faq, JoinCta, LaunchOfferCard, PricingCard, SectionHeading, TierList } from '../components/Sections';
import { PRODUCT } from '../config/site';
import { Island } from '../islands/Island';
import { FAQ_BILLING } from '../site/faq';

export function TarifsPage(): ReactElement {
  return (
    <PageShell current="tarifs">
      <section className="site-section hero-section" aria-labelledby="tarifs-title">
        <div className="site-container">
          <SectionHeading
            level="h1"
            id="tarifs-title"
            eyebrow="Tarifs"
            title={
              <>
                Un abonnement. <span className="serif-accent">{PRODUCT.priceMonthlyLabel}</span> par mois.
              </>
            }
            lead="Prix TTC, sans engagement. Logiciel de prospection, scripts et aide pour les appels, formation complète : tout est inclus."
          />
          <div className="mt-6 min-h-9">
            <Island name="waitlist-count" props={{ variant: 'pill' }} as="span" />
          </div>
          <div className="mt-12 grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
            <PricingCard headingLevel="h2" />
            <LaunchOfferCard headingLevel="h2" />
          </div>
        </div>
      </section>

      <section className="site-section bg-bg-2" aria-labelledby="commissions-title">
        <div className="site-container grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
          <SectionHeading
            id="commissions-title"
            eyebrow="Commissions"
            title="De 15 % à 25 % selon ton niveau."
            lead="Une commission sur chaque vente, chaque mois tant que ton client reste abonné. Aucun montant de gain n’est promis : tout dépend des clients que tu apportes."
          />
          <TierList />
        </div>
      </section>

      <section className="site-section" id="disponibilite" aria-labelledby="dispo-title">
        <div className="site-container grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              id="dispo-title"
              eyebrow="Disponibilité"
              title={
                <>
                  Quand ta commission <span className="serif-accent">arrive</span>.
                </>
              }
              lead="Tu la suis en temps réel. Elle n’est versée qu’une fois le paiement de ton client encaissé."
            />
            <div className="card card-flat mt-8 flex gap-3">
              <Icon name="info" className="mt-0.5 shrink-0 text-ink-2" size={20} />
              <p className="text-sm text-ink-2">{AVAILABILITY_SENTENCE}</p>
            </div>
          </div>
          <div className="card">
            <AvailabilityTimeline />
          </div>
        </div>
      </section>

      <section className="site-section bg-bg-2" aria-labelledby="tarifs-faq-title">
        <div className="site-container grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <SectionHeading id="tarifs-faq-title" eyebrow="Questions fréquentes" title="Abonnement et commissions" />
          <Faq items={FAQ_BILLING} />
        </div>
      </section>

      <JoinCta id="tarifs-cta-title" />
    </PageShell>
  );
}
