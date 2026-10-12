/**
 * Espace admin : lecture et actions, toutes vérifiées côté serveur
 * (admin_require). Le navigateur ne décide jamais qui est admin.
 */
import { z } from 'zod';
import { ApiError } from './apiError';
import type { Backend } from './supabase';

const n = z.number().int();
const ts = z.string();

export const overviewSchema = z.object({
  stackers: n,
  signups_7d: n,
  subscriptions: n,
  subscriptions_unpaid: n,
  launch_members: n,
  launch_seats: n,
  deals: z.record(z.string(), n),
  deals_7d: n,
  client_monthly_cents: n,
  payouts_pending: n,
  payouts_pending_cents: n,
  commissions_available_cents: n,
  mollie_errors: n,
  emails_failed: n,
  flags: z.record(z.string(), z.boolean()),
  log: z.array(z.object({ action: z.string(), target: z.string().nullable(), detail: z.record(z.string(), z.unknown()), created_at: ts, admin: z.string().nullable() })),
});
export type Overview = z.infer<typeof overviewSchema>;

export const PAYOUT_FILTERS = ['demande', 'verse', 'refuse'] as const;
export type PayoutFilter = (typeof PAYOUT_FILTERS)[number];
export const adminPayoutSchema = z.object({
  id: z.uuid(),
  amount_cents: n,
  status: z.enum(PAYOUT_FILTERS),
  requested_at: ts,
  processed_at: ts.nullable(),
  reference: z.string().nullable(),
  iban_last4: z.string(),
  stacker_id: z.uuid().nullable(),
  stacker_name: z.string().nullable(),
  stacker_email: z.string().nullable(),
  holder: z.string().nullable(),
  iban: z.string().nullable(),
});
export type AdminPayout = z.infer<typeof adminPayoutSchema>;

export const DEAL_FILTERS = ['signe', 'actif', 'suspendu', 'resilie', 'annule'] as const;
export const adminDealSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: z.enum(DEAL_FILTERS),
  company_name: z.string(),
  company_siret: z.string(),
  contact_email: z.string(),
  contact_phone: z.string(),
  offer_label: z.string(),
  monthly_price_cents: n,
  signed_at: ts,
  activated_at: ts.nullable(),
  ended_at: ts.nullable(),
  end_reason: z.string().nullable(),
  mollie_status: z.string(),
  mollie_error: z.string().nullable(),
  first_debit_on: z.string().nullable(),
  payments: n,
  stacker_name: z.string().nullable(),
});
export type AdminDeal = z.infer<typeof adminDealSchema>;

export const adminOfferSchema = z.object({
  id: z.string(),
  brand: z.string(),
  name: z.string(),
  category: z.string(),
  price_cents: n,
  unit_label: z.string().nullable(),
  engagement_months: n,
  active: z.boolean(),
  deals: n,
});
export type AdminOffer = z.infer<typeof adminOfferSchema>;

export const adminStackerSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  department: z.string().nullable(),
  tier: z.string(),
  active_clients: n,
  onboarded: z.boolean(),
  created_at: ts,
  subscription: z.enum(['aucun', 'en_attente', 'actif', 'impaye', 'resilie']),
  launch_member: z.boolean(),
  period_end: z.string().nullable(),
  deals: n,
  available_cents: n,
});
export type AdminStacker = z.infer<typeof adminStackerSchema>;

/** Interrupteurs modifiables depuis l'admin, avec leur explication. */
export const FLAGS: { key: string; label: string; help: string; danger?: boolean }[] = [
  { key: 'billing_required', label: 'Abonnement obligatoire', help: 'Sans abonnement à jour : plus de réservation, recherche, campagne ni signature.', danger: true },
  { key: 'prospects_enabled', label: 'Prospection', help: 'Recherche et réservation de prospects.' },
  { key: 'campaigns_enabled', label: 'Campagnes d’emails', help: 'Envoi automatique des emails de prospection.' },
  { key: 'leads_enrich_enabled', label: 'Moteur de recherche d’emails', help: 'Recherche des coordonnées des entreprises (Google Maps, sites).' },
];

