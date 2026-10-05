/*
 * À faire valider par un juriste avant la mise en ligne en production.
 * Brouillon rédigé par l'équipe technique : il ne constitue pas un avis juridique.
 * Les jetons {{À COMPLÉTER : ...}} / {{À VÉRIFIER : ...}} viennent de src/config/site.ts.
 */
import type { ReactElement } from 'react';
import { Fill } from '../../components/Fill';
import { LegalPage } from '../../components/LegalPage';
import { ENTITY, LAUNCH_OFFER, MEDIATOR, PRODUCT } from '../../config/site';

export function CgvPage(): ReactElement {
  return (
    <LegalPage
      title="Conditions générales de vente de l’abonnement stacker"
      intro={
        <p>
          Ces conditions s’appliquent à l’abonnement Stacker souscrit par une personne (le « stacker ») pour utiliser l’application. Elles ne
          concernent pas les services vendus aux entreprises clientes, qui font l’objet de conditions de vente distinctes acceptées par chaque
          entreprise avant sa commande.
        </p>
      }
      sections={[
        {
          id: 'vendeur',
          title: '1. Vendeur',
          body: (
            <p>
              {ENTITY.legalName}, entrepreneur individuel (micro-entreprise), exploitant la marque Stacker, <Fill value={ENTITY.address} />,
              SIRET <Fill value={ENTITY.siret} />, email <Fill value={ENTITY.email} />, téléphone <Fill value={ENTITY.phone} /> (ci-après
              « Stacker »).
            </p>
          ),
        },
        {
          id: 'service',
          title: '2. Contenu de l’abonnement',
          body: (
            <>
              <p>L’abonnement donne accès, pendant toute sa durée, à :</p>
              <ul>
                <li>un logiciel de prospection intégré, qui trouve des entreprises et aide à les contacter ;</li>
                <li>des scripts et une aide pour les appels ;</li>
                <li>une formation complète.</li>
              </ul>
              <p>
                L’abonnement ne promet aucun revenu. Les commissions éventuelles relèvent du contrat d’apporteur d’affaires conclu séparément et
                dépendent uniquement des ventes réellement conclues et encaissées. Les caractéristiques essentielles du service sont présentées
                sur la page <a href="/tarifs">Tarifs</a> et dans l’application avant la souscription.
              </p>
            </>
          ),
        },
        {
          id: 'prix',
          title: '3. Prix',
          body: (
            <>
              <p>
                Le prix de l’abonnement est de <strong>{PRODUCT.priceMonthlyLabel} TTC par mois</strong>. <Fill value={ENTITY.vat} />. Aucun frais
                d’inscription ni de résiliation n’est facturé.
              </p>
              <p>
                Le prix applicable est celui affiché au moment de la souscription. Toute évolution du prix est notifiée par email au moins 30 jours
                avant son application ; le stacker qui la refuse peut résilier sans frais avant son entrée en vigueur.
              </p>
            </>
          ),
        },
        {
          id: 'offre-lancement',
          title: `4. Offre de lancement des ${String(LAUNCH_OFFER.seats)} premiers`,
          body: (
            <>
              <p>
                <strong>Places.</strong> L’offre de lancement est réservée aux {LAUNCH_OFFER.seats} premiers stackers. Les personnes inscrites sur
                la liste d’attente avant l’ouverture ont priorité sur ces {LAUNCH_OFFER.seats} places.
              </p>
              <p>
                <strong>Conditions.</strong> Les bénéficiaires paient l’abonnement {PRODUCT.priceMonthlyLabel} TTC par mois, et Stacker ne
                prélève aucun pourcentage sur leur chiffre d’affaires (0 %).
              </p>
              <p>
                <strong>Durée.</strong> <Fill value={LAUNCH_OFFER.duration} />.
              </p>
              <p>
                <strong>Après les {LAUNCH_OFFER.seats} premiers.</strong> Le tarif évoluera pour les stackers suivants. Les nouvelles conditions
                seront affichées avant toute souscription.
              </p>
              <p>L’offre est personnelle et non cessible, et limitée à une par personne.</p>
            </>
          ),
        },
        {
          id: 'souscription',
          title: '5. Souscription',
          body: (
            <>
              <p>
                L’abonnement se souscrit dans l’application, depuis un compte personnel réservé aux personnes majeures. Avant de payer, le stacker
                visualise le récapitulatif (service, prix, durée, modalités de résiliation et de rétractation), accepte les présentes conditions
                et confirme sa commande par un bouton mentionnant clairement l’obligation de payer. Une confirmation reprenant ces informations lui
                est envoyée par email.
              </p>
              <p>Aucun abonnement ne démarre sans action expresse du stacker. L’inscription sur la liste d’attente est gratuite.</p>
            </>
          ),
        },
        {
          id: 'paiement',
          title: '6. Paiement',
          body: (
            <p>
              Le paiement est traité par un prestataire de paiement agréé ; Stacker n’a jamais accès aux numéros de carte bancaire. Le premier
              mois est payé à la souscription, les mois suivants à la même date chaque mois, par le moyen de paiement enregistré. En cas d’échec de
              paiement, Stacker en informe le stacker ; à défaut de régularisation, l’accès aux outils peut être suspendu. Les commissions déjà
              acquises ne sont pas affectées.
            </p>
          ),
        },
        {
          id: 'resiliation',
          title: '7. Durée et résiliation',
          body: (
            <>
              <p>
                L’abonnement est conclu sans engagement de durée, pour des périodes d’un mois renouvelées automatiquement. Il peut être résilié à
                tout moment, sans frais ni justification :
              </p>
              <ul>
                <li>
                  depuis le profil, avec la fonctionnalité « Résilier mon abonnement », accessible directement, conformément à l’article
                  L215-1-1 du Code de la consommation ;
                </li>
                <li>
                  ou par email à <Fill value={ENTITY.email} />.
                </li>
              </ul>
              <p>
                La résiliation prend effet à la fin de la période mensuelle en cours, déjà payée, jusqu’à laquelle l’accès est maintenu. Aucun
                nouveau paiement n’est prélevé. Une confirmation de résiliation est envoyée par email.
              </p>
            </>
          ),
        },
        {
          id: 'retractation',
          title: '8. Droit de rétractation de 14 jours',
          body: (
            <>
              <p>
                Le stacker consommateur dispose d’un délai de <strong>14 jours</strong> à compter de la souscription pour se rétracter, sans avoir
                à se justifier ni à payer de pénalité (articles L221-18 et suivants du Code de la consommation).
              </p>
              <p>
                <strong>Accès immédiat.</strong> Pour accéder aux outils dès la souscription, le stacker demande expressément que le service
                commence avant la fin du délai de rétractation, en cochant une case dédiée. S’il se rétracte ensuite, il paie uniquement le montant
                proportionnel au service fourni jusqu’à la communication de sa décision (article L221-25), et le reste lui est remboursé.
              </p>
              <p>
                <strong>Comment se rétracter.</strong> Par une déclaration dénuée d’ambiguïté envoyée à <Fill value={ENTITY.email} />, ou à l’aide
                du formulaire type de la page <a href="/remboursement">politique de remboursement</a>. Le remboursement intervient au plus tard 14
                jours après la réception de la décision, par le même moyen de paiement que celui utilisé lors de la souscription.
              </p>
            </>
          ),
        },
        {
          id: 'conformite',
          title: '9. Conformité du service',
          body: (
            <p>
              Stacker est tenu de fournir un service conforme au contrat et répond des défauts de conformité des contenus et services numériques
              dans les conditions des articles L224-25-12 et suivants du Code de la consommation. En cas de défaut, le stacker peut demander la mise
              en conformité, puis, à défaut, une réduction de prix ou la résolution du contrat.
            </p>
          ),
        },
        {
          id: 'responsabilite',
          title: '10. Responsabilité',
          body: (
            <p>
              Stacker répond de la bonne exécution du service. Sa responsabilité ne peut être engagée en cas de manquement du stacker, de fait d’un
              tiers ou de force majeure. Stacker ne s’engage ni sur un nombre de prospects, ni sur un nombre de ventes, ni sur un niveau de revenu.
            </p>
          ),
        },
        {
          id: 'reclamations',
          title: '11. Service client et réclamations',
          body: (
            <p>
              Pour toute question ou réclamation : <Fill value={ENTITY.email} /> ou <Fill value={ENTITY.phone} />. Stacker accuse réception des
              réclamations et y répond dans les meilleurs délais.
            </p>
          ),
        },
        {
          id: 'mediation',
          title: '12. Médiation',
          body: (
            <p>
              Après une réclamation écrite adressée à Stacker, et au plus tard un an après celle-ci, le stacker consommateur peut recourir
              gratuitement au médiateur de la consommation : <Fill value={MEDIATOR.name} />, <Fill value={MEDIATOR.address} />,{' '}
              <Fill value={MEDIATOR.website} />.
            </p>
          ),
        },
        {
          id: 'droit',
          title: '13. Droit applicable',
          body: (
            <p>
              Les présentes conditions sont soumises au droit français. Le consommateur peut saisir, à son choix, la juridiction du lieu où il
              demeurait au moment de la conclusion du contrat ou de la survenance du fait dommageable.
            </p>
          ),
        },
      ]}
    />
  );
}
