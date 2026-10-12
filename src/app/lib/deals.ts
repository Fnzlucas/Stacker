/**
 * Deals et gains : accès aux fonctions serveur (deal_*, my_earnings, payout_*),
 * validation des saisies (miroir des contrôles de la base, qui fait foi),
 * montants et libellés. Chaque réponse est validée par Zod.
 */
import { z } from 'zod';
import { isValidSiret, normalizePhone } from '@shared/account';
import { ApiError } from './apiError';
import type { Backend } from './supabase';

// ---------------------------------------------------------------------------
// Schémas
// ---------------------------------------------------------------------------

export const offerSchema = z.object({
  id: z.string(),
  brand: z.string(),
  category: z.string(),
  description: z.string(),
  name: z.string(),
  price_cents: z.number().int(),
  unit_label: z.string().nullable(),
  qty_min: z.number().int(),
  qty_max: z.number().int(),
  engagement_months: z.number().int(),
  features: z.array(z.string()),
  recommended: z.boolean(),
});
export type Offer = z.infer<typeof offerSchema>;

export const catalogSchema = z.object({ rate_bps: z.number().int(), offers: z.array(offerSchema) });
export type Catalog = z.infer<typeof catalogSchema>;

export const previewSchema = z.object({
  reference: z.string(),
  mandate_ref: z.string(),
  contract_text: z.string(),
  contract_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  monthly_price_cents: z.number().int(),
  rate_bps: z.number().int(),
  commission_cents: z.number().int(),
});
export type DealPreview = z.infer<typeof previewSchema>;

export const signedSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  monthly_price_cents: z.number().int(),
  rate_bps: z.number().int(),
  commission_cents: z.number().int(),
});
export type SignedDeal = z.infer<typeof signedSchema>;

export const DEAL_STATUSES = ['signe', 'actif', 'suspendu', 'resilie', 'annule'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  signe: 'Signé',
  actif: 'Actif',
  suspendu: 'Suspendu',
  resilie: 'Résilié',
  annule: 'Annulé',
};

export const DEAL_STATUS_CHIP: Record<DealStatus, string> = {
  signe: 'chip chip-violet',
  actif: 'chip chip-green',
  suspendu: 'chip chip-orange',
  resilie: 'chip',
  annule: 'chip chip-red',
};

export const dealRowSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: z.enum(DEAL_STATUSES),
  company_name: z.string(),
  offer_label: z.string(),
  monthly_price_cents: z.number().int(),
  signed_at: z.string(),
  activated_at: z.string().nullable(),
  withdrawal_until: z.string(),
  earned_cents: z.number().int(),
});
export type DealRow = z.infer<typeof dealRowSchema>;

export const dealDetailSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: z.enum(DEAL_STATUSES),
  claim_id: z.uuid().nullable(),
  offer: z.object({ brand: z.string(), name: z.string(), engagement_months: z.number().int(), unit_label: z.string().nullable() }).loose(),
  quantity: z.number().int(),
  monthly_price_cents: z.number().int(),
  company_name: z.string(),
  company_siret: z.string(),
  company_address: z.string(),
  contact_name: z.string(),
  contact_role: z.string(),
  contact_email: z.string(),
  contact_phone: z.string(),
  iban_masked: z.string(),
  mandate_ref: z.string(),
  contract_text: z.string(),
  contract_sha256: z.string(),
  signature_png: z.string(),
  signed_at: z.string(),
  withdrawal_until: z.string(),
  activated_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  payments: z.array(
    z.object({
      period: z.string(),
      amount_cents: z.number().int(),
      paid_at: z.string(),
      reversed: z.boolean().default(false),
      commission_cents: z.number().int().nullable(),
      rate_bps: z.number().int().nullable(),
    }),
  ),
});
export type DealDetail = z.infer<typeof dealDetailSchema>;

export const COMMISSION_STATUS_LABELS = { disponible: 'Disponible', demandee: 'Virement demandé', versee: 'Versée' } as const;
export const PAYOUT_STATUS_LABELS = { demande: 'En cours', verse: 'Versé', refuse: 'Refusé' } as const;

export const earningsSchema = z.object({
  rate_bps: z.number().int(),
  available_cents: z.number().int(),
  validating_cents: z.number().int(),
  next_available_at: z.string().nullable(),
  requested_cents: z.number().int(),
  paid_cents: z.number().int(),
  monthly_cents: z.number().int(),
  pending_monthly_cents: z.number().int(),
  signed_count: z.number().int(),
  active_count: z.number().int(),
  min_payout_cents: z.number().int(),
  payout_account: z.object({ holder: z.string(), iban_last4: z.string() }).nullable(),
  entries: z.array(
    z.object({
      id: z.number().int(),
      period: z.string(),
      amount_cents: z.number().int(),
      rate_bps: z.number().int(),
      client_amount_cents: z.number().int(),
      status: z.enum(['disponible', 'demandee', 'versee']),
      created_at: z.string(),
      available_at: z.string(),
      kind: z.enum(['commission', 'reprise', 'abonnement']).default('commission'),
      company_name: z.string().nullable(),
      deal_id: z.uuid().nullable(),
    }),
  ),
  payouts: z.array(
    z.object({
      id: z.uuid(),
      amount_cents: z.number().int(),
      status: z.enum(['demande', 'verse', 'refuse']),
      iban_last4: z.string(),
      requested_at: z.string(),
      processed_at: z.string().nullable(),
    }),
  ),
});
export type Earnings = z.infer<typeof earningsSchema>;

