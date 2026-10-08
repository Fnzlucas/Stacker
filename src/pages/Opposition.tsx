import type { ReactElement } from 'react';
import { Icon } from '../components/Icon';
import { PageShell } from '../components/Layout';
import { ENTITY } from '../config/site';
import { Island } from '../islands/Island';

/**
 * Page publique d'opposition à la prospection (lien présent dans chaque
 * email préparé par un stacker, et formulaire). Adressée aux entreprises :
 * vouvoiement.
 */
export function OppositionPage(): ReactElement {
  return (
    <PageShell current="none">
      <section className="site-section hero-section" aria-label="Ne plus être contacté">
        <div className="site-container site-container-narrow grid gap-8">
          <Island name="opposition-form" props={{}} />
          <div className="grid gap-4 text-2">
            <h2 className="h3 text-ink">Qui vous a contacté ?</h2>
            <p>
              Un apporteur d’affaires indépendant qui présente les services de Stacker (site internet, avis Google, publications Instagram,
              visibilité sur Google) aux entreprises. Stacker est édité par {ENTITY.legalName}.
            </p>
            <p>
              Les informations sur votre entreprise (nom, activité, adresse) proviennent du registre public SIRENE de l’INSEE. Votre demande est
              définitive et s’applique à tous les apporteurs d’affaires de Stacker. Nous conservons seulement une empreinte chiffrée de votre SIREN
              et de votre adresse, jamais en clair, pour pouvoir la respecter.
            </p>
            <p className="flex items-center gap-2">
              <Icon name="shield" />
              <span>
                Vos droits et nos engagements : <a className="link" href="/confidentialite">politique de confidentialité</a> · Une question :{' '}
                <a className="link" href="/contact">contact</a>
              </span>
            </p>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
