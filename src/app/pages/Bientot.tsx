import type { ReactElement } from 'react';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { AVAILABILITY_STEPS } from '../../components/Sections';
import { AppBar, usePageTitle } from '../components/Layouts';
import { FeatureList, LevelPill, SoonScreen } from '../components/Ui';
import { useProfile, useTiers } from '../lib/queries';

export function DealsPage(): ReactElement {
  usePageTitle('Deals');
  return (
    <div className="app-container">
      <AppBar title="Deals" />
      <SoonScreen icon="briefcase" title="Tes deals arrivent" text="Quand une entreprise est prête à signer, tu la transmettras d’ici. Stacker s’occupe du contrat et du paiement." />
      <h2 className="h2 app-section-title">Ce qui arrive</h2>
      <FeatureList
        items={[
          { icon: 'send', title: 'Transmettre un client prêt à signer', text: 'Tu choisis l’offre et tu indiques le SIRET et les coordonnées de l’entreprise.' },
          { icon: 'signature', title: 'Signature sur le téléphone du client', text: 'Ton client reçoit un lien sécurisé et signe lui-même, sur son propre téléphone.' },
          { icon: 'check-circle', title: 'Suivi de chaque deal', text: 'Envoyé, signé, payé : tu suis chaque étape en temps réel.' },
        ]}
      />
    </div>
  );
}

export function GainsPage(): ReactElement {
  usePageTitle('Gains');
  const profile = useProfile();
  const tiers = useTiers();
  return (
    <div className="app-container">
      <AppBar title="Gains" />
      <section className="balance" aria-labelledby="gains-balance">
        <div className="balance-deco" aria-hidden="true">
          <Logo tile={false} size={168} />
        </div>
        <h2 id="gains-balance" className="balance-label">
          <Icon name="check-circle" size={20} />
          Commissions acquises
        </h2>
        <p className="home-balance-empty">Aucune pour l’instant</p>
        <dl className="balance-split">
          <div>
            <dt>En validation</dt>
            <dd>Aucune</dd>
          </div>
          <div>
            <dt>Prochain virement</dt>
            <dd>Aucun prévu</dd>
          </div>
        </dl>
        <p className="home-balance-text mt-4">Ton historique et tes relevés de commissions apparaîtront ici dès ta première vente encaissée.</p>
      </section>

      <section className="card card-hero" aria-labelledby="rates-title">
        <h2 id="rates-title" className="h2">
          Ton taux de commission
        </h2>
        <p className="text-2 mt-2">Un pourcentage du prix payé par chaque client que tu apportes, chaque mois, tant qu’il reste abonné.</p>
        {tiers.data ? (
          <ul className="tier-rows mt-5">
            {tiers.data.map((t) => (
              <li key={t.code} className={t.code === profile.data?.tier ? 'is-current' : undefined}>
                <LevelPill tier={t} />
                <span className="text-small">
                  {t.code === profile.data?.tier ? 'Ton niveau · ' : ''}
                  {t.max_active_clients === null ? `${String(t.min_active_clients)}+ clients actifs` : `${String(t.min_active_clients)} à ${String(t.max_active_clients)} clients actifs`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="skeleton skeleton-text mt-5 w-full" aria-hidden="true" />
        )}
        {tiers.data?.some((t) => t.criteria_provisional) ? (
          <p className="form-note mt-4">
            <Icon name="info" />
            <span>Seuils provisoires, confirmés dans le contrat d’apporteur avant l’ouverture des ventes.</span>
          </p>
        ) : null}
      </section>

      <section className="card card-hero" aria-labelledby="rules-title">
        <h2 id="rules-title" className="h2">
          Quand tu es payé
        </h2>
        <ol className="timeline mt-5">
          {AVAILABILITY_STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="timeline-dot" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <h3 className="font-semibold text-ink">{s.title}</h3>
                <p className="text-2 mt-1 text-sm">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="form-note mt-5">
          <Icon name="info" />
          <span>Aucun montant n’est promis : tes commissions dépendent uniquement des clients que tu apportes et qui paient.</span>
        </p>
      </section>
    </div>
  );
}
