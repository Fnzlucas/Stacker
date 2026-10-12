/**
 * Webhook Mollie (public). Mollie n'envoie que l'identifiant du paiement :
 * l'état est TOUJOURS relu auprès de l'API Mollie avec notre clé, le corps
 * reçu n'est jamais cru. Répond 200 pour tout ce qui est traité ou ignoré
 * (identifiant inconnu), 5xx pour que Mollie réessaie en cas de panne.
 *
 *   - abonnement d'un client signé (subscriptionId) : payé → commission ;
 *     échoué → deal suspendu ; remboursé (contestation) → reprise ;
 *   - abonnement stacker (metadata.kind = stacker) : payé → abonnement actif ;
 *     échoué → en attente / impayé.
 */
import { z } from 'zod';
import { callRpc, RpcError, type FetchLike } from '../_shared/rest.ts';
import { jsonResponse } from '../_shared/http.ts';
import { centsOf, createMollie, methodLabel, MollieError, parisDate, type BillingConfigResult, type MolliePayment } from '../_shared/mollie.ts';

export interface HandlerDeps {
  config: BillingConfigResult;
  fetch: FetchLike;
  log: (event: string, data?: Record<string, string | number | boolean | string[]>) => void;
  mollieBase?: string;
}

const ID = /^tr_[A-Za-z0-9]{4,40}$/;
const stackerMeta = z.object({
  kind: z.literal('stacker'),
  charge: z.enum(['premier', 'mensuel']),
  stacker_id: z.uuid(),
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const FAILED = new Set(['failed', 'canceled', 'expired']);

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  if (!deps.config.ok) deps.log('config_invalid', { variables: deps.config.missing });
  return async function handle(req: Request): Promise<Response> {
    if (!deps.config.ok) return jsonResponse(503, { ok: false, error: 'unavailable' });
    const config = deps.config.config;
    if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'method_not_allowed' });
    if (Number(req.headers.get('content-length') ?? '0') > 1024) return jsonResponse(413, { ok: false, error: 'too_large' });
    const text = (await req.text()).slice(0, 1024);
    const id = new URLSearchParams(text).get('id') ?? '';
    if (!ID.test(id)) return jsonResponse(400, { ok: false, error: 'invalid_request' });
    const rpc = (fn: string, args: Record<string, unknown>) => callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, fn, args);
    const mollie = createMollie(deps.fetch, config.mollieKey, deps.mollieBase);

    let payment: MolliePayment;
    try {
      payment = await mollie.getPayment(id);
    } catch (error) {
      if (error instanceof MollieError && error.status === 404) {
        deps.log('unknown_payment');
        return jsonResponse(200, { ok: true });
      }
      deps.log('mollie_error', { reason: error instanceof MollieError ? `http_${String(error.status)}` : 'exception' });
      return jsonResponse(502, { ok: false, error: 'retry' });
    }

    try {
      const chargedBack = centsOf(payment.amountChargedBack) > 0;
      if (payment.subscriptionId) {
        if (chargedBack) {
          await rpc('deal_payment_reversed', { p_payment: payment.id });
          deps.log('deal_chargeback');
        } else if (payment.status === 'paid') {
          try {
            await rpc('deal_payment_from_mollie', {
              p_subscription: payment.subscriptionId,
              p_paid_on: parisDate(payment.paidAt),
              p_amount_cents: centsOf(payment.amount),
              p_payment: payment.id,
            });
            deps.log('deal_paid');
          } catch (error) {
            if (!(error instanceof RpcError && error.message === 'not_found')) throw error;
            deps.log('unknown_subscription');
          }
        } else if (FAILED.has(payment.status)) {
          await rpc('deal_payment_failed_from_mollie', { p_subscription: payment.subscriptionId, p_reason: payment.details?.bankReasonCode ?? payment.status });
          deps.log('deal_failed', { status: payment.status });
        }
        return jsonResponse(200, { ok: true });
      }

      const meta = stackerMeta.safeParse(payment.metadata);
      if (!meta.success) {
        deps.log('ignored');
        return jsonResponse(200, { ok: true });
      }
      const m = meta.data;
      // Filet de sécurité : la ligne existe même si la création côté serveur a été interrompue.
      await rpc('billing_charge_created', { p_stacker: m.stacker_id, p_kind: m.charge, p_period: m.period, p_amount: centsOf(payment.amount), p_payment: payment.id });
      if (chargedBack) {
        deps.log('stacker_chargeback');
      } else if (payment.status === 'paid') {
        await rpc('billing_payment_paid', { p_payment: payment.id, p_mandate: payment.mandateId ?? null, p_method_label: methodLabel(payment) });
        deps.log('stacker_paid', { charge: m.charge });
      } else if (FAILED.has(payment.status)) {
        await rpc('billing_payment_failed', { p_payment: payment.id });
        deps.log('stacker_failed', { charge: m.charge, status: payment.status });
      }
      return jsonResponse(200, { ok: true });
    } catch (error) {
      deps.log('server_error', { reason: error instanceof RpcError ? `rpc_${String(error.status)}` : 'exception' });
      return jsonResponse(500, { ok: false, error: 'retry' });
    }
  };
}
