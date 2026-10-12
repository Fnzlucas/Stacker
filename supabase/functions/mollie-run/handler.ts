/**
 * Tâche planifiée Mollie (toutes les heures, protégée par CRON_SECRET) :
 *   1. clients signés : client Mollie, mandat SEPA (IBAN, RUM, date de
 *      signature du contrat) puis abonnement mensuel, premier prélèvement le
 *      lendemain de la fin du délai de rétractation ;
 *   2. contrats résiliés ou annulés : abonnement Mollie arrêté ;
 *   3. abonnements stackers arrivés à échéance : payés sur les gains en base,
 *      sinon prélevés sur le mandat Mollie (paiement récurrent).
 * Chaque étape est reprise au passage suivant en cas d'erreur (clés
 * d'idempotence : pas de doublon chez Mollie). Journaux sans IBAN ni nom.
 */
import { z } from 'zod';
import { callRpc, RpcError, type FetchLike } from '../_shared/rest.ts';
import { jsonResponse } from '../_shared/http.ts';
import { createMollie, MollieError, mollieAmount, type BillingConfigResult } from '../_shared/mollie.ts';

export const BATCH = 20;

export interface HandlerDeps {
  config: BillingConfigResult;
  fetch: FetchLike;
  log: (event: string, data?: Record<string, string | number | boolean | string[]>) => void;
  mollieBase?: string;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const pendingSchema = z.array(
  z.object({
    deal_id: z.uuid(),
    reference: z.string(),
    customer_id: z.string().nullable(),
    mandate_id: z.string().nullable(),
    company_name: z.string(),
    email: z.string(),
    iban: z.string(),
    iban_holder: z.string(),
    mandate_ref: z.string(),
    signed_on: date,
    first_debit_on: date,
    amount_cents: z.number().int().positive(),
  }),
);
const cancelSchema = z.array(z.object({ deal_id: z.uuid(), customer_id: z.string().nullable(), subscription_id: z.string().nullable() }));
const renewSchema = z.array(
  z.object({ stacker_id: z.uuid(), customer_id: z.string(), mandate_id: z.string(), period_start: date, amount_cents: z.number().int().positive() }),
);

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const reason = (error: unknown) =>
  error instanceof MollieError ? `mollie_${String(error.status)}${error.field ? `_${error.field}` : ''}` : error instanceof RpcError ? `rpc_${String(error.status)}` : 'exception';

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  if (!deps.config.ok) deps.log('config_invalid', { variables: deps.config.missing });
  return async function handle(req: Request): Promise<Response> {
    if (!deps.config.ok) return jsonResponse(503, { ok: false, error: 'unavailable' });
    const config = deps.config.config;
    const cronSecret = config.cronSecret;
    if (!cronSecret) return jsonResponse(503, { ok: false, error: 'unavailable' });
    if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'method_not_allowed' });
    if (!sameSecret(req.headers.get('x-cron-secret') ?? '', cronSecret)) return jsonResponse(403, { ok: false, error: 'forbidden' });
    const rpc = (fn: string, args: Record<string, unknown>) => callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, fn, args);
    const mollie = createMollie(deps.fetch, config.mollieKey, deps.mollieBase);
    const stats = { setup: 0, setup_failed: 0, cancelled: 0, cancel_failed: 0, renew_requested: 0, renew_failed: 0 };
    try {
      // 1. Mise en place des prélèvements clients.
      for (const d of pendingSchema.parse(await rpc('deal_mollie_pending', { p_limit: BATCH }))) {
        try {
          let customer = d.customer_id;
          if (!customer) {
            customer = await mollie.createCustomer({ name: d.company_name, email: d.email, metadata: { deal_id: d.deal_id } }, `deal-${d.deal_id}-customer`);
            await rpc('deal_mollie_progress', { p_deal: d.deal_id, p_customer: customer, p_mandate: null, p_subscription: null, p_first_debit: null });
          }
          let mandate = d.mandate_id;
          if (!mandate) {
            mandate = await mollie.createMandate(
              customer,
              { consumerName: d.iban_holder, consumerAccount: d.iban, signatureDate: d.signed_on, mandateReference: d.mandate_ref },
              `deal-${d.deal_id}-mandate`,
            );
            await rpc('deal_mollie_progress', { p_deal: d.deal_id, p_customer: null, p_mandate: mandate, p_subscription: null, p_first_debit: null });
          }
          const subscription = await mollie.createSubscription(
            customer,
            {
              amount: mollieAmount(d.amount_cents),
              interval: '1 month',
              startDate: d.first_debit_on,
              description: `Stacker ${d.reference}`,
              mandateId: mandate,
              webhookUrl: config.webhookUrl,
              metadata: { kind: 'deal', deal_id: d.deal_id },
            },
            `deal-${d.deal_id}-subscription`,
          );
          await rpc('deal_mollie_progress', { p_deal: d.deal_id, p_customer: null, p_mandate: null, p_subscription: subscription, p_first_debit: d.first_debit_on });
          stats.setup++;
        } catch (error) {
          stats.setup_failed++;
          await rpc('deal_mollie_failed', { p_deal: d.deal_id, p_error: reason(error), p_final: error instanceof MollieError && error.final }).catch(() => undefined);
        }
      }

      // 2. Contrats terminés : plus de prélèvement.
      for (const c of cancelSchema.parse(await rpc('deal_mollie_cancels', { p_limit: BATCH }))) {
        try {
          if (c.customer_id && c.subscription_id) await mollie.cancelSubscription(c.customer_id, c.subscription_id);
          await rpc('deal_mollie_cancelled', { p_deal: c.deal_id });
          stats.cancelled++;
        } catch {
          stats.cancel_failed++;
        }
      }

      // 3. Renouvellement des abonnements stackers (ceux payés sur les gains sont déjà réglés en base).
      for (const r of renewSchema.parse(await rpc('billing_renew_due', { p_limit: 50 }))) {
        try {
          const payment = await mollie.createPayment(
            {
              amount: mollieAmount(r.amount_cents),
              description: `Abonnement Stacker — ${r.period_start}`,
              sequenceType: 'recurring',
              customerId: r.customer_id,
              mandateId: r.mandate_id,
              webhookUrl: config.webhookUrl,
              metadata: { kind: 'stacker', charge: 'mensuel', stacker_id: r.stacker_id, period: r.period_start },
            },
            `renew-${r.stacker_id}-${r.period_start}`,
          );
          await rpc('billing_charge_created', { p_stacker: r.stacker_id, p_kind: 'mensuel', p_period: r.period_start, p_amount: r.amount_cents, p_payment: payment.id });
          stats.renew_requested++;
        } catch (error) {
          stats.renew_failed++;
          deps.log('renew_failed', { reason: reason(error) });
        }
      }

      deps.log('run_done', stats);
      return jsonResponse(200, { ok: true, ...stats });
    } catch (error) {
      deps.log('server_error', { reason: error instanceof z.ZodError ? 'invalid_payload' : reason(error) });
      return jsonResponse(500, { ok: false, error: 'server_error' });
    }
  };
}