// ---------------------------------------------------------------------------
// Saisie du deal
// ---------------------------------------------------------------------------

export interface DealInput {
  offer_id: string;
  quantity: number;
  siret: string;
  company_name: string;
  company_address: string;
  first_name: string;
  last_name: string;
  role: string;
  email: string;
  phone: string;
  iban_holder: string;
  iban: string;
  accept_terms: boolean;
  accept_mandate: boolean;
  claim_id: string | null;
}

export const emptyDealInput = (): DealInput => ({
  offer_id: '',
  quantity: 1,
  siret: '',
  company_name: '',
  company_address: '',
  first_name: '',
  last_name: '',
  role: 'Gérant',
  email: '',
  phone: '',
  iban_holder: '',
  iban: '',
  accept_terms: false,
  accept_mandate: false,
  claim_id: null,
});

export const normalizeIban = (iban: string): string => iban.replace(/[\s.-]/g, '').toUpperCase();

const IBAN_LENGTHS: Record<string, number> = {
  FR: 27, MC: 27, BE: 16, LU: 20, DE: 22, ES: 24, IT: 27, NL: 18, PT: 25, CH: 21, AT: 20, IE: 22, GP: 27, MQ: 27, GF: 27, RE: 27, YT: 27,
};

/** Miroir de public.iban_is_valid : pays accepté, longueur, clé modulo 97. */
export function isValidIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (IBAN_LENGTHS[iban.slice(0, 2)] !== iban.length) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    rem = /[0-9]/.test(ch) ? (rem * 10 + Number(ch)) % 97 : (rem * 100 + ch.charCodeAt(0) - 55) % 97;
  }
  return rem === 1;
}

/** « FR7630006000011234567890189 » → « FR76 3000 6000 0112 3456 7890 189 ». */
export const formatIban = (iban: string): string => normalizeIban(iban).replace(/(.{4})(?=.)/g, '$1 ');

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export type Step = 'offre' | 'client' | 'paiement';

/** Erreurs de champ d'une étape (mêmes règles que deal_validate). */
export function stepErrors(step: Step, v: DealInput, offer: Offer | undefined): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 'offre') {
    if (!offer) e['offer_id'] = 'Choisis une offre.';
    else if (!Number.isInteger(v.quantity) || v.quantity < offer.qty_min || v.quantity > offer.qty_max)
      e['quantity'] = offer.unit_label
        ? `Entre ${String(offer.qty_min)} et ${String(offer.qty_max)} ${offer.unit_label}s.`
        : `Quantité fixe : ${String(offer.qty_min)}.`;
  }
  if (step === 'client') {
    if (!isValidSiret(v.siret.replace(/\s/g, ''))) e['siret'] = 'SIRET invalide (14 chiffres).';
    if (v.company_name.trim().length < 2) e['company_name'] = 'Indique la raison sociale.';
    if (v.company_address.trim().length < 5) e['company_address'] = 'Indique l’adresse complète.';
    if (!v.first_name.trim()) e['first_name'] = 'Prénom requis.';
    if (!v.last_name.trim()) e['last_name'] = 'Nom requis.';
    if (v.role.trim().length < 2) e['role'] = 'Indique sa fonction.';
    if (!EMAIL_RE.test(v.email.trim().toLowerCase())) e['email'] = 'Adresse email invalide.';
    if (!normalizePhone(v.phone)) e['phone'] = 'Numéro de téléphone invalide.';
  }
  if (step === 'paiement') {
    if (v.iban_holder.trim().length < 2) e['iban_holder'] = 'Indique le titulaire du compte.';
    if (!isValidIban(v.iban)) e['iban'] = 'IBAN invalide : vérifie les chiffres.';
    if (!v.accept_mandate) e['accept_mandate'] = 'Le client doit accepter le prélèvement.';
  }
  return e;
}

/** Corps envoyé au serveur (téléphone en E.164, IBAN normalisé). */
export function toPayload(v: DealInput): Record<string, unknown> {
  return {
    ...v,
    siret: v.siret.replace(/\s/g, ''),
    email: v.email.trim().toLowerCase(),
    phone: normalizePhone(v.phone) ?? v.phone,
    iban: normalizeIban(v.iban),
  };
}

// ---------------------------------------------------------------------------
// Montants
// ---------------------------------------------------------------------------

