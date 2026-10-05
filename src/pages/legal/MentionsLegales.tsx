/*
 * À faire valider par un juriste avant la mise en ligne en production.
 * Brouillon rédigé par l'équipe technique : il ne constitue pas un avis juridique.
 * Les jetons {{À COMPLÉTER : ...}} / {{À VÉRIFIER : ...}} viennent de src/config/site.ts.
 */
import type { ReactElement } from 'react';
import { Fill } from '../../components/Fill';
import { LegalPage } from '../../components/LegalPage';
import { ENTITY, HOST, MEDIATOR } from '../../config/site';

export function MentionsLegalesPage(): ReactElement {
  return (
    <LegalPage
      title="Mentions légales"
      intro={
        <p>
          Informations prévues par l’article 6 de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l’économie numérique (LCEN) et par le
          Code de la consommation.
        </p>
      }
      sections={[
        {
          id: 'editeur',
          title: 'Éditeur du site',
          body: (
            <dl>
              <dt>Éditeur</dt>
              <dd>{ENTITY.legalName}, entrepreneur individuel. Le service est exploité sous la marque « {ENTITY.brand} ».</dd>
              <dt>Statut</dt>
              <dd>{ENTITY.legalForm}</dd>
              <dt>Adresse</dt>
              <dd>
                <Fill value={ENTITY.address} />
              </dd>
              <dt>SIRET</dt>
              <dd>
                <Fill value={ENTITY.siret} />
              </dd>
              <dt>Immatriculation</dt>
              <dd>
                <Fill value={ENTITY.registry} />
              </dd>
              <dt>TVA</dt>
              <dd>
                <Fill value={ENTITY.vat} />
              </dd>
              <dt>Email</dt>
              <dd>
                <Fill value={ENTITY.email} />
              </dd>
              <dt>Téléphone</dt>
              <dd>
                <Fill value={ENTITY.phone} />
              </dd>
            </dl>
          ),
        },
        {
          id: 'publication',
          title: 'Directeur de la publication',
          body: <p>{ENTITY.legalName}, en qualité d’entrepreneur individuel éditeur du site.</p>,
        },
        {
          id: 'hebergement',
          title: 'Hébergement',
          body: (
            <>
              <dl>
                <dt>Hébergeur du site</dt>
                <dd>{HOST.name}</dd>
                <dt>Adresse</dt>
                <dd>
                  <Fill value={HOST.address} />
                </dd>
                <dt>Téléphone</dt>
                <dd>
                  <Fill value={HOST.phone} />
                </dd>
                <dt>Site internet</dt>
                <dd>
                  <a href={HOST.website}>{HOST.website.replace('https://', '')}</a>
                </dd>
              </dl>
              <p>
                Les données de la liste d’attente sont stockées dans une base de données hébergée par Supabase, dans une région de l’Union
                européenne. La liste complète des prestataires figure dans la <a href="/confidentialite#destinataires">politique de confidentialité</a>.
              </p>
            </>
          ),
        },
        {
          id: 'propriete',
          title: 'Propriété intellectuelle',
          body: (
            <>
              <p>
                Les textes, la marque et le logo Stacker, les visuels, les scripts et les contenus de formation sont protégés par le droit de la
                propriété intellectuelle. Toute reproduction ou diffusion, totale ou partielle, sans autorisation écrite de l’éditeur est interdite.
              </p>
              <p>
                Polices de caractères : Inter et Inter Display (SIL Open Font License 1.1), Instrument Serif (SIL Open Font License 1.1). Icônes
                dérivées de Lucide (licence ISC).
              </p>
            </>
          ),
        },
        {
          id: 'signalement',
          title: 'Signaler un contenu ou un abus',
          body: (
            <p>
              Pour signaler un contenu illicite, un abus (par exemple un démarchage non conforme réalisé au nom de Stacker) ou exercer un droit
              d’opposition, écris à <Fill value={ENTITY.email} />. Indique l’adresse de la page ou le message concerné, et la raison du signalement.
            </p>
          ),
        },
        {
          id: 'mediation',
          title: 'Médiation de la consommation',
          body: (
            <>
              <p>
                Conformément aux articles L611-1 et suivants du Code de la consommation, tout consommateur peut recourir gratuitement au médiateur
                de la consommation dont relève l’éditeur, après lui avoir adressé une réclamation écrite et au plus tard un an après celle-ci :
              </p>
              <dl>
                <dt>Médiateur</dt>
                <dd>
                  <Fill value={MEDIATOR.name} />
                </dd>
                <dt>Adresse</dt>
                <dd>
                  <Fill value={MEDIATOR.address} />
                </dd>
                <dt>Site internet</dt>
                <dd>
                  <Fill value={MEDIATOR.website} />
                </dd>
              </dl>
            </>
          ),
        },
      ]}
    />
  );
}
