/**
 * Données éditoriales et légales centralisées : une seule source pour le
 * site, les pages légales et les tests.
 *
 * Règle : aucune information inventée. Ce qui n'est pas encore connu est un
 * jeton « {{À COMPLÉTER : ...}} » (ou « {{À VÉRIFIER : ...}} ») affiché
 * surligné sur le site, listé par le build, et qui bloque un déploiement de
 * production Vercel tant qu'il en reste un (scripts/build.mjs).
 * Liste à jour : qa/LOT1_RAPPORT.md, section « Ce que Lucas doit compléter ».
 */

export const TODO_MARKERS = ['{{À COMPLÉTER', '{{À VÉRIFIER'] as const;

export const todo = (what: string): string => `{{À COMPLÉTER : ${what}}}`;
export const toVerify = (what: string): string => `{{À VÉRIFIER : ${what}}}`;

export const isTodo = (value: string): boolean => TODO_MARKERS.some((marker) => value.startsWith(marker));

/** Éditeur du site et vendeur de l'abonnement. */
export const ENTITY = {
  legalName: 'Lucas Fernandez',
  legalForm: 'Entrepreneur individuel (EI), régime de la micro-entreprise',
  brand: 'Stacker',
  address: '4 impasse Jean Roussière, 30400 Villeneuve-lès-Avignon, France',
  siret: '891 139 248 00027',
  registry: 'Immatriculé au Registre national des entreprises (RNE), SIREN 891 139 248',
  vat: 'TVA non applicable, art. 293 B du CGI',
  email: 'stacker-contact@outlook.com',
  phone: '07 50 98 33 67',
} as const;

export const HOST = {
  name: 'Vercel Inc.',
  address: '440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis',
  // LCEN art. 6 III 1° : le numéro de téléphone de l'hébergeur est obligatoire.
  // Relevé sur vercel.com/legal/dmca-policy (12 octobre 2026).
  phone: '+1 559 288 7060',
  website: 'https://vercel.com',
} as const;

export const MEDIATOR = {
  name: todo('médiateur de la consommation'),
  address: todo('adresse du médiateur'),
  website: todo('site du médiateur'),
} as const;

export const PRODUCT = {
  name: 'Stacker',
  launchDateLabel: '20\u00a0octobre\u00a02026',
  launchDateISO: '2026-10-20',
  /** Prix d'entrée (formule Pro), prix finals (franchise en base de TVA). */
  priceFromLabel: '9,99\u00a0€',
  /** Version des CGU / CGV / politique de confidentialité (horodatée dans `consents`). */
  legalVersion: '2026-10-05',
  legalUpdatedLabel: '5 octobre 2026',
} as const;

/** Formule gratuite : faire signer ses clients et toucher ses commissions, sans abonnement. */
export const FREE_PLAN = {
  id: 'gratuit',
  name: 'Gratuit',
  text: 'Tu fais signer tes clients sur ton téléphone et tu touches tes commissions, aux mêmes taux. Sans Academy ni logiciel de prospection.',
} as const;

/** Offres sur mesure payées en une fois (gros tickets) : commission sur le prix total. */
export const BIG_TICKET = {
  text: 'Des offres sur mesure payées en une fois par le client (site sur mesure, application mobile, assistant IA qui répond aux appels, campagne publicitaire, image de marque, transformation digitale complète) : ta commission porte alors sur le prix total.',
} as const;

/** Les trois formules payantes, en option (prix par mois, finals, franchise en base de TVA). */
export const PLANS = [
  {
    id: 'pro',
    name: 'Pro',
    price: '9,99\u00a0€',
    text: 'Le logiciel de prospection : recherche d’entreprises de ta zone, campagnes d’emails depuis ta boîte, fiches prospects et scripts.',
  },
  {
    id: 'academy',
    name: 'Academy',
    price: '12,99\u00a0€',
    text: 'Apprends à convaincre : appels d’entraînement face à des commerçants joués par une IA, note sur 100 et conseils, formation complète en 13 modules.',
  },
  {
    id: 'duo',
    name: 'Academy + Pro',
    price: '14,99\u00a0€',
    text: 'Les deux : entraîne-toi en continu et prospecte pour de vrai.',
  },
] as const;

/** Niveaux et taux de commission. Les critères de passage figurent dans le contrat d'apporteur. */
export const TIERS = [
  { id: 'rookie', name: 'Rookie', rate: 15, icon: 'graduation' },
  { id: 'pro', name: 'Pro', rate: 18, icon: 'star' },
  { id: 'legend', name: 'Legend', rate: 22, icon: 'flame' },
  { id: 'elite', name: 'Elite', rate: 25, icon: 'trophy' },
] as const;

/** Règle de disponibilité des commissions : dès l'encaissement du client ; virement envoyé sous 2 jours ouvrés. */
export const PAYOUT = {
  availabilityDays: 0,
  availabilityDaysNewClient: 0,
  transferBusinessDays: 2,
  /** Au-delà de ce montant versé dans l'année, SIRET obligatoire pour être viré. */
  siretThresholdEuros: 1000,
} as const;

/** Offre de lancement. Sa durée n'est pas encore fixée : jeton dans les CGV. */
export const LAUNCH_OFFER = {
  seats: 100,
  duration: 'L’offre de lancement s’applique pendant 12 mois à compter de la souscription',
} as const;
