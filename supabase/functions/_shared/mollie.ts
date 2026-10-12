/**
 * Client minimal de l'API Mollie v2 (paiements, clients, mandats SEPA,
 * abonnements) et configuration commune des fonctions de paiement.
 * La clé API ne quitte jamais le serveur ; une clé `test_` utilise le mode
 * test de Mollie, une clé `live_` les vrais paiements.
 */
import { z } from 'zod';
import type { FetchLike } from './rest.ts';

export const MOLLIE_API = 'https://api.mollie.com/v2';

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const billingEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_ANON_KEY: z.string().min(20).optional(),
  SITE_URL: z.url().transform((u) => u.replace(/\/$/, '')),
  ALLOWED_ORIGINS: z.string().transform(csv).optional(),
  MOLLIE_API_KEY: z.string().regex(/^(test|live)_[A-Za-z0-9]{20,}$/, 'clé Mollie test_… ou live_… attendue'),
  CRON_SECRET: z.string().min(24).optional(),
});

export interface BillingConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string | null;
  siteUrl: string;
  allowedOrigins: ReadonlySet<string>;
  mollieKey: string;
  testMode: boolean;
  cronSecret: string | null;
  webhookUrl: string;
}

export type BillingConfigResult = { ok: true; config: BillingConfig } | { ok: false; missing: string[] };

export function loadBillingConfig(env: Record<string, string | undefined>): BillingConfigResult {
  const parsed = billingEnvSchema.safeParse(env);
  if (!parsed.success) return { ok: false, missing: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))] };
  const e = parsed.data;
  const supabaseUrl = e.SUPABASE_URL.replace(/\/$/, '');
  return {
    ok: true,
    config: {
      supabaseUrl,
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
      anonKey: e.SUPABASE_ANON_KEY ?? null,
      siteUrl: e.SITE_URL,
      allowedOrigins: new Set(e.ALLOWED_ORIGINS ?? []),
      mollieKey: e.MOLLIE_API_KEY,
      testMode: e.MOLLIE_API_KEY.startsWith('test_'),
      cronSecret: e.CRON_SECRET ?? null,
      webhookUrl: `${supabaseUrl}/functions/v1/mollie-webhook`,
    },
  };
}

/** Montant Mollie : chaîne avec deux décimales, en euros. */
export const mollieAmount = (cents: number) => ({ currency: 'EUR', value: (cents / 100).toFixed(2) });

/** Centimes à partir d'un montant Mollie (« 6.99 » → 699). */
export function centsOf(amount: { value: string } | null | undefined): number {
  if (!amount) return 0;
  const [whole = '0', frac = ''] = amount.value.split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(Number(whole)) * 100 + Number(frac.padEnd(2, '0').slice(0, 2)));
}

/** Date du jour à Paris (AAAA-MM-JJ) pour un instant donné. */
export function parisDate(iso: string | null | undefined, fallback = new Date()): string {
  const d = iso ? new Date(iso) : fallback;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Number.isNaN(d.getTime()) ? fallback : d);
}

export class MollieError extends Error {
  constructor(
    readonly status: number,
    readonly field: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'MollieError';
  }
  /** Erreur définitive (donnée refusée) : inutile de réessayer. */
  get final(): boolean {
    return this.status === 400 || this.status === 422;
  }
}

const errorSchema = z.object({ status: z.number().optional(), detail: z.string().optional(), field: z.string().optional() }).loose();

export const paymentSchema = z
  .object({
    id: z.string(),
    status: z.enum(['open', 'pending', 'authorized', 'paid', 'canceled', 'expired', 'failed']),
    amount: z.object({ value: z.string(), currency: z.string() }),
    amountChargedBack: z.object({ value: z.string(), currency: z.string() }).nullish(),
    sequenceType: z.string().nullish(),
    method: z.string().nullish(),
    customerId: z.string().nullish(),
    mandateId: z.string().nullish(),
    subscriptionId: z.string().nullish(),
    paidAt: z.string().nullish(),
    metadata: z.unknown().nullish(),
    details: z
      .object({
        cardNumber: z.string().nullish(),
        consumerAccount: z.string().nullish(),
        bankReasonCode: z.string().nullish(),
        bankReason: z.string().nullish(),
      })
      .loose()
      .nullish(),
    _links: z.object({ checkout: z.object({ href: z.url() }).nullish() }).loose().optional(),
  })
  .loose();
export type MolliePayment = z.infer<typeof paymentSchema>;

const idSchema = z.object({ id: z.string() }).loose();

export interface Mollie {
  createCustomer(input: { name: string | null; email: string | null; metadata: Record<string, string> }, idempotencyKey: string): Promise<string>;
  createPayment(input: Record<string, unknown>, idempotencyKey: string): Promise<MolliePayment>;
  getPayment(id: string): Promise<MolliePayment>;
  createMandate(customerId: string, input: { consumerName: string; consumerAccount: string; signatureDate: string; mandateReference: string }, idempotencyKey: string): Promise<string>;
  createSubscription(customerId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<string>;
  cancelSubscription(customerId: string, subscriptionId: string): Promise<void>;
}

export function createMollie(fetchFn: FetchLike, apiKey: string, base = MOLLIE_API): Mollie {
  async function call(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<unknown> {
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await fetchFn(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const err = errorSchema.safeParse(await res.json().catch(() => null));
      throw new MollieError(res.status, err.success ? (err.data.field ?? null) : null, err.success ? (err.data.detail ?? `mollie http ${String(res.status)}`) : `mollie http ${String(res.status)}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }
  const id = (v: unknown) => idSchema.parse(v).id;
  return {
    createCustomer: async (input, key) => id(await call('POST', '/customers', { name: input.name ?? undefined, email: input.email ?? undefined, metadata: input.metadata }, key)),
    createPayment: async (input, key) => paymentSchema.parse(await call('POST', '/payments', input, key)),
    getPayment: async (pid) => paymentSchema.parse(await call('GET', `/payments/${encodeURIComponent(pid)}`)),
    createMandate: async (cst, input, key) => id(await call('POST', `/customers/${encodeURIComponent(cst)}/mandates`, { method: 'directdebit', ...input }, key)),
    createSubscription: async (cst, input, key) => id(await call('POST', `/customers/${encodeURIComponent(cst)}/subscriptions`, input, key)),
    cancelSubscription: async (cst, sub) => {
      try {
        await call('DELETE', `/customers/${encodeURIComponent(cst)}/subscriptions/${encodeURIComponent(sub)}`);
      } catch (error) {
        // Déjà arrêté ou inexistant : l'objectif est atteint.
        if (error instanceof MollieError && (error.status === 404 || error.status === 410 || error.status === 422)) return;
        throw error;
      }
    },
  };
}

/** Libellé du moyen de paiement, sans numéro complet (« Carte •••• 4242 », « SEPA •••• 0189 »). */
export function methodLabel(p: MolliePayment): string | null {
  const card = p.details?.cardNumber?.replace(/\D/g, '').slice(-4);
  if (card) return `Carte •••• ${card}`;
  const iban = p.details?.consumerAccount?.replace(/\s/g, '').slice(-4);
  if (iban) return `Compte •••• ${iban}`;
  if (p.method === 'creditcard') return 'Carte bancaire';
  return p.method ?? null;
}
