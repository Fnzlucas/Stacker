import type { ReactNode } from 'react';
import { LAUNCH_OFFER, PAYOUT, PRODUCT } from '../config/site';

export interface FaqItem {
  id: string;
  q: string;
  a: ReactNode;
}

export const FAQ_GENERAL: FaqItem[] = [
  {
    id: 'vendre',
    q: 'Concrètement, qu’est-ce que je vends ?',
    a: (
      <p>
        Des services pour les entreprises : site web, avis Google, posts Instagram, visibilité Google. C’est Stacker qui les réalise. Toi, tu
        trouves l’entreprise intéressée et tu la convaincs ; elle signe ensuite son contrat directement avec Stacker.
      </p>
    ),
  },
  {
    id: 'contact-auto',
    q: 'L’app contacte-t-elle les entreprises à ma place ?',
    a: (
      <p>
        Non. L’app trouve les entreprises et t’aide à les contacter, avec des scripts et une aide pour les appels. C’est toi qui appelles et qui
        convaincs.
      </p>
    ),
  },
  {
    id: 'gains',
    q: 'Combien vais-je gagner ?',
    a: (
      <>
        <p>
          Nous ne promettons aucun montant. Tes commissions dépendent uniquement des clients que tu apportes et du nombre de clients qui restent
          abonnés.
        </p>
        <p>
          Les règles, elles, sont fixes : de 15 % à 25 % de commission selon ton niveau, chaque mois tant que ton client reste abonné.
        </p>
      </>
    ),
  },
  {
    id: 'versement',
    q: 'Quand ma commission est-elle disponible ?',
    a: (
      <>
        <p>
          Elle est visible dans l’app dès la signature du client. Elle devient disponible {PAYOUT.availabilityDays} jours après l’encaissement
          effectif du paiement de ton client ({PAYOUT.availabilityDaysNewClient} jours pour un nouveau client).
        </p>
        <p>Les commissions disponibles sont versées par virement, regroupées une fois par semaine.</p>
      </>
    ),
  },
  {
    id: 'resiliation-client',
    q: 'Que se passe-t-il si mon client arrête son abonnement ?',
    a: <p>Ta commission s’arrête avec son abonnement : elle n’est due que sur les paiements réellement encaissés par Stacker.</p>,
  },
  {
    id: 'prix',
    q: 'Combien coûte l’abonnement ?',
    a: (
      <p>
        {PRODUCT.priceMonthlyLabel} par mois. Il comprend le logiciel de prospection intégré, les scripts et l’aide pour les appels, et la
        formation complète. Il est sans engagement et résiliable à tout moment.
      </p>
    ),
  },
  {
    id: 'offre',
    q: `Qu’est-ce que l’offre des ${String(LAUNCH_OFFER.seats)} premiers ?`,
    a: (
      <>
        <p>
          Les {LAUNCH_OFFER.seats} premiers stackers paient {PRODUCT.priceMonthlyLabel} par mois et Stacker ne prélève rien sur leur chiffre
          d’affaires : 0 %. Les inscrits de la liste d’attente ont priorité sur ces {LAUNCH_OFFER.seats} places.
        </p>
        <p>
          Le tarif évoluera après les {LAUNCH_OFFER.seats} premiers. Les conditions de l’offre sont dans les{' '}
          <a href="/cgv#offre-lancement">conditions de vente</a>.
        </p>
      </>
    ),
  },
  {
    id: 'statut',
    q: 'Ai-je besoin d’un statut ?',
    a: (
      <p>
        Tu es responsable de la déclaration de tes revenus. Si tu apportes des affaires de façon régulière, un statut, par exemple la
        micro-entreprise, est en général nécessaire. Les conditions exactes figureront dans le contrat d’apporteur d’affaires que tu accepteras
        avant ta première vente.
      </p>
    ),
  },
  {
    id: 'particuliers',
    q: 'Puis-je proposer ces services à des particuliers ?',
    a: <p>Non. Stacker vend uniquement à des professionnels : entreprises, commerçants, artisans, indépendants.</p>,
  },
  {
    id: 'majeur',
    q: 'Faut-il être majeur ?',
    a: <p>Oui. Stacker est réservé aux personnes majeures.</p>,
  },
  {
    id: 'resilier',
    q: 'Comment résilier mon abonnement ?',
    a: (
      <p>
        Depuis ton profil, à tout moment, sans frais. Tu disposes aussi d’un droit de rétractation de 14 jours : voir la page{' '}
        <a href="/remboursement">remboursement</a>.
      </p>
    ),
  },
  {
    id: 'donnees',
    q: 'Que faites-vous de mes données ?',
    a: (
      <p>
        Le strict nécessaire pour gérer la liste d’attente et te prévenir de l’ouverture. Elles ne sont jamais vendues. Tout est expliqué dans la{' '}
        <a href="/confidentialite">politique de confidentialité</a>.
      </p>
    ),
  },
];

/** Sous-ensemble affiché sur la page Tarifs. */
export const FAQ_BILLING_IDS = ['prix', 'offre', 'versement', 'gains', 'resilier'] as const;
export const FAQ_BILLING: FaqItem[] = FAQ_BILLING_IDS.map((id) => {
  const item = FAQ_GENERAL.find((f) => f.id === id);
  if (!item) throw new Error(`FAQ inconnue : ${id}`);
  return item;
});
