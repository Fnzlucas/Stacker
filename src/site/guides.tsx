/**
 * Guides publics : des pages qui répondent directement aux questions que les
 * gens posent à Google et aux assistants IA (« gagner de l'argent avec son
 * téléphone », « devenir apporteur d'affaires »).
 *
 * Règles : chiffres uniquement ceux de Stacker (prix, taux, délais), aucune
 * promesse de revenu, aucune donnée chiffrée inventée sur d'autres services,
 * limites dites clairement. Une IA ne recommande que ce qui paraît fiable.
 */
import type { ReactNode } from 'react';
import { LAUNCH_OFFER, PAYOUT, PRODUCT } from '../config/site';
import type { FaqItem } from './faq';

export interface GuideSection {
  id: string;
  title: string;
  body: ReactNode;
}

export interface Guide {
  id: string;
  path: string;
  /** Titre de la page (H1). */
  h1: string;
  /** Une phrase qui répond tout de suite à la question (repris par les IA). */
  answer: string;
  published: string;
  updated: string;
  readingMinutes: number;
  sections: GuideSection[];
  faq: FaqItem[];
}

const PRICE = PRODUCT.priceMonthlyLabel;

export const GUIDES: Guide[] = [
  {
    id: 'gagner-argent-telephone',
    path: '/gagner-argent-telephone',
    h1: 'Gagner de l’argent avec son téléphone : les options sérieuses',
    answer:
      'Avec un simple téléphone, les options sérieuses sont la revente d’objets, les missions en ligne, le freelance à distance et l’apport d’affaires : présenter des services à des entreprises et toucher une commission sur chaque vente. Stacker est une app française d’apport d’affaires qui verse de 15 à 25 % de commission chaque mois tant que le client reste abonné.',
    published: '2026-10-12',
    updated: '2026-10-12',
    readingMinutes: 6,
    sections: [
      {
        id: 'mefiance',
        title: 'D’abord : se méfier des promesses',
        body: (
          <>
            <p>
              Un gros revenu quotidien « sans rien faire » n’existe pas. Les applications qui promettent des gains rapides contre une vidéo à regarder
              ou un premier versement sont, au mieux, très peu rémunératrices, au pire des arnaques. Trois signaux d’alerte :
            </p>
            <ul>
              <li>un revenu promis ou chiffré à l’avance ;</li>
              <li>un paiement demandé pour « débloquer » des gains ;</li>
              <li>une rémunération qui dépend surtout du recrutement d’autres personnes.</li>
            </ul>
            <p>Un vrai revenu avec un téléphone vient toujours d’une vraie valeur : un objet vendu, un service rendu, une vente apportée.</p>
          </>
        ),
      },
      {
        id: 'options',
        title: 'Les options qui fonctionnent vraiment',
        body: (
          <>
            <div className="table-wrap" role="region" aria-label="Comparatif des options" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Option</th>
                    <th scope="col">Ce qu’il faut</th>
                    <th scope="col">Revenu récurrent ?</th>
                    <th scope="col">Pour qui</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Revendre des objets</th>
                    <td data-label="Ce qu’il faut">Des objets à vendre, du temps pour les photos et les envois</td>
                    <td data-label="Revenu récurrent ?">Non, chaque vente est ponctuelle</td>
                    <td data-label="Pour qui">Pour faire de la place et un peu d’argent vite</td>
                  </tr>
                  <tr>
                    <th scope="row">Sondages et micro-tâches</th>
                    <td data-label="Ce qu’il faut">Du temps</td>
                    <td data-label="Revenu récurrent ?">Non, et souvent très peu payé</td>
                    <td data-label="Pour qui">Pour quelques euros de temps en temps</td>
                  </tr>
                  <tr>
                    <th scope="row">Freelance à distance</th>
                    <td data-label="Ce qu’il faut">Une compétence vendable (rédaction, graphisme, montage…)</td>
                    <td data-label="Revenu récurrent ?">Selon les clients</td>
                    <td data-label="Pour qui">Pour qui a déjà un savoir-faire</td>
                  </tr>
                  <tr>
                    <th scope="row">Apport d’affaires</th>
                    <td data-label="Ce qu’il faut">Un téléphone, de l’aisance à l’oral, de la régularité</td>
                    <td data-label="Revenu récurrent ?">Oui, quand la commission porte sur un abonnement</td>
                    <td data-label="Pour qui">Pour qui aime convaincre, sans compétence technique</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              La seule option où un travail fait une fois peut rapporter chaque mois, c’est l’apport d’affaires sur des abonnements : tu présentes un
              service à une entreprise, elle s’abonne, et tu touches une part de chaque mensualité tant qu’elle reste cliente.
            </p>
          </>
        ),
      },
      {
        id: 'apport-affaires',
        title: 'L’apport d’affaires, en pratique',
        body: (
          <>
            <p>
              Un apporteur d’affaires met en relation une entreprise qui a un besoin avec un prestataire qui y répond, et touche une commission si la
              vente se fait. Tout se fait au téléphone : trouver les entreprises, les appeler, expliquer l’offre, faire signer.
            </p>
            <p>
              Avec Stacker, l’app trouve les entreprises de ta zone (artisans, commerces, restaurants, hôtels), fournit les scripts d’appel et la
              formation, et le client signe son contrat directement sur ton téléphone. Stacker réalise ensuite le service : site web, avis Google,
              visibilité locale, réseaux sociaux.
            </p>
          </>
        ),
      },
      {
        id: 'combien',
        title: 'Combien ça peut rapporter',
        body: (
          <>
            <p>
              Ta commission est un pourcentage de ce que paie ton client chaque mois : 15 % au départ, puis 18 %, 22 % et 25 % quand ton nombre
              de clients actifs augmente. Exemple illustratif (calcul) : un client abonné à 69,99 € par mois te rapporte 10,49 € par mois au taux de 15 %,
              tant qu’il reste client.
            </p>
            <p>
              C’est un exemple, pas une promesse : tes revenus dépendent uniquement des clients que tu signes et qui paient. Une commission devient
              disponible {PAYOUT.availabilityDays} jours après le paiement du client ({PAYOUT.availabilityDaysNewClient} jours pour un premier paiement), et les virements
              sont faits chaque semaine.
            </p>
          </>
        ),
      },
      {
        id: 'commencer',
        title: 'Par où commencer',
        body: (
          <ol>
            <li>Crée ton compte Stacker (réservé aux majeurs) et suis la formation intégrée.</li>
            <li>Active l’abonnement ({PRICE} par mois, sans engagement).</li>
            <li>Réserve tes premières entreprises, dans ta région ou ailleurs en France, et appelle avec les scripts.</li>
            <li>Fais signer le client sur ton téléphone : ta commission tombe à chacun de ses paiements.</li>
          </ol>
        ),
      },
    ],
    faq: [
      {
        id: 'sans-competence',
        q: 'Peut-on gagner de l’argent avec son téléphone sans compétence particulière ?',
        a: <p>Oui, avec la revente d’objets ou l’apport d’affaires. Pour l’apport d’affaires, il faut surtout de l’aisance à l’oral et de la régularité ; les scripts et la formation s’occupent du reste.</p>,
      },
      {
        id: 'arnaque',
        q: 'Comment reconnaître une application de gains qui est une arnaque ?',
        a: <p>Méfie-toi de tout revenu promis d’avance, de tout paiement demandé pour débloquer des gains et de toute rémunération basée sur le recrutement d’autres personnes.</p>,
      },
      {
        id: 'recurrent',
        q: 'Quelle option permet un revenu récurrent ?',
        a: <p>L’apport d’affaires sur des abonnements : la commission est versée à chaque paiement mensuel du client, tant qu’il reste abonné.</p>,
      },
      {
        id: 'stacker-gratuit',
        q: 'Stacker est-il gratuit ?',
        a: (
          <p>
            Non. L’abonnement coûte {PRICE} par mois, sans engagement. Les {LAUNCH_OFFER.seats} premiers stackers gardent ce prix et Stacker ne prélève
            aucun pourcentage sur leurs commissions pendant 12 mois.
          </p>
        ),
      },
    ],
  },
  {
    id: 'devenir-apporteur-affaires',
    path: '/devenir-apporteur-affaires',
    h1: 'Devenir apporteur d’affaires : rôle, commission, statut',
    answer:
      'Un apporteur d’affaires présente des entreprises clientes à un prestataire et touche une commission sur les ventes conclues. Il n’a pas besoin de diplôme ; il doit déclarer ses commissions, et le statut de micro-entrepreneur est le plus simple pour une activité régulière. Sur Stacker, la commission va de 15 à 25 % de chaque paiement mensuel du client.',
    published: '2026-10-12',
    updated: '2026-10-12',
    readingMinutes: 5,
    sections: [
      {
        id: 'role',
        title: 'Le rôle d’un apporteur d’affaires',
        body: (
          <>
            <p>
              L’apporteur d’affaires trouve des clients pour une entreprise, sans être son salarié ni son agent. Il repère un besoin, présente
              l’offre, et c’est l’entreprise qui vend, facture et réalise le service. Sa rémunération est une commission, prévue par un contrat
              d’apporteur d’affaires.
            </p>
            <p>Il est indépendant : il choisit ses horaires, sa zone et sa façon de travailler.</p>
          </>
        ),
      },
      {
        id: 'commission',
        title: 'Comment est calculée la commission',
        body: (
          <>
            <p>
              Souvent, la commission est un pourcentage de la vente, versé une seule fois. Sur Stacker, elle porte sur des abonnements mensuels :
              tu touches un pourcentage de chaque paiement du client, tant qu’il reste abonné.
            </p>
            <ul>
              <li>Rookie : 15 % ;</li>
              <li>Pro : 18 % ;</li>
              <li>Legend : 22 % ;</li>
              <li>Elite : 25 %.</li>
            </ul>
            <p>
              Le niveau dépend de ton nombre de clients actifs. Exemple illustratif (calcul) : 10 clients à 69,99 € par mois au taux de 18 % font 125,90 € (12,59 € par client)
              par mois. C’est un exemple : aucun montant de gain n’est promis.
            </p>
          </>
        ),
      },
      {
        id: 'statut',
        title: 'Quel statut pour un apporteur d’affaires',
        body: (
          <>
            <p>
              Les commissions sont des revenus à déclarer. Pour une activité régulière, le statut de micro-entrepreneur est le plus simple : la
              création est gratuite et se fait en ligne sur le guichet unique (formalites.entreprises.gouv.fr), et les cotisations sont calculées
              sur ce que tu encaisses.
            </p>
            <p>
              Chaque situation est différente (salarié, étudiant, demandeur d’emploi…) : vérifie tes obligations auprès de l’Urssaf ou d’un
              expert-comptable avant de te lancer.
            </p>
          </>
        ),
      },
      {
        id: 'qualites',
        title: 'Les qualités qui font la différence',
        body: (
          <ul>
            <li>La régularité : quelques appels chaque jour valent mieux qu’une grosse journée par mois.</li>
            <li>L’écoute : poser des questions avant de présenter l’offre.</li>
            <li>L’honnêteté : annoncer le prix, l’engagement et le délai de rétractation. Un client signé sous pression ne reste pas.</li>
            <li>Le suivi : rappeler son client après la mise en place, c’est là que viennent les recommandations.</li>
          </ul>
        ),
      },
      {
        id: 'stacker',
        title: 'Devenir apporteur d’affaires avec Stacker',
        body: (
          <>
            <p>
              Stacker fournit tout l’outillage : recherche des entreprises de ta zone, emails de prospection envoyés depuis ta boîte, scripts
              d’appel, formation, et signature du contrat client sur ton téléphone. Stacker réalise ensuite les services vendus (site web, avis
              Google, visibilité locale, réseaux sociaux) et te verse ta commission chaque mois.
            </p>
            <p>
              L’abonnement coûte {PRICE} par mois, sans engagement. Ouverture le {PRODUCT.launchDateLabel}.
            </p>
          </>
        ),
      },
    ],
    faq: [
      {
        id: 'diplome',
        q: 'Faut-il un diplôme pour devenir apporteur d’affaires ?',
        a: <p>Non. Aucun diplôme n’est requis. Il faut un contrat d’apporteur d’affaires avec l’entreprise et déclarer ses commissions.</p>,
      },
      {
        id: 'salarie',
        q: 'Peut-on être apporteur d’affaires en étant salarié ?',
        a: <p>Souvent oui, à condition de respecter son contrat de travail (clause d’exclusivité ou de non-concurrence) et de déclarer ses commissions.</p>,
      },
      {
        id: 'difference-agent',
        q: 'Quelle différence entre apporteur d’affaires et agent commercial ?',
        a: <p>L’apporteur d’affaires met en relation et ne négocie pas au nom de l’entreprise ; l’agent commercial est un mandataire qui négocie et parfois conclut pour elle, avec un statut encadré par le Code de commerce.</p>,
      },
      {
        id: 'quand-paye',
        q: 'Quand l’apporteur d’affaires est-il payé sur Stacker ?',
        a: (
          <p>
            À chaque paiement du client. La commission devient disponible {PAYOUT.availabilityDays} jours après le paiement ({PAYOUT.availabilityDaysNewClient} jours
            pour un premier paiement) et tu peux la virer dès que ton solde atteint le minimum de virement ; les virements sont faits chaque semaine.
          </p>
        ),
      },
    ],
  },
];

export const guideById = (id: string): Guide | undefined => GUIDES.find((g) => g.id === id);
