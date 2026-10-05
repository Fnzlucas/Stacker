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
  address: todo('adresse'),
  siret: todo('SIRET'),
  registry: todo('immatriculation (RNE)'),
  vat: todo('mention TVA, par ex. « TVA non applicable, art. 293 B du CGI »'),
  email: todo('email de contact'),
  phone: todo('téléphone'),
} as const;

export const HOST = {
  name: 'Vercel Inc.',
  address: toVerify('440 N Barranca Ave #4133, Covina, CA 91723, États-Unis'),
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
  /** Abonnement stacker, prix TTC. */
  priceMonthlyLabel: '6,99\u00a0€',
  /** Version des CGU / CGV / politique de confidentialité (horodatée dans `consents`). */
  legalVersion: '2026-10-05',
  legalUpdatedLabel: '5 octobre 2026',
} as const;

/** Niveaux et taux de commission. Les critères de passage figurent dans le contrat d'apporteur. */
export const TIERS = [
  { id: 'rookie', name: 'Rookie', rate: 15, icon: 'graduation' },
  { id: 'pro', name: 'Pro', rate: 18, icon: 'star' },
  { id: 'legend', name: 'Legend', rate: 22, icon: 'flame' },
  { id: 'elite', name: 'Elite', rate: 25, icon: 'trophy' },
] as const;

/** Règle de disponibilité des commissions (verdict Lead, C3). */
export const PAYOUT = {
  availabilityDays: 14,
  availabilityDaysNewClient: 30,
} as const;

/** Offre de lancement. Sa durée n'est pas encore fixée : jeton dans les CGV. */
export const LAUNCH_OFFER = {
  seats: 100,
  duration: todo('durée de l’offre de lancement'),
} as const;
