/*
 * À faire valider par un juriste avant la mise en ligne en production.
 * Brouillon rédigé par l'équipe technique : il ne constitue pas un avis juridique.
 * Les jetons {{À COMPLÉTER : ...}} / {{À VÉRIFIER : ...}} viennent de src/config/site.ts.
 */
import type { ReactElement } from 'react';
import { Fill } from '../../components/Fill';
import { LegalPage } from '../../components/LegalPage';
import { ENTITY, LAUNCH_OFFER, MEDIATOR, PAYOUT, PRODUCT, TIERS } from '../../config/site';

export function CguPage(): ReactElement {
  return (
    <LegalPage
      title="Conditions générales d’utilisation"
      intro={
        <p>
          Ces conditions encadrent l’utilisation du site Stacker, de sa liste d’attente et de l’application Stacker. Elles s’appliquent à toute
          personne qui s’inscrit. L’abonnement payant est régi en plus par les <a href="/cgv">conditions générales de vente</a>, et l’apport
          d’affaires par un contrat d’apporteur d’affaires distinct.
        </p>
      }
      sections={[
        {
          id: 'objet',
          title: '1. Objet et documents applicables',
          body: (
            <>
              <p>
                Stacker est un service édité par {ENTITY.legalName}, entrepreneur individuel (micro-entreprise), qui l’exploite sous la marque
                « Stacker » (ci-après « Stacker », « nous »), dont les coordonnées figurent dans les <a href="/mentions-legales">mentions légales</a>.
              </p>
              <p>Les relations entre Stacker et l’utilisateur sont régies, par ordre de priorité décroissant, par :</p>
              <ol>
                <li>le contrat d’apporteur d’affaires, accepté dans l’application avant toute présentation d’une entreprise cliente ;</li>
                <li>les conditions générales de vente de l’abonnement, en cas de souscription ;</li>
                <li>les présentes conditions générales d’utilisation (CGU) ;</li>
                <li>la politique de confidentialité, qui décrit le traitement des données personnelles.</li>
              </ol>
            </>
          ),
        },
        {
          id: 'definitions',
          title: '2. Définitions',
          body: (
            <dl>
              <dt>Utilisateur</dt>
              <dd>Toute personne qui consulte le site, s’inscrit sur la liste d’attente ou utilise l’application.</dd>
              <dt>Stacker (apporteur d’affaires)</dt>
              <dd>Utilisateur qui présente des entreprises à Stacker en vue de la vente des services de Stacker, contre une commission.</dd>
              <dt>Entreprise cliente</dt>
              <dd>Professionnel (entreprise, commerçant, artisan, profession libérale) qui achète un service à Stacker.</dd>
              <dt>Client payant actif</dt>
              <dd>Entreprise cliente présentée par le stacker, dont l’abonnement est en cours et dont le dernier paiement dû a été encaissé par Stacker.</dd>
              <dt>Liste d’attente</dt>
              <dd>Liste des personnes inscrites avant l’ouverture de l’application, classées par ordre chronologique d’inscription.</dd>
            </dl>
          ),
        },
        {
          id: 'acces',
          title: '3. Conditions d’accès',
          body: (
            <>
              <p>Pour s’inscrire, l’utilisateur doit :</p>
              <ul>
                <li>être une personne physique âgée d’au moins 18 ans et capable de contracter ; Stacker est réservé aux personnes majeures ;</li>
                <li>fournir des informations exactes et une adresse email qui lui appartient ;</li>
                <li>n’utiliser qu’une seule inscription et, à l’ouverture, qu’un seul compte.</li>
              </ul>
              <p>
                Stacker peut refuser ou supprimer une inscription manifestement frauduleuse (inscriptions automatisées, adresses fictives,
                inscriptions multiples d’une même personne) ou celle d’une personne mineure. La personne concernée en est informée par email
                lorsque c’est possible.
              </p>
            </>
          ),
        },
        {
          id: 'liste-attente',
          title: '4. Liste d’attente',
          body: (
            <>
              <p>
                L’inscription sur la liste d’attente est gratuite et n’engage à rien. Elle donne une position, déterminée par l’ordre chronologique
                d’inscription, et un lien personnel de parrainage. Une nouvelle inscription avec la même adresse email ne crée pas de seconde
                position : la position existante est conservée.
              </p>
              <p>
                L’ouverture publique est prévue le {PRODUCT.launchDateLabel}. Les invitations sont envoyées par email, par vagues successives, dans
                l’ordre de la liste. Cette date est prévisionnelle ; un report éventuel est annoncé par email et n’ouvre droit à aucune indemnité,
                l’inscription étant gratuite.
              </p>
              <p>
                Les personnes inscrites ont priorité sur les {LAUNCH_OFFER.seats} places de l’offre de lancement, dans les conditions de l’
                <a href="/cgv#offre-lancement">article 4 des conditions générales de vente</a>.
              </p>
              <p>
                Le lien de parrainage sert uniquement à savoir qui a fait connaître Stacker. Il ne donne droit à aucune rémunération, à aucun
                avantage et ne modifie aucune position. Tout éventuel programme de parrainage rémunéré ferait l’objet de règles écrites publiées à
                l’avance, et ne pourrait porter que sur des ventes réellement encaissées auprès d’entreprises, jamais sur des inscriptions ou des
                abonnements de personnes parrainées.
              </p>
              <p>
                L’utilisateur peut quitter la liste à tout moment en le demandant à <Fill value={ENTITY.email} /> ; ses données sont alors
                supprimées.
              </p>
            </>
          ),
        },
        {
          id: 'offre-lancement',
          title: `5. Offre de lancement des ${String(LAUNCH_OFFER.seats)} premiers`,
          body: (
            <p>
              Les {LAUNCH_OFFER.seats} premiers stackers bénéficient d’un abonnement à {PRODUCT.priceMonthlyLabel} par mois et d’un prélèvement de
              0 % sur leur chiffre d’affaires. Les inscrits de la liste d’attente ont priorité sur ces places. Le tarif évoluera après les{' '}
              {LAUNCH_OFFER.seats} premiers. Les conditions complètes figurent à l’
              <a href="/cgv#offre-lancement">article 4 des conditions générales de vente</a>.
            </p>
          ),
        },
        {
          id: 'application',
          title: '6. Fonctionnement de l’application',
          body: (
            <>
              <p>
                L’application fournit un outil de recherche d’entreprises à partir de données publiques, un suivi des prospects, des scripts et
                modèles de messages, une formation et le suivi des commissions. Elle ne contacte aucune entreprise à la place du stacker : les
                appels et messages sont passés par le stacker lui-même, depuis ses propres moyens de communication.
              </p>
              <p>
                <strong>Stacker est le seul vendeur.</strong> Les services (site web, collecte d’avis, publications sur les réseaux sociaux,
                visibilité locale) sont vendus, facturés, encaissés et réalisés par Stacker. Le stacker n’a aucun pouvoir de représentation : il ne
                signe rien au nom de Stacker et n’encaisse aucune somme. L’entreprise cliente accepte elle-même son contrat, depuis son propre
                appareil.
              </p>
              <p>
                <strong>Commissions.</strong> Les commissions sont régies par le contrat d’apporteur d’affaires. À titre d’information :
              </p>
              <ul>
                <li>
                  le taux dépend du niveau du stacker :{' '}
                  {TIERS.map((t) => `${t.name} ${String(t.rate)} %`).join(', ')}. Les critères de passage d’un niveau à l’autre sont fixés par le
                  contrat d’apporteur d’affaires ;
                </li>
                <li>la commission est récurrente : elle est due chaque mois tant que l’entreprise cliente reste abonnée ;</li>
                <li>
                  une commission est visible dès la signature du client et devient disponible {PAYOUT.availabilityDays} jours après l’encaissement
                  effectif du paiement correspondant ({PAYOUT.availabilityDaysNewClient} jours pour un nouveau client). Les commissions disponibles
                  sont versées par virements groupés hebdomadaires ;
                </li>
                <li>
                  en cas d’impayé, de remboursement, de contestation de prélèvement ou de rétractation du client, la commission correspondante est
                  annulée et, si elle a déjà été versée, déduite des commissions suivantes ;
                </li>
                <li>aucun revenu n’est promis : les commissions dépendent uniquement des ventes conclues et du maintien des abonnements des clients.</li>
              </ul>
              <p>
                Les missions, points d’expérience et badges de l’application sont des outils de motivation. Ils sont facultatifs, ne
                conditionnent aucune rémunération et n’entraînent aucune sanction.
              </p>
            </>
          ),
        },
        {
          id: 'conduite',
          title: '7. Règles de prospection et de conduite',
          body: (
            <>
              <p>Le stacker s’engage à :</p>
              <ul>
                <li>ne démarcher que des professionnels, sur leurs coordonnées professionnelles, et jamais des consommateurs ;</li>
                <li>
                  se présenter comme apporteur d’affaires indépendant pour Stacker, et respecter sans délai toute demande d’une entreprise de ne
                  plus être contactée (liste d’opposition) ;
                </li>
                <li>
                  ne faire aucune promesse que Stacker ne tient pas : aucun classement, nombre d’avis, note ou résultat ne peut être promis à une entreprise ;
                </li>
                <li>
                  ne jamais solliciter de faux avis ni d’avis sélectionnés, et ne jamais publier d’avis lui-même ;
                </li>
                <li>
                  ne pas utiliser de logiciel d’envoi automatisé, de robot ou de messages en masse (emails, SMS, messages privés sur les réseaux
                  sociaux) ;
                </li>
                <li>
                  ne jamais saisir les coordonnées bancaires d’une entreprise, signer ou valider un paiement à sa place, ni recevoir d’argent de sa
                  part ;
                </li>
                <li>
                  ne pas se présenter lui-même, ni un proche agissant pour son compte, comme entreprise cliente dans le but de générer des
                  commissions.
                </li>
              </ul>
              <p>
                Tout manquement peut entraîner la suspension du compte, l’annulation des commissions liées aux ventes concernées et, si nécessaire,
                la résiliation du contrat d’apporteur d’affaires.
              </p>
            </>
          ),
        },
        {
          id: 'statut',
          title: '8. Statut et obligations du stacker',
          body: (
            <>
              <p>
                Le stacker exerce en toute indépendance : il organise librement son activité et n’est lié à Stacker par aucun lien de
                subordination. Il est responsable de ses obligations sociales et fiscales. Une activité d’apport d’affaires régulière impose une
                immatriculation (par exemple le statut de micro-entrepreneur) et la déclaration des revenus perçus.
              </p>
              <p>
                Avant le premier virement, Stacker demande l’identité, l’adresse et un IBAN au nom du stacker, ainsi que les informations relatives
                à son statut prévues par le contrat d’apporteur d’affaires.
              </p>
            </>
          ),
        },
        {
          id: 'donnees',
          title: '9. Données personnelles',
          body: (
            <p>
              Les traitements de données personnelles sont décrits dans la <a href="/confidentialite">politique de confidentialité</a>. Le
              consentement à recevoir des emails d’information est facultatif, distinct de l’acceptation des présentes CGU, et peut être retiré à tout
              moment.
            </p>
          ),
        },
        {
          id: 'propriete',
          title: '10. Propriété intellectuelle',
          body: (
            <p>
              Les scripts, modèles, contenus de formation et éléments de l’application sont la propriété de Stacker. Le stacker bénéficie d’un droit
              d’usage personnel, non exclusif et non cessible, limité à son activité d’apporteur d’affaires pour Stacker et à la durée de son compte.
              Toute reproduction, revente ou diffusion à des tiers est interdite.
            </p>
          ),
        },
        {
          id: 'responsabilite',
          title: '11. Disponibilité et responsabilité',
          body: (
            <>
              <p>
                Stacker met en œuvre des moyens raisonnables pour assurer l’accès au site et à l’application, sans s’engager sur une disponibilité
                ininterrompue. Des interruptions peuvent avoir lieu pour maintenance ou en cas d’incident.
              </p>
              <p>
                Stacker n’est pas responsable des décisions des entreprises démarchées, ni des pertes de revenus espérés. Rien dans les présentes
                n’exclut ni ne limite la responsabilité de Stacker envers un consommateur lorsque la loi l’interdit.
              </p>
            </>
          ),
        },
        {
          id: 'suspension',
          title: '12. Suspension et fermeture du compte',
          body: (
            <p>
              L’utilisateur peut fermer son compte ou quitter la liste d’attente à tout moment. Stacker peut suspendre ou fermer un compte en cas de
              manquement grave aux présentes CGU, après en avoir informé l’utilisateur et lui avoir permis de présenter ses observations, sauf urgence
              (fraude, atteinte aux droits de tiers). Les commissions acquises et non contestées restent dues dans les conditions du contrat
              d’apporteur d’affaires.
            </p>
          ),
        },
        {
          id: 'modification',
          title: '13. Modification des CGU',
          body: (
            <p>
              Stacker peut modifier les présentes CGU. Les modifications importantes sont notifiées par email ou dans l’application au moins 30 jours
              avant leur entrée en vigueur ; l’utilisateur qui les refuse peut fermer son compte sans frais avant cette date. La version applicable
              et sa date figurent en haut de cette page.
            </p>
          ),
        },
        {
          id: 'droit',
          title: '14. Droit applicable, médiation et litiges',
          body: (
            <>
              <p>
                Les présentes CGU sont soumises au droit français. En cas de difficulté, l’utilisateur peut écrire à <Fill value={ENTITY.email} />.
                Le consommateur peut ensuite recourir gratuitement au médiateur de la consommation : <Fill value={MEDIATOR.name} />,{' '}
                <Fill value={MEDIATOR.website} />.
              </p>
              <p>
                À défaut d’accord amiable, le litige est porté devant les juridictions compétentes. Le consommateur peut saisir, à son choix, la
                juridiction du lieu où il demeurait au moment de la conclusion du contrat ou de la survenance du fait dommageable.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