/** 6999 → « 69,99 € » ; 150000 → « 1 500 € » (centimes omis s'ils sont nuls). */
export function formatEuros(cents: number, opts: { always?: boolean } = {}): string {
  const euros = cents / 100;
  const hasCents = cents % 100 !== 0;
  return euros.toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: hasCents || opts.always ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** Commission mensuelle à un taux donné (arrondi inférieur, comme le serveur). */
export const commissionCents = (priceCents: number, rateBps: number): number => Math.floor((priceCents * rateBps) / 10000);

export const engagementLabel = (months: number): string => (months === 0 ? 'Sans engagement' : `Engagement ${String(months)} mois`);

export function groupByBrand(offers: readonly Offer[]): { brand: string; category: string; description: string; offers: Offer[] }[] {
  const out: { brand: string; category: string; description: string; offers: Offer[] }[] = [];
  for (const o of offers) {
    const g = out.find((x) => x.brand === o.brand);
    if (g) g.offers.push(o);
    else out.push({ brand: o.brand, category: o.category, description: o.description, offers: [o] });
  }
  return out;
}

/** Libellé d'une période « 2026-11-01 » → « novembre 2026 ». */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// ---------------------------------------------------------------------------
// Erreurs et appels
// ---------------------------------------------------------------------------

export class DealError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DealError';
  }
}

const MESSAGES: Record<string, string> = {
  onboarding_required: 'Termine ton inscription pour faire signer un client.',
  subscription_required: 'Active ton abonnement Stacker pour faire signer un client.',
  offer_unavailable: 'Cette offre n’est plus disponible. Choisis-en une autre.',
  invalid_quantity: 'Quantité invalide pour cette offre.',
  invalid_siret: 'SIRET invalide.',
  invalid_company: 'Raison sociale invalide.',
  invalid_address: 'Adresse invalide.',
  invalid_contact: 'Nom ou prénom du signataire invalide.',
  invalid_role: 'Fonction du signataire invalide.',
  invalid_email: 'Adresse email invalide.',
  invalid_phone: 'Numéro de téléphone invalide.',
  invalid_holder: 'Titulaire du compte invalide.',
  invalid_iban: 'IBAN invalide.',
  consent_required: 'Le client doit accepter le contrat et le prélèvement.',
  invalid_signature: 'La signature est trop courte : demande au client de signer à nouveau.',
  contract_changed: 'Le contrat a changé depuis l’aperçu. Relis-le et fais signer à nouveau.',
  already_signed: 'Ce contrat a déjà été signé aujourd’hui pour ce client.',
  daily_quota: 'Tu as atteint la limite de signatures sur 24 h. Contacte Stacker si c’est normal.',
  not_found: 'Introuvable (déjà signé ou plus dans ta liste).',
  payout_account_required: 'Ajoute d’abord ton IBAN pour recevoir tes virements.',
  payout_pending: 'Un virement est déjà en cours.',
  payout_too_small: 'Ton solde disponible est inférieur au minimum de virement.',
  unauthorized: 'Ta session a expiré. Reconnecte-toi.',
  network: 'Connexion impossible. Vérifie ta connexion internet et réessaie.',
};

export function dealErrorMessage(error: unknown): string {
  const fallback = 'Le service est momentanément indisponible. Réessaie dans un instant.';
  if (error instanceof DealError) return MESSAGES[error.code] ?? fallback;
  if (error instanceof ApiError) return MESSAGES[error.kind] ?? fallback;
  return fallback;
}

interface PgError {
  code?: string;
  message?: string;
}

function toError(error: PgError, status: number): Error {
  if (status === 0 || /fetch|network/i.test(error.message ?? '')) return new ApiError('network');
  if (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') return new ApiError('unauthorized');
  const code = error.message ?? '';
  if (/^[a-z_]{3,40}$/.test(code)) return new DealError(code);
  return new ApiError('server');
}

async function rpc<T>(b: Backend, fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const res = await b.db.rpc(fn, args);
  if (res.error) throw toError(res.error, res.status);
  const parsed = schema.safeParse(res.data as unknown);
  if (!parsed.success) throw new ApiError('server', `${fn} illisible`);
  return parsed.data;
}

export const fetchCatalog = (b: Backend) => rpc(b, 'deal_catalog', {}, catalogSchema);
export const previewDeal = (b: Backend, v: DealInput) => rpc(b, 'deal_preview', { p_input: toPayload(v) }, previewSchema);
export const signDeal = (b: Backend, v: DealInput, signature: string, sha: string) =>
  rpc(b, 'deal_sign', { p_input: toPayload(v), p_signature: signature, p_contract_sha256: sha }, signedSchema);
export const fetchMyDeals = (b: Backend) => rpc(b, 'my_deals', {}, z.array(dealRowSchema));
export const fetchDeal = (b: Backend, id: string) => rpc(b, 'deal_detail', { p_deal: id }, dealDetailSchema);
export const fetchEarnings = (b: Backend) => rpc(b, 'my_earnings', {}, earningsSchema);
export const setPayoutAccount = (b: Backend, holder: string, iban: string) =>
  rpc(b, 'payout_set_account', { p_holder: holder.trim(), p_iban: normalizeIban(iban) }, z.unknown());
export const requestPayout = (b: Backend) => rpc(b, 'payout_request', {}, z.uuid());
