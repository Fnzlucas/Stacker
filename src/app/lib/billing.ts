/**
 * Abonnement stacker : état (my_billing), page de paiement Mollie
 * (Edge Function billing-checkout), résiliation / reprise.
 */
import { z } from 'zod';
import { ApiError } from './apiError';
import type { Backend } from './supabase';

export const BILLING_STATUSES = ['aucun', 'en_attente', 'actif', 'impaye', 'resilie'] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const billingSchema = z.object({
  required: z.boolean(),
  has_access: z.boolean(),
  status: z.enum(BILLING_STATUSES),
  price_cents: z.number().int(),
  launch_member: z.boolean(),
  launch_until: z.string().nullable(),
  launch_seats_left: z.number().int(),
  launch_priority: z.boolean(),
  current_period_end: z.string().nullable(),
  method_label: z.string().nullable(),
  cancel_at_period_end: z.boolean(),
  charges: z.array(
    z.object({
      period_start: z.string(),
      amount_cents: z.number().int(),
      method: z.enum(['mollie', 'commissions']),
      status: z.enum(['en_attente', 'paye', 'echoue']),
      created_at: z.string(),
    }),
  ),
});
export type Billing = z.infer<typeof billingSchema>;

export class BillingError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'BillingError';
  }
}

const FALLBACK = 'Le service est momentanément indisponible. Réessaie dans un instant.';
const MESSAGES: Record<string, string> = {
  already_active: 'Ton abonnement est déjà actif.',
  onboarding_required: 'Termine ton inscription avant de t’abonner.',
  no_subscription: 'Tu n’as pas d’abonnement en cours.',
  payment_unavailable: 'Le paiement est momentanément indisponible. Réessaie dans quelques minutes.',
  unavailable: 'Le paiement n’est pas encore ouvert. Réessaie un peu plus tard.',
  unauthorized: 'Ta session a expiré. Reconnecte-toi.',
  network: 'Connexion impossible. Vérifie ta connexion internet et réessaie.',
};

export function billingErrorMessage(error: unknown): string {
  if (error instanceof BillingError) return MESSAGES[error.code] ?? FALLBACK;
  if (error instanceof ApiError) return MESSAGES[error.kind] ?? FALLBACK;
  return FALLBACK;
}

export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  aucun: 'Pas d’abonnement',
  en_attente: 'Paiement en attente',
  actif: 'Actif',
  impaye: 'Paiement refusé',
  resilie: 'Terminé',
};

/** Ce que voit le stacker en haut de la page, selon l'état. */
export type BillingView = 'offer' | 'active' | 'ending' | 'unpaid' | 'pending';
export function billingView(b: Billing): BillingView {
  if (b.status === 'actif') return b.cancel_at_period_end ? 'ending' : 'active';
  if (b.status === 'impaye') return 'unpaid';
  if (b.status === 'en_attente' && b.charges.some((c) => c.status === 'en_attente')) return 'pending';
  return 'offer';
}

/** Bandeau des écrans de prospection et de vente : abonnement exigé et pas d'accès. */
export const needsSubscription = (b: Billing | undefined): boolean => Boolean(b && b.required && !b.has_access);

interface PgError {
  code?: string;
  message?: string;
}

function toError(error: PgError, status: number): Error {
  if (status === 0 || /fetch|network/i.test(error.message ?? '')) return new ApiError('network');
  if (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') return new ApiError('unauthorized');
  const code = error.message ?? '';
  if (/^[a-z_]{3,40}$/.test(code)) return new BillingError(code);
  return new ApiError('server');
}

async function rpc<T>(b: Backend, fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const res = await b.db.rpc(fn, args);
  if (res.error) throw toError(res.error, res.status);
  const parsed = schema.safeParse(res.data as unknown);
  if (!parsed.success) throw new ApiError('server', `${fn} illisible`);
  return parsed.data;
}

export const fetchBilling = (b: Backend) => rpc(b, 'my_billing', {}, billingSchema);
export const setAutoRenew = (b: Backend, on: boolean) => rpc(b, 'billing_set_auto_renew', { p_on: on }, billingSchema);

const checkoutSchema = z.union([z.object({ ok: z.literal(true), url: z.url() }), z.object({ ok: z.literal(false), error: z.string() })]);

/** URL de la page de paiement Mollie (identité = jeton). Seule une page mollie.com est acceptée. */
export async function startCheckout(b: Backend, fetchFn: typeof fetch = fetch): Promise<string> {
  const token = await b.accessToken();
  if (!token) throw new ApiError('unauthorized');
  let res: Response;
  try {
    res = await fetchFn(`${b.url}/functions/v1/billing-checkout`, {
      method: 'POST',
      headers: { apikey: b.anonKey, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError('network');
  }
  const parsed = checkoutSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ApiError('server');
  if (!parsed.data.ok) throw parsed.data.error === 'unauthorized' ? new ApiError('unauthorized') : new BillingError(parsed.data.error);
  const url = new URL(parsed.data.url);
  if (url.protocol !== 'https:' || !(url.hostname === 'mollie.com' || url.hostname.endsWith('.mollie.com'))) throw new ApiError('server');
  return url.toString();
}