export const LOG_LABELS: Record<string, string> = {
  payout_verse: 'Virement versé',
  payout_refuse: 'Virement refusé',
  deal_suspendu: 'Deal suspendu',
  deal_resilie: 'Deal résilié',
  deal_annule: 'Deal annulé',
  offer_on: 'Offre activée',
  offer_off: 'Offre désactivée',
  flag: 'Interrupteur',
};

export class AdminError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AdminError';
  }
}

const FALLBACK = 'Le service est momentanément indisponible. Réessaie dans un instant.';
const MESSAGES: Record<string, string> = {
  forbidden: 'Accès réservé à l’équipe Stacker.',
  invalid_request: 'Demande invalide : vérifie le motif.',
  invalid_transition: 'Déjà traité.',
  deal_closed: 'Ce deal est déjà terminé.',
  not_found: 'Introuvable.',
  unauthorized: 'Ta session a expiré. Reconnecte-toi.',
  network: 'Connexion impossible. Vérifie ta connexion internet et réessaie.',
};

export function adminErrorMessage(error: unknown): string {
  if (error instanceof AdminError) return MESSAGES[error.code] ?? FALLBACK;
  if (error instanceof ApiError) return MESSAGES[error.kind] ?? FALLBACK;
  return FALLBACK;
}

function toError(error: { code?: string; message?: string }, status: number): Error {
  if (status === 0 || /fetch|network/i.test(error.message ?? '')) return new ApiError('network');
  if (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') return new ApiError('unauthorized');
  const code = error.message ?? '';
  if (/^[a-z_]{3,40}$/.test(code)) return new AdminError(code);
  return new ApiError('server');
}

async function rpc<T>(b: Backend, fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const res = await b.db.rpc(fn, args);
  if (res.error) throw toError(res.error, res.status);
  const parsed = schema.safeParse(res.data as unknown);
  if (!parsed.success) throw new ApiError('server', `${fn} illisible`);
  return parsed.data;
}

const done = z.unknown();
export const fetchIsAdmin = (b: Backend) => rpc(b, 'is_admin', {}, z.boolean());
export const fetchOverview = (b: Backend) => rpc(b, 'admin_overview', {}, overviewSchema);
export const fetchAdminPayouts = (b: Backend, status: PayoutFilter) => rpc(b, 'admin_payouts', { p_status: status }, z.array(adminPayoutSchema));
export const fetchAdminDeals = (b: Backend, status: string | null, search: string) =>
  rpc(b, 'admin_deals', { p_status: status, p_search: search.trim() || null }, z.array(adminDealSchema));
export const fetchAdminOffers = (b: Backend) => rpc(b, 'admin_offers', {}, z.array(adminOfferSchema));
export const fetchAdminStackers = (b: Backend, search: string) => rpc(b, 'admin_stackers', { p_search: search.trim() || null }, z.array(adminStackerSchema));
export const markPayout = (b: Backend, id: string, status: 'verse' | 'refuse', note: string) =>
  rpc(b, 'admin_payout_mark', { p_payout: id, p_status: status, p_note: note.trim() || null }, done);
export const setDealStatus = (b: Backend, id: string, status: 'suspendu' | 'resilie' | 'annule', reason: string) =>
  rpc(b, 'admin_deal_set_status', { p_deal: id, p_status: status, p_reason: reason.trim() }, done);
export const setOfferActive = (b: Backend, id: string, active: boolean) => rpc(b, 'admin_offer_set_active', { p_offer: id, p_active: active }, done);
export const setFlag = (b: Backend, key: string, enabled: boolean) => rpc(b, 'admin_set_flag', { p_key: key, p_enabled: enabled }, done);

/** IBAN lisible par blocs de 4. */
export const groupIban = (iban: string): string => iban.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim();
