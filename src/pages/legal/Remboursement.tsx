/*
 * À faire valider par un juriste avant la mise en ligne en production.
 * Brouillon rédigé par l'équipe technique : il ne constitue pas un avis juridique.
 * Les jetons {{À COMPLÉTER : ...}} / {{À VÉRIFIER : ...}} viennent de src/config/site.ts.
 */
import type { ReactElement } from 'react';
import { Fill } from '../../components/Fill';
import { LegalPage } from '../../components/LegalPage';
import { ENTITY, MEDIATOR, PRODUCT } from '../../config/site';

export function RemboursementPage(): ReactElement {
  return (
    <LegalPage
      title="Politique de remboursement"
      intro={
        <p>
          Ce que tu peux demander, dans quels délais, et comment. Cette page complète les <a href="/cgv">conditions générales de vente</a> de
          l’abonnement.
        </p>
      }
      sections={[
        {
          id: 'liste',
          title: '1. Liste d’attente',
          body: <p>L’inscription sur la liste d’attente est gratuite : aucun paiement n’est demandé, il n’y a donc rien à rembourser.</p>,
        },
        {
          id: 'retractation',
          title: '2. Droit de rétractation de 14 jours',
          body: (
            <>
              <p>
                Tu peux te rétracter de ton abonnement pendant <strong>14 jours</strong> à compter de sa souscription, sans justification ni
                pénalité.
              </p>
              <ul>
                <li>
                  <strong>Si tu n’as pas demandé l’accès immédiat</strong> : tu es remboursé intégralement.
                </li>
                <li>
                  <strong>Si tu as demandé l’accès immédiat aux outils</strong> (case cochée à la souscription) : tu paies seulement la part du mois
                  correspondant aux jours écoulés jusqu’à ta demande de rétractation, et le reste t’est remboursé (article L221-25 du Code de la
                  consommation).
                </li>
              </ul>
              <p className="callout">
                <strong>Exemple illustratif</strong> : abonnement de {PRODUCT.priceMonthlyLabel} TTC pour une période de 30 jours, rétractation
                le 6e jour après 5 jours d’accès. Montant conservé : 6,99 € × 5 / 30 = 1,17 €. Montant remboursé : 5,82 €.
              </p>
            </>
          ),
        },
        {
          id: 'comment',
          title: '3. Comment te rétracter',
          body: (
            <>
              <p>
                Envoie une déclaration claire à <Fill value={ENTITY.email} />, depuis l’adresse de ton compte, par exemple en reprenant le formulaire
                ci-dessous. Tu peux aussi l’envoyer par courrier à <Fill value={ENTITY.address} />. Nous accusons réception sans délai.
              </p>
              <p>
                Le remboursement est effectué au plus tard <strong>14 jours</strong> après la réception de ta décision, avec le même moyen de
                paiement que celui utilisé pour la souscription, sans frais pour toi.
              </p>
            </>
          ),
        },
        {
          id: 'formulaire',
          title: '4. Formulaire type de rétractation',
          body: (
            <div className="model-form">
              <p>
                <em>(Complète et renvoie ce formulaire uniquement si tu souhaites te rétracter du contrat.)</em>
              </p>
              <p>
                À l’attention de {ENTITY.legalName}, entrepreneur individuel, éditeur de Stacker, <Fill value={ENTITY.address} />,{' '}
                <Fill value={ENTITY.email} /> :
              </p>
              <p>
                Je vous notifie par la présente ma rétractation du contrat portant sur la prestation de services ci-dessous : abonnement à
                l’application Stacker.
              </p>
              <ul>
                <li>Souscrit le : ……………………</li>
                <li>Nom et prénom : ……………………</li>
                <li>Adresse email du compte : ……………………</li>
                <li>Adresse postale : ……………………</li>
                <li>Date : ……………………</li>
                <li>Signature (uniquement en cas d’envoi sur papier) : ……………………</li>
              </ul>
            </div>
          ),
        },
        {
          id: 'resiliation',
          title: '5. Résiliation après 14 jours',
          body: (
            <p>
              Après le délai de rétractation, tu peux résilier à tout moment en 3 clics depuis ton profil. La résiliation prend effet à la fin de la
              période mensuelle déjà payée, jusqu’à laquelle tu gardes l’accès : cette période n’est pas remboursée au prorata, et aucun nouveau
              paiement n’est prélevé.
            </p>
          ),
        },
        {
          id: 'erreur',
          title: '6. Paiement en double ou erroné',
          body: (
            <p>
              Si tu constates un paiement en double ou un montant qui ne correspond pas à ton abonnement, écris à <Fill value={ENTITY.email} /> :
              le montant indûment perçu est remboursé intégralement, sur le moyen de paiement utilisé, dès la vérification faite.
            </p>
          ),
        },
        {
          id: 'entreprises',
          title: '7. Entreprises clientes',
          body: (
            <p>
              Les conditions de rétractation, de résiliation et de remboursement des services achetés par les entreprises figurent dans les conditions
              de vente que chaque entreprise accepte avant sa commande.
            </p>
          ),
        },
        {
          id: 'litige',
          title: '8. En cas de désaccord',
          body: (
            <p>
              Écris-nous d’abord à <Fill value={ENTITY.email} />. Si notre réponse ne te satisfait pas, tu peux saisir gratuitement le médiateur de
              la consommation : <Fill value={MEDIATOR.name} />, <Fill value={MEDIATOR.website} />.
            </p>
          ),
        },
      ]}
    />
  );
}
