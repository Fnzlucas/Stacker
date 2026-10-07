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
  phone: todo('téléphone'),
} as const;

export const HOST = {
  name: 'Vercel Inc.',
  address: '440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis',
  // LCEN art. 6 III 1° : le numéro de téléphone de l'hébergeur est obligatoire.
  phone: toVerify('téléphone de l’hébergeur, à relever sur vercel.com/legal'),
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
  /** Abonnement stacker, prix final (franchise en base de TVA). */
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
  duration: 'L’offre de lancement s’applique pendant 12 mois à compter de la souscription',
} as const;
